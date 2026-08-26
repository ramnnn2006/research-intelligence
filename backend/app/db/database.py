import json
import uuid
import datetime
import logging
from typing import Dict, List, Optional, Any
from app.db.neo4j_client import get_neo4j_client, init_neo4j_schema

logger = logging.getLogger("research_iq.database")

def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def init_db():
    """Initialize Neo4j database schema, constraints, and indexes."""
    init_neo4j_schema()

def _clean_paper(p: dict) -> dict:
    return {
        "id": str(p.get("id") or p.get("arxiv_id") or p.get("title", "")[:60]),
        "arxiv_id": str(p.get("arxiv_id") or ""),
        "title": str(p.get("title") or "")[:250],
        "abstract": str(p.get("summary") or p.get("abstract") or "")[:3000],
        "year": str(p.get("year") or ""),
        "url": str(p.get("url") or ""),
        "source": str(p.get("source") or "unknown"),
        "citations": int(p.get("citations") or 0),
        "authors": [str(a).strip() for a in (p.get("authors") or []) if str(a).strip()]
    }

def _clean_repo(r: dict) -> dict:
    return {
        "name": str(r.get("name") or "")[:150],
        "url": str(r.get("url") or ""),
        "stars": int(r.get("stars") or 0),
        "description": str(r.get("description") or "")[:500]
    }

# ── Save Search ─────────────────────────────────────────────────────────────
def save_search(query: str, papers: list, repos: list) -> str:
    """
    Persist a search record and connect it to Paper and Repository nodes in Neo4j.
    """
    search_id = str(uuid.uuid4())[:8]
    created_at = _now_iso()
    cleaned_papers = [_clean_paper(p) for p in (papers or [])]
    cleaned_repos = [_clean_repo(r) for r in (repos or []) if r.get("name")]

    client = get_neo4j_client()
    if client.is_connected():
        cypher = """
        CREATE (s:Search {id: $search_id, query: $query, created_at: $created_at})
        WITH s
        UNWIND $papers AS p_data
        MERGE (p:Paper {id: p_data.id})
        ON CREATE SET
            p.arxiv_id = p_data.arxiv_id,
            p.title = p_data.title,
            p.abstract = p_data.abstract,
            p.year = p_data.year,
            p.url = p_data.url,
            p.source = p_data.source,
            p.citations = p_data.citations,
            p.created_at = $created_at
        ON MATCH SET
            p.citations = p_data.citations
        MERGE (s)-[:FOUND_PAPER]->(p)
        WITH s, p, p_data
        FOREACH (author_name IN p_data.authors |
            MERGE (a:Author {name: author_name})
            MERGE (a)-[:AUTHORED]->(p)
        )
        WITH s
        UNWIND $repos AS r_data
        MERGE (r:Repository {name: r_data.name})
        ON CREATE SET
            r.url = r_data.url,
            r.stars = r_data.stars,
            r.description = r_data.description,
            r.created_at = $created_at
        ON MATCH SET
            r.stars = r_data.stars
        MERGE (s)-[:FOUND_REPO]->(r)
        """
        try:
            client.execute_write(cypher, {
                "search_id": search_id,
                "query": query,
                "created_at": created_at,
                "papers": cleaned_papers,
                "repos": cleaned_repos
            })
            return search_id
        except Exception as e:
            logger.error("Failed to save search to Neo4j: %s. Using fallback.", e)

    # Fallback in-memory persistence
    search_entry = {
        "id": search_id,
        "query": query,
        "papers": cleaned_papers,
        "repos": cleaned_repos,
        "created_at": created_at
    }
    client._fallback_store["searches"].insert(0, search_entry)
    return search_id


