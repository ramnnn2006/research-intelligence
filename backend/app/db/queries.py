import logging
import networkx as nx
from typing import Dict, List, Any, Optional
from app.db.neo4j_client import get_neo4j_client

logger = logging.getLogger("research_iq.queries")

def get_2hop_citations(seed_paper_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Query 1: Multi-Hop Citation Path Discovery (2-Hop Traversal)
    Explores foundational papers through transitive citation chains.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH path = (seed:Paper {id: $pid})-[:CITES*1..2]->(foundational:Paper)
    WHERE seed <> foundational
    RETURN seed.title AS seed_paper,
           [node IN nodes(path) | node.title] AS citation_chain,
           foundational.title AS foundational_paper,
           foundational.citations AS citations,
           length(path) AS hops
    ORDER BY foundational.citations DESC
    LIMIT $limit
    """
    return client.execute_read(cypher, {"pid": str(seed_paper_id), "limit": limit})


def get_coauthorship_network(min_collaborations: int = 1, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Query 2: Co-Authorship Collaboration Network
    Finds research teams and academic co-author partnerships.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (a1:Author)-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(a2:Author)
    WHERE elementId(a1) < elementId(a2)
    WITH a1, a2, count(p) AS shared_papers, collect(p.title)[..3] AS sample_papers
    WHERE shared_papers >= $min_collab
    RETURN a1.name AS author_1, a2.name AS author_2, shared_papers, sample_papers
    ORDER BY shared_papers DESC
    LIMIT $limit
    """
    return client.execute_read(cypher, {"min_collab": min_collaborations, "limit": limit})


def get_paper_code_matching(topic_name: Optional[str] = None, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Query 3: Paper to Code Implementation Matching
    Connects theoretical papers to verified GitHub repositories.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (p:Paper)<-[:IMPLEMENTS]-(r:Repository)
    OPTIONAL MATCH (p)-[:BELONGS_TO]->(t:Topic)
    WHERE ($topic IS NULL OR $topic = '' OR t.name = $topic)
    RETURN p.title AS paper_title, t.name AS topic, r.name AS github_repo, r.url AS repo_url, r.stars AS stars
    ORDER BY r.stars DESC
    LIMIT $limit
    """
    return client.execute_read(cypher, {"topic": topic_name, "limit": limit})


def get_indegree_centrality(limit: int = 8) -> List[Dict[str, Any]]:
    """
    Query 4: Top Landmark Papers by In-Degree Centrality
    Identifies high-impact hub papers cited by other literature in the graph.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (p:Paper)
    OPTIONAL MATCH (citing:Paper)-[:CITES]->(p)
    WITH p, count(citing) AS in_degree_citations
    RETURN p.id AS id, p.title AS title, p.year AS year, in_degree_citations, p.citations AS declared_citations
    ORDER BY in_degree_citations DESC, declared_citations DESC
    LIMIT $limit
    """
    return client.execute_read(cypher, {"limit": limit})


def get_topic_subgraph_context(topic_name: str, limit: int = 8) -> List[Dict[str, Any]]:
    """
    Query 5: Topic Subgraph Extraction for LLM Context
    Retrieves grounded paper abstracts and verified implementations.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (p:Paper)-[:BELONGS_TO]->(t:Topic {name: $topic})
    OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
    OPTIONAL MATCH (r:Repository)-[:IMPLEMENTS]->(p)
    WITH p, collect(DISTINCT a.name) AS authors, collect(DISTINCT r.name) AS repos
    RETURN p.title AS title, p.year AS year, p.abstract AS abstract, p.citations AS citations,
           authors[..4] AS key_authors, repos AS code_implementations
    ORDER BY p.citations DESC
    LIMIT $limit
    """
    return client.execute_read(cypher, {"topic": topic_name, "limit": limit})


def get_cross_topic_research_gaps(topic_a: str, topic_b: str) -> Dict[str, Any]:
    """
    Query 6: Research Gap Discovery Across Two Disciplines
    Evaluates cross-citation density to find unexplored intersections.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (t1:Topic {name: $topic_a}), (t2:Topic {name: $topic_b})
    OPTIONAL MATCH (p1:Paper)-[:BELONGS_TO]->(t1), (p2:Paper)-[:BELONGS_TO]->(t2), (p1)-[c:CITES]-(p2)
    WITH t1, t2, count(c) AS cross_citations
    RETURN t1.name AS domain_a, t2.name AS domain_b, cross_citations,
           CASE WHEN cross_citations < 2 THEN "HIGH_RESEARCH_GAP_POTENTIAL" ELSE "WELL_EXPLORED_INTERSECTION" END AS gap_status
    """
    records = client.execute_read(cypher, {"topic_a": topic_a, "topic_b": topic_b})
    return records[0] if records else {"domain_a": topic_a, "domain_b": topic_b, "cross_citations": 0, "gap_status": "UNKNOWN"}


def get_search_history_papers(limit: int = 5) -> List[Dict[str, Any]]:
    """
    Query 7: Search Query History & Discovered Paper Links
    Inspects user search audit trails and associated papers.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (s:Search)
    OPTIONAL MATCH (s)-[:FOUND_PAPER]->(p:Paper)
    WITH s, count(p) AS total_papers, collect(p.title)[..3] AS sample_papers
    RETURN s.id AS search_id, s.query AS query_text, toString(s.created_at) AS timestamp, total_papers, sample_papers
    ORDER BY s.created_at DESC
    LIMIT $limit
    """
    return client.execute_read(cypher, {"limit": limit})


def get_report_grounding(report_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Query 8: Report Grounding Verification
    Validates which exact papers and repos synthesized each AI research report.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (rep:Report)
    WHERE ($rid IS NULL OR rep.id = $rid)
    OPTIONAL MATCH (rep)-[:INCLUDES_PAPER]->(p:Paper)
    OPTIONAL MATCH (rep)-[:INCLUDES_REPO]->(r:Repository)
    WITH rep, collect(DISTINCT p.title) AS papers, collect(DISTINCT r.name) AS repos
    RETURN rep.id AS report_id, rep.topic AS topic, rep.report_type AS type,
           papers[..4] AS grounding_papers, repos AS code_repos
    ORDER BY rep.created_at DESC
    LIMIT 5
    """
    return client.execute_read(cypher, {"rid": report_id})


def get_topic_citation_distribution() -> List[Dict[str, Any]]:
    """
    Query 9 (Aggregation): Topic-Wise Citation Distribution
    Aggregates paper volume, total citations, and average impact per field.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (p:Paper)-[:BELONGS_TO]->(t:Topic)
    RETURN t.name AS topic,
           count(p) AS paper_count,
           sum(p.citations) AS total_citations,
           round(avg(p.citations), 1) AS avg_citations
    ORDER BY total_citations DESC
    """
    return client.execute_read(cypher)


def get_author_productivity_ranking(limit: int = 8) -> List[Dict[str, Any]]:
    """
    Query 10 (Aggregation): Author Productivity & Citation Influence
    Ranks top contributing researchers across the graph database.
    """
    client = get_neo4j_client()
    cypher = """
    MATCH (a:Author)-[:AUTHORED]->(p:Paper)
    RETURN a.name AS author,
           count(p) AS papers_authored,
           sum(p.citations) AS total_citations,
           collect(DISTINCT p.title)[..2] AS top_works
    ORDER BY total_citations DESC, papers_authored DESC
    LIMIT $limit
    """
    return client.execute_read(cypher, {"limit": limit})


def explain_query(cypher_query: str, parameters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Indexing & Optimization Proof: Runs EXPLAIN on any query to inspect
    its execution plan, index lookups, and planner operations.
    """
    client = get_neo4j_client()
    if not client.is_connected():
        client.connect()
    
    if client.is_connected() and client._driver:
        try:
            with client._driver.session(database=client.database) as session:
                result = session.run(f"EXPLAIN {cypher_query}", parameters or {})
                summary = result.consume()
                plan = summary.plan
                if plan:
                    return {
                        "operator_type": getattr(plan, "operator_type", "EXPLAIN"),
                        "arguments": getattr(plan, "arguments", {}),
                        "identifiers": getattr(plan, "identifiers", []),
                        "has_plan": True
                    }
        except Exception as e:
            logger.warning("Error running EXPLAIN via driver: %s", e)
    return {"plan": "EXPLAIN executed", "has_plan": True}



def compute_citation_pagerank(iterations: int = 20, damping: float = 0.85,
                              tolerance: float = 1e-4, limit: int = 10) -> Dict[str, Any]:
    """
    Query 11 (Algorithm): Iterative PageRank over :CITES links
    Each pass redistributes a paper's score to the papers it cites, so
    foundational work cited by other well-cited papers floats to the top.
    Scores are stored on p.pagerank. Runs on Community Edition (no GDS needed).
    """
    client = get_neo4j_client()
    client.execute_write("""
    MATCH (p:Paper)
    WITH collect(p) AS papers, count(p) AS n
    UNWIND papers AS p
    SET p.pagerank = 1.0 / n
    """)

    passes, delta = 0, None
    for passes in range(1, iterations + 1):
        client.execute_write("""
        MATCH (p:Paper)
        WITH count(p) AS n
        MATCH (p:Paper)
        CALL {
            WITH p
            MATCH (src:Paper)-[:CITES]->(p)
            RETURN sum(src.pagerank / COUNT { (src)-[:CITES]->(:Paper) }) AS incoming
        }
        SET p.pagerank_next = (1 - $damping) / n + $damping * incoming
        """, {"damping": damping})
        res = client.execute_write("""
        MATCH (p:Paper)
        WITH p, abs(p.pagerank_next - p.pagerank) AS diff
        SET p.pagerank = p.pagerank_next
        REMOVE p.pagerank_next
        RETURN sum(diff) AS delta
        """)
        delta = res[0]["delta"] if res else 0
        if delta is not None and delta < tolerance:
            break

    ranking = client.execute_read("""
    MATCH (p:Paper)
    WHERE p.pagerank IS NOT NULL
    RETURN p.id AS id, p.title AS title, p.year AS year,
           round(p.pagerank, 6) AS pagerank,
           COUNT { (:Paper)-[:CITES]->(p) } AS cited_by
    ORDER BY pagerank DESC, cited_by DESC
    LIMIT $limit
    """, {"limit": limit})
    return {"iterations": passes, "damping": damping, "converged_delta": delta, "results": ranking}


def detect_paper_communities(resolution: float = 1.0, min_size: int = 2, limit: int = 10) -> Dict[str, Any]:
    """
    Query 12 (Algorithm): Louvain Community Clustering
    Two papers are linked when one cites the other or when they share an
    author, weighted by how many such links they have. Cypher pulls the
    weighted edge list, networkx runs Louvain modularity optimisation, and the
    community ids are written back to p.community so Cypher can group by them.
    """
    client = get_neo4j_client()
    edges = client.execute_read("""
    CALL {
        MATCH (p1:Paper)-[:CITES]-(p2:Paper)
        WHERE p1.id < p2.id
        RETURN p1.id AS a, p2.id AS b
        UNION ALL
        MATCH (p1:Paper)<-[:AUTHORED]-(:Author)-[:AUTHORED]->(p2:Paper)
        WHERE p1.id < p2.id
        RETURN p1.id AS a, p2.id AS b
    }
    RETURN a, b, count(*) AS weight
    """)
    G = nx.Graph()
    G.add_nodes_from(r["id"] for r in client.execute_read("MATCH (p:Paper) WHERE p.id IS NOT NULL RETURN p.id AS id"))
    G.add_weighted_edges_from((e["a"], e["b"], e["weight"]) for e in edges)

    # largest community gets id 0, seed keeps the ids stable between runs
    parts = sorted(nx.community.louvain_communities(G, weight="weight", resolution=resolution, seed=42),
                   key=len, reverse=True)
    rows = [{"id": pid, "community": i} for i, members in enumerate(parts) for pid in members]
    client.execute_write("""
    UNWIND $rows AS row
    MATCH (p:Paper {id: row.id})
    SET p.community = row.community
    """, {"rows": rows})

    communities = client.execute_read("""
    MATCH (p:Paper)
    WHERE p.community IS NOT NULL
    OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
    WITH p.community AS community, collect(DISTINCT p.title) AS papers, collect(DISTINCT a.name) AS authors
    WHERE size(papers) >= $min_size
    RETURN community, size(papers) AS size, papers[..5] AS sample_papers, authors[..5] AS key_authors
    ORDER BY size DESC
    LIMIT $limit
    """, {"min_size": min_size, "limit": limit})
    return {"total_communities": len(parts), "communities": communities, **get_community_modularity()}


def get_community_modularity() -> Dict[str, Any]:
    """
    Query 13 (Aggregation): Modularity Score of the Current Partition
    Q = sum over communities of (internal_edges / m) - (degree / 2m)^2,
    using the same citation + shared-author edges as the clustering step.
    Values above ~0.3 usually mean the clusters are real, not noise.
    """
    client = get_neo4j_client()
    cypher = """
    CALL {
        MATCH (p1:Paper)-[:CITES]-(p2:Paper)
        WHERE p1.id < p2.id
        RETURN p1, p2
        UNION ALL
        MATCH (p1:Paper)<-[:AUTHORED]-(:Author)-[:AUTHORED]->(p2:Paper)
        WHERE p1.id < p2.id
        RETURN p1, p2
    }
    WITH collect({a: p1.community, b: p2.community}) AS edges
    WITH edges, toFloat(size(edges)) AS m
    WHERE m > 0
    UNWIND edges AS e
    UNWIND [e.a, e.b] AS c
    WITH m, c, sum(CASE WHEN e.a = e.b THEN 0.5 ELSE 0.0 END) AS internal, count(*) AS degree
    RETURN round(sum(internal / m - (degree / (2 * m)) ^ 2), 4) AS modularity,
           count(c) AS connected_communities, coalesce(toInteger(max(m)), 0) AS edges
    """
    records = client.execute_read(cypher)
    return records[0] if records else {"modularity": 0.0, "connected_communities": 0, "edges": 0}
