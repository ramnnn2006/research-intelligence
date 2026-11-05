import logging
from typing import Dict, Any, Optional, List
from app.db.neo4j_client import get_neo4j_client
from app.db.ids import canonical_paper_id, arxiv_id_from

logger = logging.getLogger("research_iq.crud")


def _lookup_ids(paper_id: str) -> List[str]:
    """
    Ids to try for a lookup: the value as given and its canonical form, so a
    versioned arXiv URL still finds the versionless node and legacy ids
    (e.g. citation stubs) keep working.
    """
    raw = str(paper_id or "").strip()
    canonical = canonical_paper_id({"id": raw}) if raw else ""
    return list(dict.fromkeys(i for i in (raw, canonical) if i))


# Picks one node when both the raw and the canonical id exist (exact match first).
_MATCH_ONE = """
    MATCH (p:Paper) WHERE p.id IN $ids
    WITH p ORDER BY CASE WHEN p.id = $raw THEN 0 ELSE 1 END
    LIMIT 1
"""

def create_paper_node(paper_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    CRUD - Create: Insert a new Paper node, merge Author and Topic nodes,
    and link them via :AUTHORED and :BELONGS_TO relationships.
    """
    client = get_neo4j_client()
    raw_id = str(paper_data.get("id") or "").strip()
    raw_arxiv = str(paper_data.get("arxiv_id") or "").strip()
    if not (raw_id or raw_arxiv):
        raise ValueError("Paper must have a valid 'id' or 'arxiv_id'.")
    if raw_arxiv and not arxiv_id_from(raw_arxiv):
        raise ValueError(f"'arxiv_id' is not a valid arXiv id: {raw_arxiv[:40]}")
    title = str(paper_data.get("title") or "").strip()
    if not title:
        raise ValueError("Paper must have a non-empty 'title'.")
    try:
        citations = int(paper_data.get("citations") or 0)
    except (TypeError, ValueError):
        raise ValueError("'citations' must be an integer.")
    if citations < 0:
        raise ValueError("'citations' must not be negative.")
    authors = paper_data.get("authors") or []
    if not isinstance(authors, (list, tuple)):
        raise ValueError("'authors' must be a list of names.")
    pid = canonical_paper_id(paper_data)

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
        "id": pid,
        # stored without a version suffix, e.g. 2206.03003
        "arxiv_id": arxiv_id_from(pid) or arxiv_id_from(paper_data.get("arxiv_id")) or None,
        "title": title,
        "abstract": str(paper_data.get("abstract") or ""),
        "year": str(paper_data.get("year") or ""),
        "citations": citations,
        "url": str(paper_data.get("url") or ""),
        "source": str(paper_data.get("source") or "manual_entry"),
        "authors": [str(a).strip() for a in authors if a is not None and str(a).strip()],
        "topic": str(paper_data.get("topic") or "").strip()
    }
    records = client.execute_write(cypher, params)
    return records[0] if records else {}


def read_paper_node(paper_id: str) -> Optional[Dict[str, Any]]:
    """
    CRUD - Read: Query a Paper node by ID and return its full graph context
    including connected Authors, Topic, Citing Papers, and Repositories.
    """
    client = get_neo4j_client()
    cypher = _MATCH_ONE + """
    OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
    OPTIONAL MATCH (p)-[:BELONGS_TO]->(t:Topic)
    OPTIONAL MATCH (r:Repository)-[:IMPLEMENTS]->(p)
    OPTIONAL MATCH (citing:Paper)-[:CITES]->(p)
    WITH p,
         collect(DISTINCT t.name) AS topics,
         collect(DISTINCT a.name) AS authors,
         collect(DISTINCT CASE WHEN r IS NULL THEN null ELSE {name: r.name, url: r.url, stars: r.stars} END) AS repos,
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
        topic: head(topics),
        authors: authors,
        repositories: repos,
        in_degree_citations: in_degree
    } AS paper
    """
    records = client.execute_read(cypher, {"ids": _lookup_ids(paper_id), "raw": str(paper_id or "").strip()})
    return records[0]["paper"] if records and records[0].get("paper") and records[0]["paper"].get("title") else None


def update_paper_citations(paper_id: str, new_citations: int) -> Optional[Dict[str, Any]]:
    """
    CRUD - Update: Update citation metrics and timestamp for an existing Paper node.
    """
    if int(new_citations) < 0:
        raise ValueError("'citations' must not be negative.")
    client = get_neo4j_client()
    cypher = _MATCH_ONE + """
    SET p.citations = $citations,
        p.updated_at = datetime()
    RETURN p.id AS id, p.title AS title, p.citations AS citations, toString(p.updated_at) AS updated_at
    """
    records = client.execute_write(cypher, {"ids": _lookup_ids(paper_id), "raw": str(paper_id or "").strip(),
                                            "citations": int(new_citations)})
    return records[0] if records else None


def delete_paper_node(paper_id: str) -> Dict[str, Any]:
    """
    CRUD - Delete: Safely detach and remove a Paper node and all its incoming/outgoing
    relationships without leaving orphaned pointers in Neo4j.
    """
    client = get_neo4j_client()
    cypher = _MATCH_ONE + """
    WITH p, p.title AS title
    DETACH DELETE p
    RETURN count(p) AS deleted_count, title AS deleted_title
    """
    records = client.execute_write(cypher, {"ids": _lookup_ids(paper_id), "raw": str(paper_id or "").strip()})
    return records[0] if records else {"deleted_count": 0, "deleted_title": None}
