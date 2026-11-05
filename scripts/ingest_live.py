import os
import sys
import asyncio
import logging
from typing import List, Dict, Any

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.db.neo4j_client import get_neo4j_client, init_neo4j_schema
from app.db.database import save_search, save_report, get_neo4j_stats
from app.db.ids import canonical_paper_id, arxiv_id_from
from app.mcp.arxiv import ArxivMCP
from app.mcp.semantic_scholar import SemanticScholarMCP
from app.mcp.github import GitHubMCP

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ingest_live")

TOPICS = [
    "Attention Mechanism Transformer",
    "Large Language Models",
    "Graph Neural Networks",
    "Diffusion Models",
    "Retrieval Augmented Generation",
    "Deep Reinforcement Learning"
]

def merge_papers(lists: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Dedupe by title, keeping a citation count from a later source if the first copy has none."""
    seen: Dict[str, Dict[str, Any]] = {}
    out = []
    for lst in lists:
        for p in lst:
            k = (p.get("title") or "").strip().lower()[:60]
            if not k:
                continue
            if k in seen:
                if (p.get("citations") or 0) > (seen[k].get("citations") or 0):
                    seen[k]["citations"] = p["citations"]
                continue
            seen[k] = p
            out.append(p)
    return out


def citation_stub(cited: Dict[str, Any]) -> Dict[str, Any]:
    """Paper row for a Semantic Scholar citing paper, keyed like every other Paper node."""
    ext = cited.get("externalIds") or {}
    stub = {
        "arxiv_id": ext.get("ArXiv") or "",
        "doi": ext.get("DOI") or "",
        "url": cited.get("url") or "",
        "title": cited.get("title") or "",
    }
    if not (stub["arxiv_id"] or stub["url"] or stub["doi"]) and cited.get("paperId"):
        stub["url"] = f"https://www.semanticscholar.org/paper/{cited['paperId']}"
    pid = canonical_paper_id(stub)
    year = cited.get("year")
    return {
        "id": pid,
        "arxiv_id": arxiv_id_from(pid) or None,
        "title": stub["title"][:250],
        "year": str(year) if year else "",
        "citations": int(cited.get("citationCount") or 0),
        "url": stub["url"] or pid,
        "authors": [a.get("name") for a in (cited.get("authors") or [])[:5] if a.get("name")],
    }

async def ingest_topic(topic: str, arxiv: ArxivMCP, scholar: SemanticScholarMCP, github: GitHubMCP):
    logger.info(f"==> Fetching live data for: '{topic}' from ArXiv, Semantic Scholar & GitHub...")
    
    arxiv_task = arxiv.search(topic, max_results=8)
    scholar_task = scholar.search(topic, max_results=8)
    github_task = github.search(topic, max_results=5)
    
    arxiv_res, scholar_res, gh_res = await asyncio.gather(arxiv_task, scholar_task, github_task)
    papers = merge_papers([arxiv_res, scholar_res])
    logger.info(f"Retrieved {len(papers)} unique real papers and {len(gh_res)} real repositories for '{topic}'.")
    
    # Save search
    search_id = save_search(topic, papers, gh_res)
    
    # Save report
    report_content = f"Automated literature review and citation analysis for research domain: {topic}. Synthesized from {len(papers)} peer-reviewed papers and {len(gh_res)} active open-source implementations."
    report_id = save_report(topic, "Literature Review", report_content, repos=gh_res, papers=papers[:8])
    logger.info(f"Persisted Search '{search_id}' and Report '{report_id}' into Neo4j.")

    # Establish real :CITES edges from Semantic Scholar citation network
    client = get_neo4j_client()
    for paper in papers[:2]:
        title = paper.get("title", "")
        if not title or not client.connect():
            continue
        try:
            pid = canonical_paper_id(paper)
            cit_data = await scholar.get_citations(title)
            stubs = [citation_stub(c) for c in (cit_data.get("citations") or [])[:3] if c.get("title")]
            stubs = [st for st in stubs if st["id"] and st["id"] != pid]
            if stubs:
                client.execute_write("""
                    MATCH (p1:Paper {id: $pid})
                    UNWIND $stubs AS c
                    MERGE (p2:Paper {id: c.id})
                    ON CREATE SET p2.title = c.title, p2.year = c.year, p2.citations = c.citations,
                                  p2.url = c.url, p2.arxiv_id = c.arxiv_id,
                                  p2.source = 'semantic_scholar_citation', p2.created_at = toString(datetime())
                    MERGE (p2)-[:CITES]->(p1)
                    FOREACH (author_name IN c.authors |
                        MERGE (a:Author {name: author_name})
                        MERGE (a)-[:AUTHORED]->(p2)
                    )
                """, {"pid": pid, "stubs": stubs})
        except Exception as e:
            logger.debug(f"Citation edge skip for '{title}': {e}")

async def main():
    logger.info("Connecting to Neo4j and initializing schema...")
    init_neo4j_schema()
    
    client = get_neo4j_client()
    if not client.connect():
        logger.error("Could not connect to Neo4j. Is the container running?")
        sys.exit(1)
        
    logger.info("Connected! Starting live multi-source ingestion pipeline...")
    arxiv = ArxivMCP()
    scholar = SemanticScholarMCP()
    github = GitHubMCP()
    
    for topic in TOPICS:
        await ingest_topic(topic, arxiv, scholar, github)
        await asyncio.sleep(1)
        
    stats = get_neo4j_stats()
    logger.info("\n================ INGESTION COMPLETE ================")
    logger.info(f"Final Live Neo4j Graph Metrics: {stats}")

if __name__ == "__main__":
    asyncio.run(main())
