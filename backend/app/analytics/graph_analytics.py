"""
Centrality and community analytics over the Neo4j citation graph.

Scope
  * topic given: papers with (Paper)-[:BELONGS_TO]->(Topic), topic name matched
    case-insensitively, plus their direct citation neighbours (papers they cite and
    papers citing them, at most MAX_NEIGHBOURS), and every CITES edge among that set.
    Papers returned by one search rarely cite each other, so without the neighbours
    the topic graph would have almost no edges and every score would be equal.
    Each ranked paper carries in_topic so callers can tell the two apart.
  * no topic: every Paper that takes part in a CITES edge (at most MAX_EDGES edges).

Metrics per paper: pagerank, betweenness, degree_centrality (in-degree),
authority_score, hub_score, community. PageRank and HITS use networkx (scipy) when
available and fall back to pure Python power iteration otherwise.

Both public functions are synchronous; call them from a threadpool.
"""
import logging
import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx

from app.db.neo4j_client import get_neo4j_client

logger = logging.getLogger("research_iq.graph_analytics")

MAX_EDGES = 50000
MAX_NEIGHBOURS = 400
GRAPH_NODE_CAP = 250
EXACT_BETWEENNESS_MAX = 1500

_METRIC_KEYS = {
    "pagerank": "pagerank",
    "betweenness": "betweenness",
    "degree": "degree_centrality",
    "degree_centrality": "degree_centrality",
    "authority": "authority_score",
    "authority_score": "authority_score",
    "hub": "hub_score",
    "hub_score": "hub_score",
}

_PAPER_FIELDS = ("{.id, .title, .year, .url, .citations, .source, "
                 "authors: [(a:Author)-[:AUTHORED]->(%s) | a.name][..6]}")


# ── Helpers ─────────────────────────────────────────────────────────────────
def _ready() -> bool:
    client = get_neo4j_client()
    return client.is_connected() or client.connect()


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _empty_result(metric: str, message: str, topic: Optional[str] = None) -> Dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "error": message,
        "metric": metric,
        "topic": topic,
        "topology": {"total_nodes": 0, "total_edges": 0, "density": 0.0, "num_communities": 0},
        "influential_papers": [],
        "influential_authors": [],
        "graph": {"nodes": [], "links": [], "edges": []},
    }


def _meta(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": row.get("title") or row.get("id"),
        "year": str(row.get("year") or ""),
        "url": row.get("url") or "",
        "citations": _int(row.get("citations")),
        "source": row.get("source") or "",
        "authors": [a for a in (row.get("authors") or []) if a],
    }


