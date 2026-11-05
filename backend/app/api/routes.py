import asyncio
import csv, io, json
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from typing import Optional
from app.mcp.arxiv import ArxivMCP
from app.mcp.semantic_scholar import SemanticScholarMCP
from app.mcp.github import GitHubMCP
from app.mcp.huggingface import HuggingFaceMCP
from app.services.graph import build_knowledge_graph, fetch_neo4j_subgraph
from app.rag.vectorstore import add_papers, query as rag_query, count as rag_count
from app.agents import research_agent as agent
from app.agents.research_agent import LLMError
from app.agents.pdf_agent import answer_pdf_question
from app.rag.pdf_engine import pdf_store, download_arxiv_pdf, arxiv_pdf_filename, max_pdf_bytes, PDFTooLarge
from app.db.knowledge_graph import save_hf_artifacts, get_topic_graph, get_multi_hop_citations
from app.services.academic import get_paper_citations, search_author_portfolio
from app.db.database import (
    save_report, save_search, get_reports, get_searches,
    get_report_by_id, get_neo4j_stats
)

router = APIRouter(prefix="/api")

arxiv   = ArxivMCP()
scholar = SemanticScholarMCP()
github  = GitHubMCP()
hf      = HuggingFaceMCP()


# ── Request models ────────────────────────────────────────────────────────
class SearchReq(BaseModel):
    query: str
    sources: list = ["arxiv", "semantic_scholar"]
    max_results: int = 10

class TopicReq(BaseModel):
    topic: str

class CompareReq(BaseModel):
    paper_a: dict
    paper_b: dict

class ChatReq(BaseModel):
    question: str
    use_rag: bool = False

class CitationReq(BaseModel):
    title: str
    limit: int = Field(default=15, ge=1, le=50)

class AuthorSearchReq(BaseModel):
    name: str
    max_results: int = Field(default=15, ge=1, le=50)

class ArxivPdfReq(BaseModel):
    arxiv_id: str = Field(min_length=1, max_length=200)

class PdfChatReq(BaseModel):
    question: str = Field(min_length=1, max_length=2000)

class MultiHopReq(BaseModel):
    title: str
    hops: int = Field(default=2, ge=1, le=3)


# ── Helpers ───────────────────────────────────────────────────────────────
def _merge(lists):
    """Dedupe by title. The first copy wins, but a citation count reported by a
    later source (Semantic Scholar) is kept instead of the arXiv copy's none."""
    seen, out = {}, []
    for p in (p for lst in lists for p in lst):
        k = (p.get("title") or "").lower()[:60]
        if not k:
            continue
        if k in seen:
            first = seen[k]
            if (p.get("citations") or 0) > (first.get("citations") or 0):
                first["citations"] = p["citations"]
            continue
        seen[k] = p; out.append(p)
    return out


async def _llm(coro):
    """Await an agent call; LLM failures become 502 and nothing gets saved."""
    try:
        return await coro
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e))


async def _topic_papers(topic: str, n_arxiv: int, n_scholar: int, top_up: bool = True):
    papers = _merge([
        await arxiv.search(topic, n_arxiv),
        await scholar.search(topic, n_scholar),
    ])
    if top_up:
        papers = await agent.top_up_papers(topic, papers)
    await run_in_threadpool(add_papers, papers)
    return papers


# ── Search ────────────────────────────────────────────────────────────────
@router.post("/search")
async def search(req: SearchReq):
    async def _none():
        return []

    # the four sources are independent, so query them concurrently
    arxiv_res, scholar_res, gh_res, hf_res = await asyncio.gather(
        arxiv.search(req.query, req.max_results) if "arxiv" in req.sources else _none(),
        scholar.search(req.query, req.max_results) if "semantic_scholar" in req.sources else _none(),
        github.search(req.query, max_results=8),  # always fetched, regardless of the sources toggle
        hf.search_all(req.query, max_models=6, max_datasets=6),
    )
    models = hf_res.get("models", []) if isinstance(hf_res, dict) else []
    datasets = hf_res.get("datasets", []) if isinstance(hf_res, dict) else []

    papers = _merge([arxiv_res, scholar_res])
    await run_in_threadpool(add_papers, papers)
    await run_in_threadpool(save_search, req.query, papers, gh_res)
    await run_in_threadpool(save_hf_artifacts, req.query, models, datasets)

    # read the topic subgraph back from Neo4j; build it in memory when Neo4j is offline
    graph = await run_in_threadpool(get_topic_graph, req.query)
    graph_source = "neo4j" if graph and graph.get("nodes") else "networkx"
    if graph_source == "networkx":
        graph = await run_in_threadpool(build_knowledge_graph, req.query, papers, gh_res, models, datasets)
    return {
        "papers": papers, "repos": gh_res, "models": models, "datasets": datasets,
        "graph": graph, "graph_source": graph_source,
        "total": len(papers), "rag_count": rag_count()
    }


