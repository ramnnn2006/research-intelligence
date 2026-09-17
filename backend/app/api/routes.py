from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from app.mcp.arxiv import ArxivMCP
from app.mcp.semantic_scholar import SemanticScholarMCP
from app.mcp.github import GitHubMCP
from app.services.graph import build_knowledge_graph, build_citation_graph, fetch_neo4j_subgraph
from app.rag.vectorstore import add_papers, query as rag_query, count as rag_count
from app.agents import research_agent as agent
from app.db.database import (
    save_report, save_search, get_reports, get_searches,
    get_report_by_id, get_neo4j_stats
)

router = APIRouter(prefix="/api")

arxiv   = ArxivMCP()
scholar = SemanticScholarMCP()
github  = GitHubMCP()


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


# ── Helpers ───────────────────────────────────────────────────────────────
def _merge(lists):
    seen, out = set(), []
    for p in (p for lst in lists for p in lst):
        k = (p.get("title") or "").lower()[:60]
        if k and k not in seen:
            seen.add(k); out.append(p)
    return out


# ── Search ────────────────────────────────────────────────────────────────
@router.post("/search")
async def search(req: SearchReq):
    arxiv_res, scholar_res, gh_res = [], [], []
    if "arxiv" in req.sources:
        arxiv_res = await arxiv.search(req.query, req.max_results)
    if "semantic_scholar" in req.sources:
        scholar_res = await scholar.search(req.query, req.max_results)
    # Always fetch GitHub repos regardless of sources toggle
    gh_res = await github.search(req.query, max_results=8)

    papers = _merge([arxiv_res, scholar_res])
    add_papers(papers)
    save_search(req.query, papers, gh_res)

    graph = build_knowledge_graph(req.query, papers, gh_res)
    return {
        "papers": papers, "repos": gh_res,
        "graph": graph, "total": len(papers), "rag_count": rag_count()
    }


# ── Citation Network ──────────────────────────────────────────────────────
@router.post("/citations")
async def get_citations(req: CitationReq):
    data = await scholar.get_citations(req.title)
    graph = build_citation_graph(req.title, data)
    return {"data": data, "graph": graph}


# ── Literature Review ─────────────────────────────────────────────────────
@router.post("/review")
async def literature_review(req: TopicReq):
    papers = _merge([
        await arxiv.search(req.topic, 10),
        await scholar.search(req.topic, 8),
    ])
    repos = await github.search(req.topic, max_results=6)
    add_papers(papers)
    review = await agent.generate_literature_review(req.topic, papers)
    save_report(req.topic, "literature_review", review, repos=repos, papers=papers[:10])
    return {"review": review, "papers": papers[:10], "repos": repos}


# ── Literature Survey ─────────────────────────────────────────────────────
@router.post("/survey")
async def survey(req: TopicReq):
    papers = _merge([
        await arxiv.search(req.topic, 10),
        await scholar.search(req.topic, 8),
    ])
    repos = await github.search(req.topic, max_results=6)
    add_papers(papers)
    result = await agent.generate_survey(req.topic, papers)
    graph  = build_knowledge_graph(req.topic, papers, repos)
    save_report(req.topic, "survey", str(result), repos=repos, papers=papers[:10])
    return {"survey": result, "papers": papers[:10], "repos": repos, "graph": graph}


# ── Research Gaps ─────────────────────────────────────────────────────────
@router.post("/gaps")
async def gaps(req: TopicReq):
    papers = _merge([
        await arxiv.search(req.topic, 10),
        await scholar.search(req.topic, 8),
    ])
    repos = await github.search(req.topic, max_results=6)
    add_papers(papers)
    result = await agent.detect_research_gaps(req.topic, papers)
    save_report(req.topic, "gaps", str(result), repos=repos, papers=papers)
    return {"gaps": result, "papers_analysed": len(papers), "repos": repos}


# ── Compare Papers ────────────────────────────────────────────────────────
@router.post("/compare")
async def compare(req: CompareReq):
    return await agent.compare_papers(req.paper_a, req.paper_b)


# ── Chat / Q&A ────────────────────────────────────────────────────────────
@router.post("/chat")
async def chat(req: ChatReq):
    if req.use_rag and rag_count() > 0:
        papers = rag_query(req.question, n_results=8)
    else:
        papers = _merge([
            await arxiv.search(req.question, 6),
            await scholar.search(req.question, 4),
        ])
        add_papers(papers)
    answer = await agent.answer_question(req.question, papers)
    return {"answer": answer, "sources": papers[:6]}


# ── Research Roadmap ──────────────────────────────────────────────────────
@router.post("/roadmap")
async def roadmap(req: TopicReq):
    papers = _merge([
        await arxiv.search(req.topic, 8),
        await scholar.search(req.topic, 6),
    ])
    repos = await github.search(req.topic, max_results=6)
    add_papers(papers)
    result = await agent.generate_roadmap(req.topic, papers)
    save_report(req.topic, "roadmap", str(result), repos=repos, papers=papers)
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
    return create_paper_node(req.model_dump())

@router.get("/db/crud/read/{paper_id}")
def crud_read_paper(paper_id: str):
    from app.db.crud import read_paper_node
    paper = read_paper_node(paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found in Neo4j")
    return paper

@router.put("/db/crud/update")
def crud_update_paper(req: UpdateCitationsReq):
    from app.db.crud import update_paper_citations
    res = update_paper_citations(req.paper_id, req.citations)
    if not res:
        raise HTTPException(status_code=404, detail="Paper not found to update")
    return res

@router.delete("/db/crud/delete/{paper_id}")
def crud_delete_paper(paper_id: str):
    from app.db.crud import delete_paper_node
    return delete_paper_node(paper_id)