# ── Save Report ─────────────────────────────────────────────────────────────
def save_report(topic: str, rtype: str, content: str, repos: list = None, papers: list = None) -> str:
    """
    Persist a generated research report and connect it to Topic, Paper, and Repository nodes in Neo4j.
    """
    report_id = str(uuid.uuid4())[:8]
    created_at = _now_iso()
    cleaned_papers = [_clean_paper(p) for p in (papers or [])]
    cleaned_repos = [_clean_repo(r) for r in (repos or []) if r.get("name")]

    client = get_neo4j_client()
    if client.is_connected():
        cypher = """
        CREATE (rep:Report {
            id: $report_id,
            topic: $topic,
            report_type: $report_type,
            content: $content,
            created_at: $created_at
        })
        MERGE (t:Topic {name: $topic})
        MERGE (rep)-[:COVERS_TOPIC]->(t)
        WITH rep, t
        UNWIND $papers AS p_data
        MERGE (p:Paper {id: p_data.id})
        ON CREATE SET
            p.arxiv_id = p_data.arxiv_id,
            p.title = p_data.title,
            p.abstract = p_data.abstract,
            p.year = p_data.year,
            p.url = p_data.url,
            p.source = p_data.source,
            p.citations = p_data.citations,
            p.created_at = $created_at
        MERGE (rep)-[:INCLUDES_PAPER]->(p)
        MERGE (t)-[:HAS_PAPER]->(p)
        WITH rep, p, p_data
        FOREACH (author_name IN p_data.authors |
            MERGE (a:Author {name: author_name})
            MERGE (a)-[:AUTHORED]->(p)
        )
        WITH rep
        UNWIND $repos AS r_data
        MERGE (r:Repository {name: r_data.name})
        ON CREATE SET
            r.url = r_data.url,
            r.stars = r_data.stars,
            r.description = r_data.description,
            r.created_at = $created_at
        MERGE (rep)-[:INCLUDES_REPO]->(r)
        """
        try:
            client.execute_write(cypher, {
                "report_id": report_id,
                "topic": topic,
                "report_type": rtype,
                "content": content,
                "created_at": created_at,
                "papers": cleaned_papers,
                "repos": cleaned_repos
            })
            return report_id
        except Exception as e:
            logger.error("Failed to save report to Neo4j: %s. Using fallback.", e)

    # Fallback in-memory persistence
    report_entry = {
        "id": report_id,
        "topic": topic,
        "report_type": rtype,
        "content": content,
        "repos": cleaned_repos,
        "papers": cleaned_papers,
        "created_at": created_at
    }
    client._fallback_store["reports"].insert(0, report_entry)
    return report_id