# ── Citation Network ──────────────────────────────────────────────────────
@router.post("/citations")
async def get_citations(req: CitationReq):
    """Citing and referenced papers (OpenAlex, then Semantic Scholar, then Neo4j), stored as :CITES edges."""
    return await get_paper_citations(req.title, req.limit)

@router.post("/neo4j/citations/multihop")
def neo4j_multihop(req: MultiHopReq):
    graph = get_multi_hop_citations(req.title, req.hops)
    if not graph:
        raise HTTPException(404, "No citation paths found in Neo4j for this paper")
    return graph


# ── Author Portfolio ──────────────────────────────────────────────────────
@router.post("/author/search")
async def search_author(req: AuthorSearchReq):
    return await search_author_portfolio(req.name, req.max_results)

@router.get("/author")
async def get_author(name: str = Query(..., min_length=1), limit: int = Query(default=15, ge=1, le=50)):
    return await search_author_portfolio(name, limit)


# ── Literature Review ─────────────────────────────────────────────────────
@router.post("/review")
async def literature_review(req: TopicReq):
    # the review cites papers as [1]..[10] in this order, so return and save exactly these
    papers = (await _topic_papers(req.topic, 10, 8))[:10]
    repos = await github.search(req.topic, max_results=6)
    review = await _llm(agent.generate_literature_review(req.topic, papers))
    await run_in_threadpool(save_report, req.topic, "literature_review", review, repos=repos, papers=papers)
    return {"review": review, "papers": papers, "repos": repos}


# ── Literature Survey ─────────────────────────────────────────────────────
@router.post("/survey")
async def survey(req: TopicReq):
    papers = await _topic_papers(req.topic, 10, 8)
    repos = await github.search(req.topic, max_results=6)
    result = await _llm(agent.generate_survey(req.topic, papers))
    graph  = await run_in_threadpool(build_knowledge_graph, req.topic, papers, repos)
    await run_in_threadpool(save_report, req.topic, "survey", json.dumps(result), repos=repos, papers=papers[:10])
    return {"survey": result, "papers": papers[:10], "repos": repos, "graph": graph}


# ── Research Gaps ─────────────────────────────────────────────────────────
@router.post("/gaps")
async def gaps(req: TopicReq):
    papers = await _topic_papers(req.topic, 10, 8)
    repos = await github.search(req.topic, max_results=6)
    result = await _llm(agent.detect_research_gaps(req.topic, papers))
    await run_in_threadpool(save_report, req.topic, "gaps", json.dumps(result), repos=repos, papers=papers)
    return {"gaps": result, "papers_analysed": len(papers), "repos": repos}


# ── Compare Papers ────────────────────────────────────────────────────────
@router.post("/compare")
async def compare(req: CompareReq):
    return await _llm(agent.compare_papers(req.paper_a, req.paper_b))


# ── Chat / Q&A ────────────────────────────────────────────────────────────
@router.post("/chat")
async def chat(req: ChatReq):
    if req.use_rag and rag_count() > 0:
        papers = await run_in_threadpool(rag_query, req.question, 8)
    else:
        papers = _merge([
            await arxiv.search(req.question, 6),
            await scholar.search(req.question, 4),
        ])
        await run_in_threadpool(add_papers, papers)
    answer = await _llm(agent.answer_question(req.question, papers))
    return {"answer": answer, "sources": papers[:6]}


