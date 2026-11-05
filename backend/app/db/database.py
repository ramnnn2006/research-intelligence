import re
import uuid
import datetime
import logging
from typing import Dict, List, Optional, Any
from app.db.neo4j_client import get_neo4j_client, init_neo4j_schema
from app.db.ids import canonical_paper_id, arxiv_id_from

logger = logging.getLogger("research_iq.database")

def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def init_db():
    """Initialize Neo4j database schema, constraints, and indexes."""
    init_neo4j_schema()

def _clean_paper(p: dict) -> dict:
    pid = canonical_paper_id(p)
    return {
        "id": pid,
        # versionless, e.g. 2206.03003 (None for non-arXiv papers)
        "arxiv_id": arxiv_id_from(pid) or arxiv_id_from(p.get("arxiv_id")) or None,
        "title": str(p.get("title") or "")[:250],
        "abstract": str(p.get("summary") or p.get("abstract") or "")[:3000],
        "year": str(p.get("year") or ""),
        "url": str(p.get("url") or p.get("id") or pid or ""),
        "source": str(p.get("source") or "unknown"),
        "citations": int(p.get("citations") or 0),
        "authors": [str(a).strip() for a in (p.get("authors") or []) if a is not None and str(a).strip()]
    }

def _clean_repo(r: dict) -> dict:
    return {
        "name": str(r.get("name") or "")[:150],
        "url": str(r.get("url") or ""),
        "stars": int(r.get("stars") or 0),
        "description": str(r.get("description") or "")[:500]
    }

def _clean_inputs(papers: list, repos: list):
    cleaned_papers = [c for c in (_clean_paper(p) for p in (papers or [])) if c["id"]]
    cleaned_repos = [_clean_repo(r) for r in (repos or []) if r.get("name")]
    return cleaned_papers, cleaned_repos

def _implements_links(papers: List[dict], repos: List[dict]) -> List[Dict[str, str]]:
    """(repo, paper) pairs where the repo's name, description or url mentions the paper's arXiv id."""
    links = []
    for r in repos:
        haystack = " ".join((r["name"], r["description"], r["url"])).lower()
        for p in papers:
            aid = (p.get("arxiv_id") or "").lower()
            # 2206.03003 must not match inside 2206.030031 or 12206.03003
            if aid and re.search(r"(?<![\w.])" + re.escape(aid) + r"(?!\d)", haystack):
                links.append({"repo": r["name"], "paper": p["id"]})
    return links

def _topics(name: str) -> List[str]:
    name = (name or "").strip()
    return [name] if name else []

# Shared Cypher for upserting a paper row (p_data) and its authors and topic.
# Citation counts only move when the source actually reported one: arXiv
# results carry no count and must not reset a known value to 0.
_PAPER_UPSERT = """
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
        p.citations = CASE WHEN p_data.citations > 0 THEN p_data.citations ELSE p.citations END,
        p.arxiv_id = coalesce(p.arxiv_id, p_data.arxiv_id),
        p.abstract = CASE WHEN coalesce(p.abstract, '') = '' THEN p_data.abstract ELSE p.abstract END
    FOREACH (topic_name IN $topics |
        MERGE (t:Topic {name: topic_name})
        MERGE (p)-[:BELONGS_TO]->(t)
    )
    FOREACH (author_name IN p_data.authors |
        MERGE (a:Author {name: author_name})
        MERGE (a)-[:AUTHORED]->(p)
    )
"""

_REPO_UPSERT = """
    MERGE (r:Repository {name: r_data.name})
    ON CREATE SET
        r.url = r_data.url,
        r.stars = r_data.stars,
        r.description = r_data.description,
        r.created_at = $created_at
    ON MATCH SET
        r.stars = r_data.stars
    FOREACH (topic_name IN $topics |
        MERGE (t:Topic {name: topic_name})
        MERGE (t)-[:HAS_IMPLEMENTATION]->(r)
    )
"""

_IMPLEMENTS_LINKS = """
CALL {
    UNWIND $implements AS link
    MATCH (r:Repository {name: link.repo}), (p:Paper {id: link.paper})
    MERGE (r)-[:IMPLEMENTS]->(p)
    RETURN count(*) AS links_saved
}
"""

# ── Save Search ─────────────────────────────────────────────────────────────
def save_search(query: str, papers: list, repos: list) -> str:
    """
    Persist a search record and connect it to Paper and Repository nodes in Neo4j.
    The query doubles as a Topic: papers get (:Paper)-[:BELONGS_TO]->(:Topic) and
    repos get (:Topic)-[:HAS_IMPLEMENTATION]->(:Repository).
    """
    search_id = str(uuid.uuid4())[:8]
    created_at = _now_iso()
    cleaned_papers, cleaned_repos = _clean_inputs(papers, repos)

    client = get_neo4j_client()
    if client.connect():
        # papers, repos and links are written in separate subqueries that each
        # return one row, so an empty paper list no longer drops the repos
        cypher = """
        CREATE (s:Search {id: $search_id, query: $query, created_at: $created_at})
        FOREACH (topic_name IN $topics | MERGE (:Topic {name: topic_name}))
        WITH s
        CALL {
            WITH s
            UNWIND $papers AS p_data
        """ + _PAPER_UPSERT + """
            MERGE (s)-[:FOUND_PAPER]->(p)
            RETURN count(p) AS papers_saved
        }
        CALL {
            WITH s
            UNWIND $repos AS r_data
        """ + _REPO_UPSERT + """
            MERGE (s)-[:FOUND_REPO]->(r)
            RETURN count(r) AS repos_saved
        }
        """ + _IMPLEMENTS_LINKS + """
        RETURN papers_saved, repos_saved, links_saved
        """
        try:
            client.execute_write(cypher, {
                "search_id": search_id,
                "query": query,
                "topics": _topics(query),
                "created_at": created_at,
                "papers": cleaned_papers,
                "repos": cleaned_repos,
                "implements": _implements_links(cleaned_papers, cleaned_repos),
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
    cleaned_papers, cleaned_repos = _clean_inputs(papers, repos)

    client = get_neo4j_client()
    if client.connect():
        cypher = """
        CREATE (rep:Report {
            id: $report_id,
            topic: $topic,
            report_type: $report_type,
            content: $content,
            created_at: $created_at
        })
        FOREACH (topic_name IN $topics |
            MERGE (t:Topic {name: topic_name})
            MERGE (rep)-[:COVERS_TOPIC]->(t)
        )
        WITH rep
        CALL {
            WITH rep
            UNWIND $papers AS p_data
        """ + _PAPER_UPSERT + """
            MERGE (rep)-[:INCLUDES_PAPER]->(p)
            RETURN count(p) AS papers_saved
        }
        CALL {
            WITH rep
            UNWIND $repos AS r_data
        """ + _REPO_UPSERT + """
            MERGE (rep)-[:INCLUDES_REPO]->(r)
            RETURN count(r) AS repos_saved
        }
        """ + _IMPLEMENTS_LINKS + """
        RETURN papers_saved, repos_saved, links_saved
        """
        try:
            client.execute_write(cypher, {
                "report_id": report_id,
                "topic": topic,
                "topics": _topics(topic),
                "report_type": rtype,
                "content": content,
                "created_at": created_at,
                "papers": cleaned_papers,
                "repos": cleaned_repos,
                "implements": _implements_links(cleaned_papers, cleaned_repos),
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
    if client.connect():
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
    if client.connect():
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
    if client.connect():
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
    if client.connect():
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