# ── Get Reports ─────────────────────────────────────────────────────────────
def get_reports(limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve list of generated reports from Neo4j."""
    client = get_neo4j_client()
    if client.is_connected():
        cypher = """
        MATCH (rep:Report)
        RETURN rep.id AS id, rep.topic AS topic, rep.report_type AS report_type, rep.created_at AS created_at
        ORDER BY rep.created_at DESC
        LIMIT $limit
        """
        try:
            records = client.execute_read(cypher, {"limit": limit})
            return records
        except Exception as e:
            logger.error("Failed to fetch reports from Neo4j: %s", e)

    # Fallback
    return [
        {
            "id": r["id"],
            "topic": r["topic"],
            "report_type": r["report_type"],
            "created_at": r["created_at"]
        }
        for r in client._fallback_store["reports"][:limit]
    ]


# ── Get Searches ────────────────────────────────────────────────────────────
def get_searches(limit: int = 30) -> List[Dict[str, Any]]:
    """Retrieve list of past searches from Neo4j."""
    client = get_neo4j_client()
    if client.is_connected():
        cypher = """
        MATCH (s:Search)
        OPTIONAL MATCH (s)-[:FOUND_REPO]->(repo:Repository)
        WITH s, collect(DISTINCT {
            name: repo.name,
            url: repo.url,
            stars: repo.stars,
            description: repo.description
        }) AS repos
        RETURN s.id AS id, s.query AS query, s.created_at AS created_at,
               [r IN repos WHERE r.name IS NOT NULL] AS repos
        ORDER BY s.created_at DESC
        LIMIT $limit
        """
        try:
            return client.execute_read(cypher, {"limit": limit})
        except Exception as e:
            logger.error("Failed to fetch searches from Neo4j: %s", e)

    # Fallback
    return [
        {
            "id": s["id"],
            "query": s["query"],
            "repos": s.get("repos", []),
            "created_at": s["created_at"]
        }
        for s in client._fallback_store["searches"][:limit]
    ]


# ── Get Report By ID ────────────────────────────────────────────────────────
def get_report_by_id(rid: Any) -> Optional[Dict[str, Any]]:
    """Retrieve a single report and its connected graph sub-entities from Neo4j."""
    client = get_neo4j_client()
    rid_str = str(rid)
    if client.is_connected():
        cypher = """
        MATCH (rep:Report)
        WHERE rep.id = $rid OR toString(rep.id) = $rid
        OPTIONAL MATCH (rep)-[:INCLUDES_PAPER]->(p:Paper)
        OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
        OPTIONAL MATCH (rep)-[:INCLUDES_REPO]->(repo:Repository)
        WITH rep,
             collect(DISTINCT {
                 id: p.id,
                 title: p.title,
                 arxiv_id: p.arxiv_id,
                 url: p.url,
                 year: p.year,
                 citations: p.citations,
                 authors: [(p)<-[:AUTHORED]-(auth:Author) | auth.name]
             }) AS papers,
             collect(DISTINCT {
                 name: repo.name,
                 url: repo.url,
                 stars: repo.stars,
                 description: repo.description
             }) AS repos
        RETURN {
            id: rep.id,
            topic: rep.topic,
            report_type: rep.report_type,
            content: rep.content,
            created_at: rep.created_at,
            papers: [p IN papers WHERE p.title IS NOT NULL],
            repos: [r IN repos WHERE r.name IS NOT NULL]
        } AS report
        """
        try:
            res = client.execute_read(cypher, {"rid": rid_str})
            if res and res[0].get("report"):
                return res[0]["report"]
        except Exception as e:
            logger.error("Failed to fetch report %s from Neo4j: %s", rid, e)

    # Fallback
    for r in client._fallback_store["reports"]:
        if str(r["id"]) == rid_str:
            return r
    return None


# ── Neo4j Graph Intelligence & Analytics ────────────────────────────────────
def get_neo4j_stats() -> Dict[str, Any]:
    """Retrieve node and relationship metrics from Neo4j graph database."""
    client = get_neo4j_client()
    if client.is_connected():
        cypher = """
        CALL {
            MATCH (p:Paper) RETURN count(p) AS papers
        }
        CALL {
            MATCH (a:Author) RETURN count(a) AS authors
        }
        CALL {
            MATCH (r:Repository) RETURN count(r) AS repos
        }
        CALL {
            MATCH (t:Topic) RETURN count(t) AS topics
        }
        CALL {
            MATCH (rep:Report) RETURN count(rep) AS reports
        }
        CALL {
            MATCH (s:Search) RETURN count(s) AS searches
        }
        CALL {
            MATCH ()-[rel]->() RETURN count(rel) AS relationships
        }
        RETURN {
            papers: papers,
            authors: authors,
            repositories: repos,
            topics: topics,
            reports: reports,
            searches: searches,
            total_relationships: relationships,
            database_type: 'Neo4j Graph Database (NoSQL)',
            connected: true
        } AS stats
        """
        try:
            res = client.execute_read(cypher)
            if res and res[0].get("stats"):
                return res[0]["stats"]
        except Exception as e:
            logger.error("Failed to fetch Neo4j graph stats: %s", e)

    # Fallback stats
    return {
        "papers": len(client._fallback_store["papers"]),
        "authors": len(client._fallback_store["authors"]),
        "repositories": len(client._fallback_store["repos"]),
        "topics": len(client._fallback_store["topics"]),
        "reports": len(client._fallback_store["reports"]),
        "searches": len(client._fallback_store["searches"]),
        "total_relationships": len(client._fallback_store["relationships"]),
        "database_type": "Neo4j Graph Database (NoSQL - Fallback Mode)",
        "connected": False
    }
