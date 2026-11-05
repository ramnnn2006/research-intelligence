"""
Persistence benchmark: SQLite (in-memory baseline) against Neo4j for citation traversal.

  python scripts/benchmark_persistence.py [--papers 500] [--runs 20] [--fanout 4] [--window 40]
                                          [--sources 10] [--warmup 3] [--batch 1000] [--seed 7]

Both engines load the same synthetic citation DAG (newer papers cite older ones) with
batched writes, then answer the same question for every sampled source paper and each
depth d in 1..3:

    how many distinct papers are reachable by a directed citation path of exactly d hops?

SQLite looks sources up through the (src, dst) primary key index; Neo4j through an index
on :BenchPaper(key). Because the graph is acyclic, SQL join chains and Cypher paths count
exactly the same papers, so the result counts are compared and any mismatch fails the run.
Each query is warmed up before timing, and each engine runs its queries over one open
connection or session.

Neo4j benchmark data is isolated: its own label (:BenchPaper), its own relationship type
(:BENCH_CITES) and a run_id property. It is deleted in a finally block, also when the run
fails or is interrupted. The key index is dropped afterwards only if this run created it.

JSON results go to stdout, progress to stderr.
Exit codes: 0 ok, 1 result mismatch or benchmark error, 2 Neo4j unreachable
(SQLite results are still printed).
"""
import os
import sys
import json
import time
import uuid
import random
import sqlite3
import argparse
import statistics
from typing import Any, Callable, Dict, List, Tuple
from urllib.parse import urlsplit

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
backend_path = os.path.join(REPO_ROOT, "backend")
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

try:  # pick up NEO4J_* from .env before the client reads the environment
    from dotenv import load_dotenv
    load_dotenv(os.path.join(REPO_ROOT, ".env"))
except ImportError:
    pass

from app.db.neo4j_client import get_neo4j_client  # noqa: E402

DEPTHS = (1, 2, 3)
INDEX_NAME = "bench_paper_key"

SQL_HOPS = {
    1: "SELECT COUNT(DISTINCT c1.dst) FROM cites c1 WHERE c1.src = ?",
    2: ("SELECT COUNT(DISTINCT c2.dst) FROM cites c1 "
        "JOIN cites c2 ON c2.src = c1.dst WHERE c1.src = ?"),
    3: ("SELECT COUNT(DISTINCT c3.dst) FROM cites c1 "
        "JOIN cites c2 ON c2.src = c1.dst "
        "JOIN cites c3 ON c3.src = c2.dst WHERE c1.src = ?"),
}
CYPHER_HOP = ("MATCH (s:BenchPaper {key: $key})-[:BENCH_CITES*%d..%d]->(x:BenchPaper) "
              "RETURN count(DISTINCT x) AS n")


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def safe_uri(uri: str) -> str:
    try:
        parts = urlsplit(uri or "")
        return f"{parts.scheme}://{parts.hostname or ''}" + (f":{parts.port}" if parts.port else "")
    except ValueError:
        return ""


# ── Dataset ─────────────────────────────────────────────────────────────────
def build_dataset(n: int, fanout: int, window: int, seed: int):
    rng = random.Random(seed)
    papers = [{"key": f"P{i:06d}", "title": f"Synthetic paper {i}", "year": 1990 + i % 35} for i in range(n)]
    edges: List[Tuple[str, str]] = []
    for i in range(1, n):
        lo = max(0, i - window)
        for j in rng.sample(range(lo, i), min(fanout, i - lo)):
            edges.append((papers[i]["key"], papers[j]["key"]))
    return papers, edges