# ── Research Roadmap ──────────────────────────────────────────────────────
@router.post("/roadmap")
async def roadmap(req: TopicReq):
    papers = await _topic_papers(req.topic, 8, 6, top_up=False)
    repos = await github.search(req.topic, max_results=6)
    result = await _llm(agent.generate_roadmap(req.topic, papers))
    await run_in_threadpool(save_report, req.topic, "roadmap", json.dumps(result), repos=repos, papers=papers)
    return {"roadmap": result, "papers": papers, "repos": repos}


# ── History / Reports ─────────────────────────────────────────────────────
@router.get("/reports")
def reports():
    return get_reports()

@router.get("/reports/{rid}")
def report(rid: str):
    r = get_report_by_id(rid)
    if not r:
        raise HTTPException(404, "Not found")
    return r

@router.get("/searches")
def searches():
    return get_searches()

@router.get("/rag/count")
def rag_size():
    return {"count": rag_count()}


# ── Neo4j Database & Graph Intelligence Endpoints ─────────────────────────
@router.get("/db/stats")
@router.get("/graph/stats")
def db_stats():
    """Returns database telemetry, node counts, and relationship metrics."""
    return get_neo4j_stats()

@router.get("/graph/explore")
def explore_graph(topic: Optional[str] = Query(default="", description="Topic to filter graph nodes"),
                  limit: int = Query(default=30, ge=1, le=100)):
    """Returns graph nodes and links queried directly from Neo4j."""
    return fetch_neo4j_subgraph(topic=topic, limit=limit)


# ── Polyglot NoSQL status (Neo4j graph store + MongoDB document store) ─────
@router.get("/neo4j/status")
def neo4j_status():
    from app.db.knowledge_graph import get_neo4j_status
    return get_neo4j_status()

@router.get("/mongodb/status")
def mongodb_status():
    from app.db.mongo_client import get_mongo_stats
    return get_mongo_stats()

@router.get("/nosql/status")
def nosql_status():
    from app.db.knowledge_graph import get_neo4j_status
    from app.db.mongo_client import get_mongo_stats
    return {
        "architecture": "Polyglot NoSQL Architecture",
        "graph_store": {
            "engine": "Neo4j",
            "role": "Citation networks, authorship, topics, repositories, models and datasets",
            **get_neo4j_status(),
        },
        "document_store": {
            "engine": "MongoDB",
            "role": "Search and report documents, paper metadata and chat history",
            **get_mongo_stats(),
        },
    }


@router.get("/neo4j/graph/{topic:path}")
def neo4j_topic_graph(topic: str):
    graph = get_topic_graph(topic)
    if not graph or not graph.get("nodes"):
        raise HTTPException(404, f"No graph found in Neo4j for topic: {topic}")
    return graph


# ── Hugging Face Hub connector ────────────────────────────────────────────
@router.get("/hf/models")
async def hf_models(query: str = Query(..., min_length=1), limit: int = Query(default=8, ge=1, le=50)):
    return await hf.search_models(query, limit)

@router.get("/hf/datasets")
async def hf_datasets(query: str = Query(..., min_length=1), limit: int = Query(default=8, ge=1, le=50)):
    return await hf.search_datasets(query, limit)


# ── Full-text PDF RAG ─────────────────────────────────────────────────────
def _pdf_error(e: ValueError) -> HTTPException:
    return HTTPException(413 if isinstance(e, PDFTooLarge) else 400, str(e))

async def _load_pdf(data: bytes, filename: str) -> dict:
    try:
        info = await run_in_threadpool(pdf_store.add_pdf_bytes, data, filename)
    except ValueError as e:
        raise _pdf_error(e)
    return {"success": True, "info": info, "stats": pdf_store.get_stats()}

@router.post("/pdf/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported")
    data = await file.read(max_pdf_bytes() + 1)  # one byte over the cap is enough to reject it
    if len(data) > max_pdf_bytes():
        raise HTTPException(413, f"The PDF is larger than the {max_pdf_bytes() // 1048576} MB limit.")
    return await _load_pdf(data, file.filename)

