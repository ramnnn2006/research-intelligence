import logging
from typing import Dict, Any, Optional, List
from app.db.neo4j_client import get_neo4j_client

logger = logging.getLogger("research_iq.crud")

def create_paper_node(paper_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    CRUD - Create: Insert a new Paper node, merge Author and Topic nodes,
    and link them via :AUTHORED and :BELONGS_TO relationships.
    """
    client = get_neo4j_client()
    pid = paper_data.get("id") or paper_data.get("arxiv_id")
    if not pid:
        raise ValueError("Paper must have a valid 'id' or 'arxiv_id'.")

    cypher = """
    MERGE (p:Paper {id: $id})
    ON CREATE SET
        p.arxiv_id = $arxiv_id,
        p.title = $title,
        p.abstract = $abstract,
        p.year = $year,
        p.citations = $citations,
        p.url = $url,
        p.source = $source,
        p.created_at = datetime()
    ON MATCH SET
        p.citations = $citations,
        p.updated_at = datetime()
    WITH p
    FOREACH (author_name IN $authors |
        MERGE (a:Author {name: author_name})
        MERGE (a)-[:AUTHORED]->(p)
    )
    WITH p
    FOREACH (topic_name IN CASE WHEN $topic IS NOT NULL AND $topic <> '' THEN [$topic] ELSE [] END |
        MERGE (t:Topic {name: topic_name})
        MERGE (p)-[:BELONGS_TO]->(t)
    )
    RETURN p.id AS id, p.title AS title, p.citations AS citations, p.year AS year
    """
    params = {
        "id": str(pid),
        "arxiv_id": paper_data.get("arxiv_id"),
        "title": str(paper_data.get("title", "")),
        "abstract": str(paper_data.get("abstract", "")),
        "year": str(paper_data.get("year", "")),
        "citations": int(paper_data.get("citations", 0)),
        "url": str(paper_data.get("url", "")),
        "source": str(paper_data.get("source", "manual_entry")),
        "authors": [str(a).strip() for a in paper_data.get("authors", []) if str(a).strip()],
        "topic": paper_data.get("topic", "")
    }
    records = client.execute_write(cypher, params)
    return records[0] if records else {}


def read_paper_node(paper_id: str) -> Optional[Dict[str, Any]]:
    """
    CRUD - Read: Query a Paper node by ID and return its full graph context
    including connected Authors, Topic, Citing Papers, and Repositories.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (p:Paper {id: $pid})
    OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
    OPTIONAL MATCH (p)-[:BELONGS_TO]->(t:Topic)
    OPTIONAL MATCH (r:Repository)-[:IMPLEMENTS]->(p)
    OPTIONAL MATCH (citing:Paper)-[:CITES]->(p)
    WITH p, t,
         collect(DISTINCT a.name) AS authors,
         collect(DISTINCT {name: r.name, url: r.url, stars: r.stars}) AS repos,
         count(DISTINCT citing) AS in_degree
    RETURN {
        id: p.id,
        arxiv_id: p.arxiv_id,
        title: p.title,
        abstract: p.abstract,
        year: p.year,
        citations: p.citations,
        url: p.url,
        source: p.source,
        topic: t.name,
        authors: authors,
        repositories: repos,
        in_degree_citations: in_degree
    } AS paper
    """
    records = client.execute_read(cypher, {"pid": str(paper_id)})
    return records[0]["paper"] if records and records[0].get("paper") and records[0]["paper"].get("title") else None


def update_paper_citations(paper_id: str, new_citations: int) -> Optional[Dict[str, Any]]:
    """
    CRUD - Update: Update citation metrics and timestamp for an existing Paper node.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (p:Paper {id: $pid})
    SET p.citations = $citations,
        p.updated_at = datetime()
    RETURN p.id AS id, p.title AS title, p.citations AS citations, toString(p.updated_at) AS updated_at
    """
    records = client.execute_write(cypher, {"pid": str(paper_id), "citations": int(new_citations)})
    return records[0] if records else None


def delete_paper_node(paper_id: str) -> Dict[str, Any]:
    """
    CRUD - Delete: Safely detach and remove a Paper node and all its incoming/outgoing
    relationships without leaving orphaned pointers in Neo4j.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (p:Paper {id: $pid})
    WITH p, p.title AS title
    DETACH DELETE p
    RETURN count(p) AS deleted_count, title AS deleted_title
    """
    records = client.execute_write(cypher, {"pid": str(paper_id)})
    return records[0] if records else {"deleted_count": 0, "deleted_title": None}
