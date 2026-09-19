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
    seen = set()
    out = []
    for lst in lists:
        for p in lst:
            k = (p.get("title") or "").strip().lower()[:60]
            if k and k not in seen:
                seen.add(k)
                out.append(p)
    return out

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
        if title and client.is_connected():
            try:
                cit_data = await scholar.get_citations(title)
                citations = cit_data.get("citations", [])
                if citations:
                    with client._driver.session(database=client.database) as session:
                        for cited in citations[:3]:
                            cited_title = cited.get("title")
                            if cited_title:
                                session.run("""
                                    MATCH (p1:Paper) WHERE p1.title = $t1
                                    MERGE (p2:Paper {id: $t2_id})
                                    ON CREATE SET p2.title = $t2, p2.source = 'semantic_scholar_citation', p2.citations = 0, p2.created_at = datetime()
                                    MERGE (p2)-[:CITES]->(p1)
                                """, {
                                    "t1": title,
                                    "t2": cited_title,
                                    "t2_id": "cite_" + cited_title.lower()[:40].replace(" ", "_")
                                })
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
