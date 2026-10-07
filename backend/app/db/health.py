import time
import logging
from typing import Dict, List, Any
from app.db.neo4j_client import get_neo4j_client

logger = logging.getLogger("research_iq.health")

# (label, property) pairs that the query catalog filters or sorts on.
# The advisor flags any of these that no index or constraint covers.
HOT_PROPERTIES = [
    ("Paper", "id"), ("Paper", "title"), ("Paper", "year"), ("Paper", "citations"),
    ("Paper", "pagerank"), ("Paper", "community"),
    ("Author", "name"), ("Topic", "name"), ("Repository", "name"), ("Repository", "stars"),
    ("Search", "query"), ("Search", "created_at"), ("Report", "created_at"),
]


def _safe_read(cypher: str) -> List[Dict[str, Any]]:
    try:
        return get_neo4j_client().execute_read(cypher)
    except Exception as e:
        logger.warning("Health probe failed [%s]: %s", cypher.split("\n")[0].strip(), e)
        return []


def _memory_footprint() -> Dict[str, Any]:
    rows = _safe_read("""
    CALL dbms.queryJmx('java.lang:type=Memory') YIELD attributes
    RETURN attributes.HeapMemoryUsage.value.properties AS heap
    """)
    if not rows or not rows[0].get("heap"):
        return {"available": False}
    heap = rows[0]["heap"]
    mb = lambda v: round((v or 0) / 1024 / 1024, 1)
    return {"available": True, "heap_used_mb": mb(heap.get("used")),
            "heap_committed_mb": mb(heap.get("committed")), "heap_max_mb": mb(heap.get("max"))}


def _connection_pool(client) -> Dict[str, Any]:
    pool = {"uri": client.uri, "database": client.database}
    rows = _safe_read("""
    CALL dbms.listConnections() YIELD connector
    RETURN connector, count(*) AS open
    """)
    pool["server_connections"] = {r["connector"]: r["open"] for r in rows}
    return pool


def advise_indexes(indexes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Compares hot (label, property) pairs against the live index list."""
    covered = set()
    for idx in indexes:
        if idx.get("type") == "LOOKUP":
            continue
        for label in idx.get("labelsOrTypes") or []:
            props = idx.get("properties") or []
            # a composite index only helps lookups on its leading property
            if props:
                covered.add((label, props[0]))

    advice = []
    for label, prop in HOT_PROPERTIES:
        if (label, prop) not in covered:
            name = f"{label.lower()}_{prop}_idx"
            advice.append({
                "label": label, "property": prop,
                "suggestion": f"CREATE INDEX {name} IF NOT EXISTS FOR (n:{label}) ON (n.{prop})",
            })
    for idx in indexes:
        if idx.get("state") and idx["state"] != "ONLINE":
            advice.append({"index": idx["name"], "suggestion": f"Index is {idx['state']}, wait for population or drop and recreate it"})
    return advice


def get_db_health() -> Dict[str, Any]:
    """
    Live Neo4j diagnostics: connectivity and round-trip latency, server side
    connections, node / relationship counts per label and type, index state,
    JVM heap usage and index recommendations.
    """
    client = get_neo4j_client()
    t0 = time.perf_counter()
    if not client.connect():
        return {"status": "offline", "uri": client.uri,
                "detail": "Neo4j is unreachable, the API is running on fallback storage"}

    ping = _safe_read("RETURN 1 AS ok")
    latency_ms = round((time.perf_counter() - t0) * 1000, 2)

    labels = _safe_read("""
    MATCH (n)
    UNWIND labels(n) AS label
    RETURN label, count(*) AS count
    ORDER BY count DESC
    """)
    rel_types = _safe_read("""
    MATCH ()-[r]->()
    RETURN type(r) AS type, count(*) AS count
    ORDER BY count DESC
    """)
    indexes = _safe_read("""
    SHOW INDEXES YIELD name, type, labelsOrTypes, properties, state, populationPercent
    RETURN name, type, labelsOrTypes, properties, state, populationPercent
    """)
    constraints = _safe_read("SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN *")

    return {
        "status": "healthy" if ping else "degraded",
        "latency_ms": latency_ms,
        "connection_pool": _connection_pool(client),
        "nodes": {"total": sum(r["count"] for r in labels), "by_label": labels},
        "relationships": {"total": sum(r["count"] for r in rel_types), "by_type": rel_types},
        "indexes": indexes,
        "constraints": constraints,
        "memory": _memory_footprint(),
        "index_advice": advise_indexes(indexes),
    }
