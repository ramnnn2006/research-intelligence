"""
Tests for the Review 3 additions: PageRank, Louvain communities, subgraph
export endpoints and the database health check.
Needs a running Neo4j (docker compose up -d). The fixture graph uses ids
prefixed with test_algo_ and is removed again in tearDownClass.
"""
import sys
import os
import csv
import io
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from fastapi.testclient import TestClient
from app.main import app
from app.db.neo4j_client import get_neo4j_client
from app.db.health import get_db_health, advise_indexes
from app.db.queries import compute_citation_pagerank, detect_paper_communities, get_community_modularity

# A is the landmark: cited by B, C and D. D bridges to E.
# Authors: One wrote A and B, Two wrote D and E.
FIXTURE = """
UNWIND ['a', 'b', 'c', 'd', 'e'] AS k
MERGE (p:Paper {id: 'test_algo_' + k})
SET p.title = 'Algorithm Fixture Paper ' + toUpper(k), p.year = '2024', p.citations = 0
WITH count(*) AS created
MATCH (a:Paper {id: 'test_algo_a'}), (b:Paper {id: 'test_algo_b'}), (c:Paper {id: 'test_algo_c'}),
      (d:Paper {id: 'test_algo_d'}), (e:Paper {id: 'test_algo_e'})
MERGE (b)-[:CITES]->(a)
MERGE (c)-[:CITES]->(a)
MERGE (d)-[:CITES]->(a)
MERGE (d)-[:CITES]->(b)
MERGE (e)-[:CITES]->(d)
MERGE (one:Author {name: 'Algo Fixture Author One'})
MERGE (two:Author {name: 'Algo Fixture Author Two'})
MERGE (one)-[:AUTHORED]->(a)
MERGE (one)-[:AUTHORED]->(b)
MERGE (two)-[:AUTHORED]->(d)
MERGE (two)-[:AUTHORED]->(e)
MERGE (t:Topic {name: 'Algo Fixture Topic'})
FOREACH (p IN [a, b, c, d, e] | MERGE (p)-[:BELONGS_TO]->(t))
"""