@router.post("/pdf/fetch_arxiv")
async def fetch_arxiv_pdf(req: ArxivPdfReq):
    try:
        data = await download_arxiv_pdf(req.arxiv_id)
    except ValueError as e:
        raise _pdf_error(e)
    if not data:
        raise HTTPException(404, f"Could not fetch the PDF for arXiv id {req.arxiv_id}")
    return await _load_pdf(data, arxiv_pdf_filename(req.arxiv_id))

@router.post("/pdf/chat")
async def chat_pdf(req: PdfChatReq):
    chunks = await run_in_threadpool(pdf_store.search, req.question, 6)
    if not chunks:
        return {"answer": "No relevant sections found in the loaded PDF(s). Load a PDF first or try another question.",
                "chunks": []}
    try:
        answer = await answer_pdf_question(req.question, chunks)
    except LLMError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, f"The language model request failed ({type(e).__name__}).")
    return {"answer": answer,
            "chunks": [{"page": c["page"], "paper": c["paper"], "text": c["text"][:300]} for c in chunks]}

@router.get("/pdf/status")
def pdf_status():
    return pdf_store.get_stats()

@router.delete("/pdf/clear")
def clear_pdfs():
    pdf_store.clear()
    return {"success": True, "stats": pdf_store.get_stats()}


# ── NetworkX centrality analytics over the Neo4j citation graph ───────────
@router.get("/graph/analytics")
def graph_analytics(topic: Optional[str] = Query(default=None),
                    metric: str = Query(default="pagerank", pattern="^(pagerank|betweenness|degree|authority)$"),
                    limit: int = Query(default=30, ge=1, le=200)):
    """PageRank, betweenness, degree, HITS and communities. Runs in the threadpool (plain def route)."""
    from app.analytics.graph_analytics import compute_graph_analytics
    return compute_graph_analytics(topic=topic or None, metric=metric, limit=limit)

@router.post("/graph/sync_metrics")
def graph_sync_metrics():
    """Store the NetworkX scores on Paper nodes as nx_pagerank and nx_betweenness."""
    from app.analytics.graph_analytics import write_metrics_to_neo4j
    return write_metrics_to_neo4j()


# ── Neo4j Explicit CRUD Endpoints ──────────────────────────────────────────
class CreatePaperReq(BaseModel):
    id: Optional[str] = None
    arxiv_id: Optional[str] = None
    title: str
    abstract: Optional[str] = ""
    year: Optional[str] = ""
    citations: Optional[int] = 0
    url: Optional[str] = ""
    authors: Optional[list] = []
    topic: Optional[str] = ""

class UpdateCitationsReq(BaseModel):
    paper_id: str
    citations: int