def pick_sources(papers: List[Dict[str, Any]], count: int, seed: int) -> List[str]:
    newest = [p["key"] for p in papers[len(papers) // 2:]]
    return random.Random(seed + 1).sample(newest, min(count, len(newest)))


# ── Timing ──────────────────────────────────────────────────────────────────
def summarize(samples_ms: List[float]) -> Dict[str, Any]:
    s = sorted(samples_ms)

    def pct(q: float) -> float:
        if len(s) == 1:
            return s[0]
        k = (len(s) - 1) * q
        lo, hi = int(k), min(int(k) + 1, len(s) - 1)
        return s[lo] + (s[hi] - s[lo]) * (k - lo)

    return {"mean_ms": round(statistics.fmean(s), 4), "p50_ms": round(pct(0.5), 4),
            "p95_ms": round(pct(0.95), 4), "min_ms": round(s[0], 4), "max_ms": round(s[-1], 4),
            "samples": len(s)}


def time_queries(run_query: Callable[[int, str], int], sources: List[str], runs: int, warmup: int):
    """Returns (stats per depth, counts per depth {source: count})."""
    stats, counts = {}, {}
    for d in DEPTHS:
        for _ in range(warmup):
            for key in sources:
                run_query(d, key)
        samples, depth_counts = [], {}
        for _ in range(runs):
            for key in sources:
                t0 = time.perf_counter()
                n = run_query(d, key)
                samples.append((time.perf_counter() - t0) * 1000)
                if depth_counts.setdefault(key, n) != n:
                    raise RuntimeError(f"Unstable result for {key} at depth {d}: {depth_counts[key]} then {n}")
        stats[f"hop{d}"] = summarize(samples)
        counts[d] = depth_counts
    return stats, counts


# ── SQLite ──────────────────────────────────────────────────────────────────
def bench_sqlite(papers, edges, sources, runs, warmup):
    con = sqlite3.connect(":memory:")
    try:
        con.execute("CREATE TABLE papers (key TEXT PRIMARY KEY, title TEXT, year INTEGER)")
        con.execute("CREATE TABLE cites (src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst))")
        t0 = time.perf_counter()
        with con:
            con.executemany("INSERT INTO papers VALUES (?, ?, ?)",
                            [(p["key"], p["title"], p["year"]) for p in papers])
            con.executemany("INSERT INTO cites VALUES (?, ?)", edges)
        ingest_ms = (time.perf_counter() - t0) * 1000
        con.execute("ANALYZE")

        stats, counts = time_queries(lambda d, key: con.execute(SQL_HOPS[d], (key,)).fetchone()[0],
                                     sources, runs, warmup)
        rows = len(papers) + len(edges)
        return {"engine": "SQLite (in-memory)", "ingest_ms": round(ingest_ms, 2),
                "ingest_rows_per_s": round(rows / (ingest_ms / 1000), 1) if ingest_ms else None,
                "queries": stats}, counts
    finally:
        con.close()


# ── Neo4j ───────────────────────────────────────────────────────────────────
def index_exists(client) -> bool:
    rows = client.execute_read("SHOW INDEXES YIELD name WHERE name = $name RETURN name", {"name": INDEX_NAME})
    return bool(rows)


def neo4j_load(client, run_id: str, papers, edges, batch: int) -> float:
    t0 = time.perf_counter()
    rows = [{"key": f"{run_id}:{p['key']}", "title": p["title"], "year": p["year"]} for p in papers]
    for i in range(0, len(rows), batch):
        client.execute_write("""
        UNWIND $rows AS row
        CREATE (:BenchPaper {key: row.key, run_id: $run, title: row.title, year: row.year})
        """, {"rows": rows[i:i + batch], "run": run_id})
    links = [{"s": f"{run_id}:{s}", "t": f"{run_id}:{t}"} for s, t in edges]
    for i in range(0, len(links), batch):
        client.execute_write("""
        UNWIND $rows AS row
        MATCH (a:BenchPaper {key: row.s})
        MATCH (b:BenchPaper {key: row.t})
        CREATE (a)-[:BENCH_CITES]->(b)
        """, {"rows": links[i:i + batch]})
    return (time.perf_counter() - t0) * 1000


def bench_neo4j(client, run_id, papers, edges, sources, runs, warmup, batch):
    ingest_ms = neo4j_load(client, run_id, papers, edges, batch)
    driver = getattr(client, "_driver", None)
    session = driver.session(database=client.database) if driver is not None else None
    queries = {d: CYPHER_HOP % (d, d) for d in DEPTHS}

    def run_query(d: int, key: str) -> int:
        params = {"key": f"{run_id}:{key}"}
        if session is not None:
            return session.run(queries[d], params).single()["n"]
        return client.execute_read(queries[d], params)[0]["n"]

    try:
        stats, counts = time_queries(run_query, sources, runs, warmup)
    finally:
        if session is not None:
            session.close()
    rows = len(papers) + len(edges)
    return {"engine": "Neo4j", "uri": safe_uri(client.uri), "ingest_ms": round(ingest_ms, 2),
            "ingest_rows_per_s": round(rows / (ingest_ms / 1000), 1) if ingest_ms else None,
            "ingest_batch_size": batch, "queries": stats}, counts


def neo4j_cleanup(client, run_id: str) -> int:
    removed = 0
    while True:
        res = client.execute_write("""
        MATCH (b:BenchPaper {run_id: $run})
        WITH b LIMIT 2000
        DETACH DELETE b
        RETURN count(*) AS n
        """, {"run": run_id})
        n = res[0]["n"] if res else 0
        removed += n
        if n == 0:
            return removed


# ── Main ────────────────────────────────────────────────────────────────────
def compare(sqlite_counts, neo_counts) -> Dict[str, Any]:
    out, ok = {}, True
    for d in DEPTHS:
        a, b = sqlite_counts.get(d, {}), neo_counts.get(d, {})
        mismatches = [{"source": k, "sqlite": a.get(k), "neo4j": b.get(k)}
                      for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]
        ok = ok and not mismatches
        out[f"hop{d}"] = {"match": not mismatches, "total_reachable_sqlite": sum(a.values()),
                          "total_reachable_neo4j": sum(b.values()), "mismatches": mismatches[:10]}
    out["all_match"] = ok
    return out


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="SQLite vs Neo4j citation traversal benchmark")
    ap.add_argument("--papers", type=int, default=500, help="number of synthetic papers (default 500)")
    ap.add_argument("--runs", type=int, default=20, help="timed repetitions per source and depth (default 20)")
    ap.add_argument("--fanout", type=int, default=4, help="references per paper (default 4)")
    ap.add_argument("--window", type=int, default=40, help="papers cite within the previous N papers (default 40)")
    ap.add_argument("--sources", type=int, default=10, help="sampled source papers (default 10)")
    ap.add_argument("--warmup", type=int, default=3, help="untimed warm-up runs per query (default 3)")
    ap.add_argument("--batch", type=int, default=1000, help="rows per Neo4j UNWIND batch (default 1000)")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)
    args.papers = max(10, args.papers)
    args.runs = max(1, args.runs)
    args.fanout = max(1, args.fanout)
    args.window = max(args.fanout, args.window)
    args.sources = max(1, args.sources)
    args.warmup = max(0, args.warmup)
    args.batch = max(1, args.batch)
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    papers, edges = build_dataset(args.papers, args.fanout, args.window, args.seed)
    sources = pick_sources(papers, args.sources, args.seed)
    result: Dict[str, Any] = {
        "config": vars(args),
        "dataset": {"papers": len(papers), "citations": len(edges), "sampled_sources": len(sources)},
        "question": "distinct papers reachable by a directed citation path of exactly d hops, d = 1..3",
        "notes": [
            "SQLite runs in-process and in memory; Neo4j adds a network round trip and durable storage.",
            "Latency samples are per query; each engine reuses one connection or session.",
        ],
    }
    exit_code = 0

    log(f"SQLite: loading {len(papers)} papers and {len(edges)} citations ...")
    result["sqlite"], sqlite_counts = bench_sqlite(papers, edges, sources, args.runs, args.warmup)

    client = get_neo4j_client()
    if not client.connect():
        result["neo4j"] = {"available": False, "error": f"Neo4j unreachable at {safe_uri(client.uri)}"}
        print(json.dumps(result, indent=2))
        return 2

    run_id = f"bench-{uuid.uuid4().hex[:12]}"
    created_index = False
    neo_counts: Dict[int, Dict[str, int]] = {}
    try:
        if not index_exists(client):
            client.execute_write(f"CREATE INDEX {INDEX_NAME} IF NOT EXISTS FOR (b:BenchPaper) ON (b.key)")
            created_index = True
        client.execute_write("CALL db.awaitIndexes(300)")
        log(f"Neo4j: loading {len(papers)} papers and {len(edges)} citations as run {run_id} ...")
        result["neo4j"], neo_counts = bench_neo4j(client, run_id, papers, edges, sources,
                                                  args.runs, args.warmup, args.batch)
    except Exception as e:
        result["neo4j"] = {"available": True, "error": f"{type(e).__name__}: {e}"}
        exit_code = 1
    finally:
        cleanup: Dict[str, Any] = {"run_id": run_id}
        try:
            cleanup["nodes_removed"] = neo4j_cleanup(client, run_id)
            if created_index:
                client.execute_write(f"DROP INDEX {INDEX_NAME} IF EXISTS")
            cleanup["index_dropped"] = created_index
        except Exception as e:
            cleanup["error"] = f"{type(e).__name__}: {e}"
            log(f"Cleanup failed; remove leftovers with: MATCH (b:BenchPaper {{run_id: '{run_id}'}}) DETACH DELETE b")
            exit_code = 1
        result["neo4j_cleanup"] = cleanup

    if neo_counts:
        result["result_check"] = compare(sqlite_counts, neo_counts)
        if not result["result_check"]["all_match"]:
            exit_code = 1
        ratios = {}
        for d in DEPTHS:
            s = result["sqlite"]["queries"][f"hop{d}"]["mean_ms"]
            n = result["neo4j"]["queries"][f"hop{d}"]["mean_ms"]
            ratios[f"hop{d}"] = round(n / s, 2) if s else None
        result["neo4j_over_sqlite_mean_latency"] = ratios

    print(json.dumps(result, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