class TestGraphAlgorithms(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = get_neo4j_client()
        cls.client.execute_write(FIXTURE)
        cls.api = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.execute_write("""
        MATCH (n)
        WHERE (n:Paper AND n.id STARTS WITH 'test_algo_')
           OR (n:Author AND n.name STARTS WITH 'Algo Fixture')
           OR (n:Topic AND n.name = 'Algo Fixture Topic')
        DETACH DELETE n
        """)

    def _fixture_values(self, prop):
        rows = self.client.execute_read(
            f"MATCH (p:Paper) WHERE p.id STARTS WITH 'test_algo_' RETURN p.id AS id, p.{prop} AS value")
        return {r["id"].replace("test_algo_", ""): r["value"] for r in rows}

    # ── PageRank ──────────────────────────────────────────────────────────
    def test_01_pagerank_finds_landmark_paper(self):
        """The paper cited by everyone should outrank the papers citing it."""
        res = compute_citation_pagerank(iterations=30, limit=5)
        self.assertGreaterEqual(res["iterations"], 1)
        self.assertLessEqual(len(res["results"]), 5)
        self.assertIn("pagerank", res["results"][0])

        scores = self._fixture_values("pagerank")
        self.assertEqual(max(scores, key=scores.get), "a")
        # B is cited by D, so it should beat C and E which nobody cites
        self.assertGreater(scores["b"], scores["c"])
        self.assertGreater(scores["b"], scores["e"])
        self.assertTrue(all(0 < v < 1 for v in scores.values()))

    def test_02_pagerank_ranking_is_sorted(self):
        ranking = compute_citation_pagerank(limit=20)["results"]
        values = [r["pagerank"] for r in ranking]
        self.assertEqual(values, sorted(values, reverse=True))

    # ── Communities ───────────────────────────────────────────────────────
    def test_03_louvain_groups_connected_papers(self):
        """C only touches A and E only touches D, so each must share its neighbour's community."""
        res = detect_paper_communities(min_size=1, limit=500)
        self.assertGreater(res["total_communities"], 0)
        labels = self._fixture_values("community")
        self.assertTrue(all(isinstance(v, int) for v in labels.values()))
        self.assertEqual(labels["c"], labels["a"])
        self.assertEqual(labels["e"], labels["d"])

    def test_04_modularity_in_valid_range(self):
        detect_paper_communities()
        mod = get_community_modularity()
        self.assertGreater(mod["edges"], 0)
        self.assertGreaterEqual(mod["modularity"], -0.5)
        self.assertLessEqual(mod["modularity"], 1.0)

    # ── Export endpoints ──────────────────────────────────────────────────
    def test_05_export_json_respects_depth(self):
        one = self.api.get("/api/graph/export/json", params={"scope": "citations", "paper_id": "test_algo_d", "depth": 1})
        self.assertEqual(one.status_code, 200)
        self.assertIn("attachment", one.headers["content-disposition"])
        ids = {n["id"] for n in one.json()["nodes"]}
        self.assertEqual(ids, {"paper:test_algo_" + k for k in "abde"})

        two = self.api.get("/api/graph/export/json", params={"scope": "citations", "paper_id": "test_algo_d", "depth": 2})
        data = two.json()
        self.assertIn("paper:test_algo_c", {n["id"] for n in data["nodes"]})
        self.assertTrue(all(l["relation"] == "CITES" for l in data["links"]))
        self.assertEqual(len(data["links"]), 5)

    def test_06_export_author_scope(self):
        res = self.api.get("/api/graph/export/json", params={"scope": "authors", "paper_id": "test_algo_a", "depth": 1}).json()
        types = {n["type"] for n in res["nodes"]}
        self.assertEqual(types, {"paper", "author"})
        self.assertTrue(all(l["relation"] == "AUTHORED" for l in res["links"]))

    def test_07_export_csv_tables(self):
        params = {"scope": "topic", "topic": "Algo Fixture Topic", "depth": 1}
        edges = self.api.get("/api/graph/export/csv", params=params)
        self.assertEqual(edges.status_code, 200)
        self.assertTrue(edges.headers["content-type"].startswith("text/csv"))
        rows = list(csv.reader(io.StringIO(edges.text)))
        self.assertEqual(rows[0], ["source", "source_label", "relation", "target", "target_label"])
        self.assertGreater(len(rows), 1)

        nodes = self.api.get("/api/graph/export/csv", params={**params, "table": "nodes"})
        header = nodes.text.splitlines()[0]
        self.assertTrue(header.startswith("id,label,type"))

    def test_08_export_rejects_bad_params(self):
        self.assertEqual(self.api.get("/api/graph/export/json", params={"scope": "everything"}).status_code, 422)
        self.assertEqual(self.api.get("/api/graph/export/json", params={"depth": 5}).status_code, 422)

    # ── Health check ──────────────────────────────────────────────────────
    def test_09_health_check_metrics(self):
        health = get_db_health()
        self.assertEqual(health["status"], "healthy")
        self.assertGreaterEqual(health["nodes"]["total"], 5)
        labels = {r["label"] for r in health["nodes"]["by_label"]}
        self.assertTrue({"Paper", "Author", "Topic"} <= labels)
        self.assertIn("CITES", {r["type"] for r in health["relationships"]["by_type"]})
        self.assertTrue(any(i["name"] == "paper_title_idx" for i in health["indexes"]))
        self.assertIsInstance(health["index_advice"], list)
        self.assertIn("server_connections", health["connection_pool"])

    def test_10_health_endpoint(self):
        res = self.api.get("/api/db/health")
        self.assertEqual(res.status_code, 200)
        self.assertIn(res.json()["status"], ("healthy", "degraded"))

    def test_11_index_advisor_flags_missing_indexes(self):
        indexes = [
            {"name": "paper_id_uniq", "type": "RANGE", "labelsOrTypes": ["Paper"], "properties": ["id"], "state": "ONLINE"},
            {"name": "building", "type": "RANGE", "labelsOrTypes": ["Author"], "properties": ["name"], "state": "POPULATING"},
        ]
        advice = advise_indexes(indexes)
        flagged = {(a.get("label"), a.get("property")) for a in advice}
        self.assertNotIn(("Paper", "id"), flagged)
        self.assertIn(("Paper", "citations"), flagged)
        self.assertTrue(any(a.get("index") == "building" for a in advice))


if __name__ == "__main__":
    unittest.main(verbosity=2)