# ── Loading ─────────────────────────────────────────────────────────────────
def _load_metadata(client, ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not ids:
        return {}
    rows = client.execute_read(f"""
    UNWIND $ids AS pid
    MATCH (p:Paper {{id: pid}})
    RETURN p {_PAPER_FIELDS % "p"} AS paper
    """, {"ids": ids})
    return {r["paper"]["id"]: _meta(r["paper"]) for r in rows if r.get("paper") and r["paper"].get("id")}


def _edges_within(client, ids: List[str]) -> List[Tuple[str, str]]:
    if not ids:
        return []
    scope = set(ids)
    rows = client.execute_read("""
    UNWIND $ids AS pid
    MATCH (a:Paper {id: pid})-[:CITES]->(b:Paper)
    RETURN a.id AS src, b.id AS tgt
    """, {"ids": ids})
    return list({(r["src"], r["tgt"]) for r in rows if r["tgt"] in scope and r["src"] != r["tgt"]})


def _load_topic_scope(client, topic: str):
    """Returns (topic_names, core_ids, metadata, edges) or None when the topic does not exist."""
    topic_lc = " ".join(topic.split()).lower()
    names = client.execute_read("""
    MATCH (t:Topic) WHERE toLower(trim(t.name)) = $topic_lc
    RETURN t.name AS name
    """, {"topic_lc": topic_lc})
    if not names:
        return None
    core_rows = client.execute_read(f"""
    MATCH (t:Topic) WHERE toLower(trim(t.name)) = $topic_lc
    MATCH (p:Paper)-[:BELONGS_TO]->(t)
    WITH DISTINCT p
    RETURN p {_PAPER_FIELDS % "p"} AS paper
    """, {"topic_lc": topic_lc})
    meta = {r["paper"]["id"]: _meta(r["paper"]) for r in core_rows if r.get("paper") and r["paper"].get("id")}
    core_ids = list(meta)
    if core_ids:
        neighbour_rows = client.execute_read(f"""
        UNWIND $ids AS pid
        MATCH (p:Paper {{id: pid}})-[:CITES]-(q:Paper)
        WHERE q.id IS NOT NULL AND NOT q.id IN $ids
        WITH DISTINCT q
        ORDER BY coalesce(q.citations, 0) DESC
        LIMIT $cap
        RETURN q {_PAPER_FIELDS % "q"} AS paper
        """, {"ids": core_ids, "cap": MAX_NEIGHBOURS})
        for r in neighbour_rows:
            if r.get("paper") and r["paper"].get("id"):
                meta.setdefault(r["paper"]["id"], _meta(r["paper"]))
    edges = _edges_within(client, list(meta))
    return [n["name"] for n in names], set(core_ids), meta, edges


def _load_global_scope(client, max_edges: int = MAX_EDGES):
    rows = client.execute_read("""
    MATCH (a:Paper)-[:CITES]->(b:Paper)
    WHERE a.id IS NOT NULL AND b.id IS NOT NULL AND a <> b
    RETURN a.id AS src, b.id AS tgt
    LIMIT $max_edges
    """, {"max_edges": max_edges})
    edges = list({(r["src"], r["tgt"]) for r in rows})
    ids = sorted({x for e in edges for x in e})
    return _load_metadata(client, ids), edges


# ── Algorithms ──────────────────────────────────────────────────────────────
def _pagerank_py(G: nx.DiGraph, alpha: float = 0.85, max_iter: int = 200, tol: float = 1e-8) -> Dict[str, float]:
    nodes = list(G)
    n = len(nodes)
    if n == 0:
        return {}
    rank = {v: 1.0 / n for v in nodes}
    out_deg = {v: G.out_degree(v) for v in nodes}
    for _ in range(max_iter):
        dangling = alpha * sum(rank[v] for v in nodes if out_deg[v] == 0) / n
        new = {v: (1.0 - alpha) / n + dangling for v in nodes}
        for u in nodes:
            if out_deg[u]:
                share = alpha * rank[u] / out_deg[u]
                for v in G.successors(u):
                    new[v] += share
        err = sum(abs(new[v] - rank[v]) for v in nodes)
        rank = new
        if err < n * tol:
            break
    return rank


def _pagerank(G: nx.DiGraph) -> Dict[str, float]:
    try:
        return {k: float(v) for k, v in nx.pagerank(G, alpha=0.85, max_iter=200).items()}
    except Exception as e:  # scipy missing or no convergence
        logger.info("networkx pagerank unavailable (%s); using pure Python", type(e).__name__)
        return _pagerank_py(G)


def _hits_py(G: nx.DiGraph, max_iter: int = 200, tol: float = 1e-8):
    nodes = list(G)
    if not nodes:
        return {}, {}
    hubs = {v: 1.0 / len(nodes) for v in nodes}
    auth = {v: 0.0 for v in nodes}
    for _ in range(max_iter):
        last = hubs
        auth = {v: sum(last[u] for u in G.predecessors(v)) for v in nodes}
        a_sum = sum(auth.values()) or 1.0
        auth = {v: x / a_sum for v, x in auth.items()}
        hubs = {v: sum(auth[w] for w in G.successors(v)) for v in nodes}
        h_sum = sum(hubs.values()) or 1.0
        hubs = {v: x / h_sum for v, x in hubs.items()}
        if sum(abs(hubs[v] - last[v]) for v in nodes) < tol:
            break
    return hubs, auth


def _hits(G: nx.DiGraph):
    if G.number_of_edges() == 0:
        zero = {v: 0.0 for v in G}
        return zero, dict(zero)
    try:
        hubs, auth = nx.hits(G, max_iter=200)
        return {k: float(v) for k, v in hubs.items()}, {k: float(v) for k, v in auth.items()}
    except Exception as e:
        logger.info("networkx hits unavailable (%s); using pure Python", type(e).__name__)
        return _hits_py(G)


def _betweenness(G: nx.DiGraph) -> Dict[str, float]:
    n = G.number_of_nodes()
    try:
        if n > EXACT_BETWEENNESS_MAX:
            return nx.betweenness_centrality(G, k=500, seed=42)
        return nx.betweenness_centrality(G)
    except Exception as e:
        logger.warning("betweenness failed: %s", e)
        return {v: 0.0 for v in G}


def _in_degree(G: nx.DiGraph) -> Dict[str, float]:
    n = G.number_of_nodes()
    if n <= 1:
        return {v: 0.0 for v in G}
    return {v: G.in_degree(v) / (n - 1) for v in G}


def _communities(G: nx.DiGraph) -> Dict[str, int]:
    U = G.to_undirected()
    comms: List[Set[str]] = []
    if U.number_of_edges() > 0:
        try:
            comms = [set(c) for c in nx.community.louvain_communities(U, seed=42)]
        except Exception:
            try:
                comms = [set(c) for c in nx.community.greedy_modularity_communities(U)]
            except Exception:
                comms = []
    if not comms:
        comms = [set(c) for c in nx.connected_components(U)]
    comms.sort(key=len, reverse=True)
    return {node: cid + 1 for cid, comm in enumerate(comms) for node in comm}


# ── Public API ──────────────────────────────────────────────────────────────
def compute_graph_analytics(topic: Optional[str] = None, metric: str = "pagerank", limit: int = 30) -> Dict[str, Any]:
    """
    Rank papers and authors in the citation graph.

    Returns {success, message, metric, topic, scope, topology, influential_papers,
             influential_authors, graph: {nodes, links, edges}}.
    success is False with a message when Neo4j is offline, the topic does not
    exist, or there is nothing to analyse.
    """
    metric = (metric or "pagerank").lower()
    metric_key = _METRIC_KEYS.get(metric, "pagerank")
    limit = max(1, min(_int(limit) or 30, 200))
    topic = " ".join((topic or "").split()) or None

    if not _ready():
        return _empty_result(metric, "Neo4j is offline, so graph analytics are unavailable.", topic)
    client = get_neo4j_client()

    try:
        if topic:
            loaded = _load_topic_scope(client, topic)
            if loaded is None:
                return _empty_result(metric, f"No topic named '{topic}' exists in the graph.", topic)
            names, core_ids, meta, edges = loaded
            if not core_ids:
                return _empty_result(metric, f"Topic '{names[0]}' has no papers yet.", topic)
        else:
            meta, edges = _load_global_scope(client)
            core_ids = set(meta)
            if not edges:
                return _empty_result(metric, "No CITES relationships are stored yet. "
                                             "Open a paper's citation network to collect some.")
    except Exception as e:
        logger.error("Loading the analytics graph failed: %s", e, exc_info=True)
        return _empty_result(metric, f"Could not read the citation graph: {type(e).__name__}", topic)

    G = nx.DiGraph()
    G.add_nodes_from(meta)
    G.add_edges_from(e for e in edges if e[0] in meta and e[1] in meta)

    pagerank = _pagerank(G)
    betweenness = _betweenness(G)
    in_degree = _in_degree(G)
    hubs, authorities = _hits(G)
    community = _communities(G)

    papers = []
    for node in G.nodes:
        m = meta.get(node, {})
        papers.append({
            "id": node,
            "title": m.get("title") or node,
            "year": m.get("year", ""),
            "url": m.get("url", ""),
            "citations": m.get("citations", 0),
            "authors": (m.get("authors") or [])[:4],
            "pagerank": round(pagerank.get(node, 0.0), 6),
            "betweenness": round(betweenness.get(node, 0.0), 6),
            "degree_centrality": round(in_degree.get(node, 0.0), 6),
            "authority_score": round(authorities.get(node, 0.0), 6),
            "hub_score": round(hubs.get(node, 0.0), 6),
            "community": community.get(node, 0),
            "in_topic": node in core_ids,
        })
    for p in papers:   # short aliases used by the analytics page metric buttons
        p["degree"] = p["degree_centrality"]
        p["authority"] = p["authority_score"]
    papers.sort(key=lambda p: (p[metric_key], p["citations"]), reverse=True)
    top_papers = papers[:limit]
    top_ids = {p["id"] for p in papers[:5]}

    author_scores: Dict[str, float] = {}
    author_counts: Dict[str, int] = {}
    author_top: Dict[str, Tuple[str, float]] = {}
    for node, score in pagerank.items():
        title = meta.get(node, {}).get("title") or node
        for auth in meta.get(node, {}).get("authors", []):
            author_scores[auth] = author_scores.get(auth, 0.0) + score
            author_counts[auth] = author_counts.get(auth, 0) + 1
            if auth not in author_top or score > author_top[auth][1]:
                author_top[auth] = (title, score)
    influential_authors = [
        {"name": a, "score": round(s, 6), "papers_count": author_counts.get(a, 1),
         "top_paper": author_top.get(a, ("", 0))[0]}
        for a, s in sorted(author_scores.items(), key=lambda x: x[1], reverse=True)[:limit]
    ]

    shown = papers[:GRAPH_NODE_CAP]
    shown_ids = {p["id"] for p in shown}
    max_pr = max((p["pagerank"] for p in shown), default=1.0) or 1.0
    d3_nodes = [{
        "id": p["id"], "label": p["title"], "type": "paper", "year": p["year"], "url": p["url"],
        "citations": p["citations"], "pagerank": p["pagerank"], "betweenness": p["betweenness"],
        "community": p["community"], "in_topic": p["in_topic"],
        "size": 9 + int((p["pagerank"] / max_pr) * 17), "is_top_influential": p["id"] in top_ids,
    } for p in shown]
    d3_links = [{"source": s, "target": t, "relation": "cites"}
                for s, t in G.edges() if s in shown_ids and t in shown_ids]

    n_core = len(core_ids)
    scope_note = (f"{n_core} topic papers and {G.number_of_nodes() - n_core} directly cited or citing papers"
                  if topic else f"{G.number_of_nodes()} papers with stored citations")
    return {
        "success": True,
        "message": f"Analysed {scope_note}, {G.number_of_edges()} citation links."
                   + ("" if G.number_of_edges() else " No citation links yet, so scores are uniform."),
        "metric": metric,
        "topic": topic,
        "scope": "topic" if topic else "global",
        "topology": {
            "total_nodes": G.number_of_nodes(),
            "total_edges": G.number_of_edges(),
            "density": round(nx.density(G), 6) if G.number_of_nodes() > 1 else 0.0,
            "num_communities": len(set(community.values())),
            "top_metric": metric_key,
            "topic_papers": n_core if topic else None,
            "neighbour_papers": (G.number_of_nodes() - n_core) if topic else None,
            "graph_truncated": len(papers) > GRAPH_NODE_CAP,
            "connected_database": "Neo4j",
        },
        "influential_papers": top_papers,
        "influential_authors": influential_authors,
        "graph": {"nodes": d3_nodes, "links": d3_links, "edges": d3_links},
    }


def write_metrics_to_neo4j() -> Dict[str, Any]:
    """
    Compute PageRank and betweenness on the stored CITES graph and write them to
    p.nx_pagerank, p.nx_betweenness and p.nx_metrics_updated_at in one UNWIND batch.
    The nx_ prefix keeps these apart from p.pagerank, which the Cypher PageRank in
    db/queries.py owns.
    Only papers that take part in a CITES edge are scored.
    """
    if not _ready():
        msg = "Neo4j is offline, so metrics were not written."
        return {"success": False, "error": msg, "message": msg}
    client = get_neo4j_client()
    try:
        rows = client.execute_read("""
        MATCH (a:Paper)-[:CITES]->(b:Paper)
        WHERE a.id IS NOT NULL AND b.id IS NOT NULL AND a <> b
        RETURN a.id AS src, b.id AS tgt
        """)
    except Exception as e:
        msg = f"Could not read the citation graph: {type(e).__name__}"
        return {"success": False, "error": msg, "message": msg}
    if not rows:
        msg = "No paper citation relationships found to score."
        return {"success": False, "error": msg, "message": msg}

    G = nx.DiGraph()
    G.add_edges_from((r["src"], r["tgt"]) for r in rows)
    pagerank = _pagerank(G)
    betweenness = _betweenness(G)
    updates = [{"id": n, "pagerank": round(pagerank.get(n, 0.0), 6),
                "betweenness": round(betweenness.get(n, 0.0), 6)} for n in G.nodes]
    try:
        res = client.execute_write("""
        UNWIND $rows AS row
        MATCH (p:Paper {id: row.id})
        SET p.nx_pagerank = row.pagerank,
            p.nx_betweenness = row.betweenness,
            p.nx_metrics_updated_at = $now
        RETURN count(p) AS updated
        """, {"rows": updates, "now": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    except Exception as e:
        msg = f"Writing metrics failed: {type(e).__name__}"
        return {"success": False, "error": msg, "message": msg}
    updated = res[0]["updated"] if res else 0
    return {
        "success": True,
        "nodes_updated": updated,
        "message": f"Updated {updated} papers with PageRank and betweenness scores in Neo4j.",
    }