@router.post("/db/crud/create")
def crud_create_paper(req: CreatePaperReq):
    from app.db.crud import create_paper_node
    try:
        created = create_paper_node(req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not created:
        raise HTTPException(status_code=503, detail="Neo4j is not connected")
    return created

# :path so ids that are URLs (http://arxiv.org/abs/...) can be addressed
@router.get("/db/crud/read/{paper_id:path}")
def crud_read_paper(paper_id: str):
    from app.db.crud import read_paper_node
    paper = read_paper_node(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found in Neo4j")
    return paper

@router.put("/db/crud/update")
def crud_update_paper(req: UpdateCitationsReq):
    from app.db.crud import update_paper_citations
    try:
        res = update_paper_citations(req.paper_id, req.citations)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not res:
        raise HTTPException(status_code=404, detail="Paper not found to update")
    return res

@router.delete("/db/crud/delete/{paper_id:path}")
def crud_delete_paper(paper_id: str):
    from app.db.crud import delete_paper_node
    return delete_paper_node(paper_id)


# ── Neo4j Graph Domain Queries & EXPLAIN Endpoints ────────────────────────
class ExplainReq(BaseModel):
    query: str
    params: Optional[dict] = None

@router.get("/db/queries/coauthorship")
def query_coauthorship(min_collab: int = Query(default=1, ge=1), limit: int = Query(default=10, ge=1, le=100)):
    """Finds collaborative researcher networks and co-authors."""
    from app.db.queries import get_coauthorship_network
    return {"results": get_coauthorship_network(min_collaborations=min_collab, limit=limit)}

@router.get("/db/queries/paper-code")
def query_paper_code(topic: Optional[str] = Query(default=None), limit: int = Query(default=10, ge=1, le=100)):
    """Matches academic papers with verified GitHub repositories."""
    from app.db.queries import get_paper_code_matching
    return {"results": get_paper_code_matching(topic_name=topic, limit=limit)}

@router.get("/db/queries/indegree-centrality")
def query_indegree_centrality(limit: int = Query(default=8, ge=1, le=50)):
    """Ranks landmark papers by in-degree citation count within the graph."""
    from app.db.queries import get_indegree_centrality
    return {"results": get_indegree_centrality(limit=limit)}

@router.get("/db/queries/topic-distribution")
def query_topic_distribution():
    """Aggregates paper counts, total citations, and average impact per topic."""
    from app.db.queries import get_topic_citation_distribution
    return {"results": get_topic_citation_distribution()}

@router.get("/db/queries/author-productivity")
def query_author_productivity(limit: int = Query(default=8, ge=1, le=50)):
    """Aggregates and ranks authors by publication volume and citation impact."""
    from app.db.queries import get_author_productivity_ranking
    return {"results": get_author_productivity_ranking(limit=limit)}

@router.get("/db/queries/research-gaps")
def query_research_gaps(topic_a: str = Query(..., description="First topic"), topic_b: str = Query(..., description="Second topic")):
    """Evaluates cross-citation density between two fields to spot research gaps."""
    from app.db.queries import get_cross_topic_research_gaps
    return get_cross_topic_research_gaps(topic_a=topic_a, topic_b=topic_b)

@router.post("/db/queries/explain")
def query_explain(req: ExplainReq):
    """Executes an EXPLAIN query plan to inspect index lookups and performance."""
    from app.db.queries import explain_query
    res = explain_query(req.query, req.params)
    if not res.get("has_plan"):
        raise HTTPException(status_code=503 if res.get("offline") else 400, detail=res.get("error"))
    return res




# ── Subgraph Export (JSON / CSV downloads) ────────────────────────────────
def _subgraph(scope, topic, paper_id, depth, limit):
    from app.db.queries import get_export_subgraph
    return get_export_subgraph(scope=scope, topic=topic, paper_id=paper_id, depth=depth, limit=limit)

def _download(body: str, media_type: str, filename: str) -> Response:
    return Response(body, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

@router.get("/graph/export/json")
def export_subgraph_json(scope: str = Query(default="citations", pattern="^(citations|authors|topic)$"),
                         topic: str = Query(default=""), paper_id: str = Query(default=""),
                         depth: int = Query(default=2, ge=1, le=3),
                         limit: int = Query(default=200, ge=1, le=1000)):
    """Exports citation paths, an author network or a whole topic subgraph as JSON."""
    data = _subgraph(scope, topic, paper_id, depth, limit)
    return _download(json.dumps(data, indent=2, default=str), "application/json",
                     f"subgraph_{scope}_{depth}hop.json")

@router.get("/graph/export/csv")
def export_subgraph_csv(scope: str = Query(default="citations", pattern="^(citations|authors|topic)$"),
                        topic: str = Query(default=""), paper_id: str = Query(default=""),
                        depth: int = Query(default=2, ge=1, le=3),
                        limit: int = Query(default=200, ge=1, le=1000),
                        table: str = Query(default="edges", pattern="^(edges|nodes)$")):
    """Same subgraph as a flat CSV, either an edge list or a node table."""
    data = _subgraph(scope, topic, paper_id, depth, limit)
    buf = io.StringIO()
    if table == "nodes":
        writer = csv.DictWriter(buf, fieldnames=["id", "label", "type", "year", "citations", "stars", "url"],
                                extrasaction="ignore")
        writer.writeheader()
        writer.writerows(data["nodes"])
    else:
        labels = {n["id"]: n["label"] for n in data["nodes"]}
        writer = csv.writer(buf)
        writer.writerow(["source", "source_label", "relation", "target", "target_label"])
        for l in data["links"]:
            writer.writerow([l["source"], labels.get(l["source"], ""), l["relation"],
                             l["target"], labels.get(l["target"], "")])
    return _download(buf.getvalue(), "text/csv", f"subgraph_{scope}_{depth}hop_{table}.csv")
