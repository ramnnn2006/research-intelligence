import os
import sys
import time
import json
from typing import Dict, Any

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.db.neo4j_client import get_neo4j_client
from app.db.crud import create_paper_node, read_paper_node, update_paper_citations, delete_paper_node
from app.db.queries import (
    get_2hop_citations, get_coauthorship_network, get_paper_code_matching,
    get_indegree_centrality, get_topic_subgraph_context, get_cross_topic_research_gaps,
    get_search_history_papers, get_report_grounding, get_topic_citation_distribution,
    get_author_productivity_ranking, explain_query
)

def run_benchmarks():
    client = get_neo4j_client()
    if not client.connect():
        print("Error: Cannot connect to Neo4j.")
        sys.exit(1)

    evidence: Dict[str, Any] = {
        "metadata": {
            "database": "Neo4j Community Edition 5.18.0",
            "protocol": "bolt://localhost:7687",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        },
        "crud_operations": {},
        "domain_queries": {},
        "aggregations": {},
        "indexing_and_plans": {}
    }

    print("\n=======================================================")
    print("      EXECUTING DA2 CRUD BENCHMARKS & QUERIES          ")
    print("=======================================================\n")

    # ── 1. CRUD OPERATIONS ──────────────────────────────────────────
    print("--- 1. Testing CRUD Operations ---")
    
    # Create
    t0 = time.time()
    c_res = create_paper_node({
        "id": "live_crud_demo_paper_2026",
        "arxiv_id": "2409.99999",
        "title": "Autonomous Multi-Agent Citation Graph Reasoning with Neo4j",
        "abstract": "We evaluate high-throughput graph queries across interconnected literature networks.",
        "year": "2026",
        "citations": 12,
        "authors": ["Raveena V", "Yuvan Aadheraj K", "Ramakrishnan P H"],
        "topic": "Graph Neural Networks"
    })
    c_ms = (time.time() - t0) * 1000
    evidence["crud_operations"]["Create"] = {
        "operation": "CREATE / MERGE (:Paper) with Authors and Topic",
        "output": c_res,
        "latency_ms": round(c_ms, 2)
    }
    print(f"[CRUD Create] Completed in {c_ms:.2f}ms -> {c_res}")

    # Read
    t0 = time.time()
    r_res = read_paper_node("live_crud_demo_paper_2026")
    r_ms = (time.time() - t0) * 1000
    evidence["crud_operations"]["Read"] = {
        "operation": "MATCH (:Paper) with authors and relationships",
        "output": r_res,
        "latency_ms": round(r_ms, 2)
    }
    print(f"[CRUD Read] Completed in {r_ms:.2f}ms -> Title: {r_res.get('title')} | Authors: {r_res.get('authors')}")

    # Update
    t0 = time.time()
    u_res = update_paper_citations("live_crud_demo_paper_2026", 64)
    u_ms = (time.time() - t0) * 1000
    evidence["crud_operations"]["Update"] = {
        "operation": "SET p.citations = $new_citations, p.updated_at = datetime()",
        "output": u_res,
        "latency_ms": round(u_ms, 2)
    }
    print(f"[CRUD Update] Completed in {u_ms:.2f}ms -> Citations updated to {u_res.get('citations')}")

    # Delete
    t0 = time.time()
    d_res = delete_paper_node("live_crud_demo_paper_2026")
    d_ms = (time.time() - t0) * 1000
    evidence["crud_operations"]["Delete"] = {
        "operation": "DETACH DELETE p",
        "output": d_res,
        "latency_ms": round(d_ms, 2)
    }
    print(f"[CRUD Delete] Completed in {d_ms:.2f}ms -> Deleted count: {d_res.get('deleted_count')}")

    # ── 2. DOMAIN QUERIES ──────────────────────────────────────────
    print("\n--- 2. Testing 10+ Domain Queries ---")
    
    # Q1: 2-Hop Citations
    t0 = time.time()
    # Find a paper that has citations or any paper id
    sample_paper = client.execute_read("MATCH (p:Paper) RETURN p.id AS id LIMIT 1")
    sample_id = sample_paper[0]["id"] if sample_paper else "1706.03762"
    q1_res = get_2hop_citations(sample_id, limit=5)
    evidence["domain_queries"]["Query_1_Multi_Hop_Citations"] = {
        "name": "2-Hop & Multi-Hop Citation Path Discovery",
        "results": q1_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # Q2: Co-Authorship Network
    t0 = time.time()
    q2_res = get_coauthorship_network(min_collaborations=1, limit=5)
    evidence["domain_queries"]["Query_2_Coauthorship"] = {
        "name": "Co-Authorship Collaboration Network",
        "results": q2_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # Q3: Paper to Code Matching
    t0 = time.time()
    q3_res = get_paper_code_matching(limit=6)
    evidence["domain_queries"]["Query_3_Paper_Code_Matching"] = {
        "name": "Paper to Code Implementation Matching",
        "results": q3_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # Q4: In-Degree Centrality
    t0 = time.time()
    q4_res = get_indegree_centrality(limit=6)
    evidence["domain_queries"]["Query_4_Indegree_Centrality"] = {
        "name": "Top Landmark Papers by In-Degree Centrality",
        "results": q4_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # Q5: Topic Subgraph Context
    t0 = time.time()
    q5_res = get_topic_subgraph_context("Attention Mechanism Transformer", limit=5)
    evidence["domain_queries"]["Query_5_Topic_Subgraph"] = {
        "name": "Topic Subgraph Extraction for Literature Reviews",
        "results": q5_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # Q6: Research Gaps
    t0 = time.time()
    q6_res = get_cross_topic_research_gaps("Attention Mechanism Transformer", "Graph Neural Networks")
    evidence["domain_queries"]["Query_6_Research_Gaps"] = {
        "name": "Research Gap Discovery Across Disciplines",
        "results": q6_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # Q7: Search History
    t0 = time.time()
    q7_res = get_search_history_papers(limit=5)
    evidence["domain_queries"]["Query_7_Search_History"] = {
        "name": "Search Query History & Discovered Paper Links",
        "results": q7_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # Q8: Report Grounding
    t0 = time.time()
    q8_res = get_report_grounding()
    evidence["domain_queries"]["Query_8_Report_Grounding"] = {
        "name": "Report Grounding Verification",
        "results": q8_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # ── 3. AGGREGATIONS ─────────────────────────────────────────────
    print("\n--- 3. Testing Aggregation Pipelines ---")
    t0 = time.time()
    ag1_res = get_topic_citation_distribution()
    evidence["aggregations"]["Topic_Citation_Distribution"] = {
        "name": "Topic-Wise Citation Volume & Average Distribution",
        "results": ag1_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    t0 = time.time()
    ag2_res = get_author_productivity_ranking(limit=6)
    evidence["aggregations"]["Author_Productivity_Ranking"] = {
        "name": "Author Productivity & Influence Ranking",
        "results": ag2_res,
        "latency_ms": round((time.time() - t0) * 1000, 2)
    }

    # ── 4. INDEXING & EXPLAIN PLANS ─────────────────────────────────
    print("\n--- 4. Testing Indexing & Query Execution Plans ---")
    constraints = client.execute_read("SHOW CONSTRAINTS")
    indexes = client.execute_read("SHOW INDEXES")
    plan = explain_query("MATCH (p:Paper {id: $pid}) RETURN p.title", {"pid": "1706.03762"})
    
    evidence["indexing_and_plans"] = {
        "constraints": constraints,
        "indexes": indexes,
        "explain_plan": plan
    }

    # Database totals
    stats = client.execute_read("""
        CALL { MATCH (p:Paper) RETURN count(p) AS papers }
        CALL { MATCH (a:Author) RETURN count(a) AS authors }
        CALL { MATCH (r:Repository) RETURN count(r) AS repos }
        CALL { MATCH (t:Topic) RETURN count(t) AS topics }
        CALL { MATCH (s:Search) RETURN count(s) AS searches }
        CALL { MATCH (rep:Report) RETURN count(rep) AS reports }
        CALL { MATCH ()-[rel]->() RETURN count(rel) AS rels }
        RETURN {
            papers: papers, authors: authors, repositories: repos,
            topics: topics, searches: searches, reports: reports,
            relationships: rels
        } AS totals
    """)
    evidence["database_metrics"] = stats[0]["totals"] if stats else {}

    output_path = os.path.join(os.path.dirname(__file__), "query_evidence.json")
    with open(output_path, "w") as f:
        json.dump(evidence, f, indent=2, default=str)

    print(f"\nBenchmark completed successfully! Output saved to: {output_path}")
    print(f"Total Database Metrics: {evidence['database_metrics']}")

if __name__ == "__main__":
    run_benchmarks()
