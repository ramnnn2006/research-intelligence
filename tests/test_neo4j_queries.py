"""
Automated Test Suite for Neo4j Graph Queries and CRUD Layer
Course: BCSE406L - NoSQL Databases (Review 2 Verification)

Needs a running Neo4j (docker compose up -d). The schema and every fixture
the assertions rely on are created in setUpClass, so a fresh database (with
or without scripts/export_cypher.cql loaded) works. Fixture data uses the
'ResearchIQ Test' / researchiq-test prefixes and the fake arXiv ids
1001.99997-1001.99999, and is removed in tearDownClass.
"""
import sys
import os
import unittest
from urllib.parse import quote

# Add backend directory to module search path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from fastapi.testclient import TestClient
from app.main import app  # first: loads .env before the Neo4j client reads its settings
from app.db.neo4j_client import get_neo4j_client, init_neo4j_schema
from app.db.crud import create_paper_node, read_paper_node, update_paper_citations, delete_paper_node
from app.db.database import save_search
from app.db.queries import (
    get_coauthorship_network,
    get_paper_code_matching,
    get_indegree_centrality,
    get_topic_citation_distribution,
    get_author_productivity_ranking,
    get_cross_topic_research_gaps,
    explain_query
)

FIXTURE_TOPIC = "ResearchIQ Test Topic"
SEARCH_TOPIC = "ResearchIQ Test Search Topic"
API_PAPER = "http://arxiv.org/abs/1001.99999"
SEARCH_PAPER = "http://arxiv.org/abs/1001.99998"
FIXTURE_PAPER = "http://arxiv.org/abs/1001.99997"
FIXTURE_PAPER_IDS = [API_PAPER, SEARCH_PAPER, FIXTURE_PAPER, "test_unit_paper_9999"]


class TestNeo4jDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = get_neo4j_client()
        if not cls.client.connect():
            raise RuntimeError(f"Neo4j is not reachable at {cls.client.uri}; start it with docker compose up -d")
        init_neo4j_schema()
        cls._cleanup()
        # one topic paper with two authors, so the aggregation queries have rows on an empty DB
        create_paper_node({
            "arxiv_id": "1001.99997",
            "title": "ResearchIQ Test Fixture Paper",
            "year": "2026",
            "citations": 3,
            "authors": ["ResearchIQ Test Author A", "ResearchIQ Test Author B"],
            "topic": FIXTURE_TOPIC,
        })
        cls._api_cm = TestClient(app)
        cls.api = cls._api_cm.__enter__()

    @classmethod
    def tearDownClass(cls):
        try:
            cls._cleanup()
        finally:
            cls._api_cm.__exit__(None, None, None)

    @classmethod
    def _cleanup(cls):
        cls.client.execute_write("""
        MATCH (n)
        WHERE (n:Paper AND n.id IN $paper_ids)
           OR (n:Author AND (n.name STARTS WITH 'ResearchIQ Test' OR n.name IN ['Test Researcher A', 'Test Researcher B']))
           OR (n:Topic AND n.name STARTS WITH 'ResearchIQ Test')
           OR (n:Repository AND n.name STARTS WITH 'researchiq-test/')
           OR (n:Search AND n.query STARTS WITH 'ResearchIQ Test')
        DETACH DELETE n
        """, {"paper_ids": FIXTURE_PAPER_IDS})

    def setUp(self):
        self.test_paper_id = "test_unit_paper_9999"

    def test_01_neo4j_connectivity(self):
        """Verify Neo4j bolt driver can connect and execute a ping query."""
        res = self.client.execute_read("RETURN 1 AS ping")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["ping"], 1)

    def test_02_schema_constraints_exist(self):
        """Verify that uniqueness constraints are defined on required labels."""
        constraints = self.client.execute_read("SHOW CONSTRAINTS")
        names = [c.get("name", "") for c in constraints]
        self.assertTrue(any("paper" in name.lower() for name in names), "Missing paper uniqueness constraint")
        self.assertTrue(any("author" in name.lower() for name in names), "Missing author uniqueness constraint")

    def test_03_crud_lifecycle(self):
        """Verify full Create, Read, Update, Delete lifecycle in Neo4j."""
        # 1. Create
        created = create_paper_node({
            "id": self.test_paper_id,
            "title": "Automated Unit Test Paper for Neo4j",
            "abstract": "Testing transactional graph operations.",
            "year": "2026",
            "citations": 5,
            "authors": ["Test Researcher A", "Test Researcher B"],
            "topic": "Graph Neural Networks"
        })
        self.assertEqual(created["id"], self.test_paper_id)
        self.assertEqual(created["citations"], 5)

        # 2. Read
        read_back = read_paper_node(self.test_paper_id)
        self.assertIsNotNone(read_back)
        self.assertEqual(read_back["title"], "Automated Unit Test Paper for Neo4j")
        self.assertEqual(read_back["topic"], "Graph Neural Networks")
        self.assertEqual(read_back["repositories"], [])

        # 3. Update
        updated = update_paper_citations(self.test_paper_id, 42)
        self.assertEqual(updated["citations"], 42)

        # 4. Delete
        deleted = delete_paper_node(self.test_paper_id)
        self.assertEqual(deleted["deleted_count"], 1)

        # Confirm deleted
        self.assertIsNone(read_paper_node(self.test_paper_id))

    def test_04_coauthorship_query(self):
        """Verify co-authorship discovery query returns valid structure."""
        network = get_coauthorship_network(min_collaborations=1, limit=5)
        self.assertIsInstance(network, list)
        self.assertGreater(len(network), 0)
        self.assertIn("author_1", network[0])
        self.assertIn("author_2", network[0])
        self.assertIn("shared_papers", network[0])

    def test_05_topic_citation_distribution(self):
        """Verify topic aggregation pipeline calculates field metrics."""
        dist = get_topic_citation_distribution()
        self.assertIsInstance(dist, list)
        self.assertGreater(len(dist), 0)
        self.assertIn("topic", dist[0])
        self.assertIn("paper_count", dist[0])
        self.assertIn(FIXTURE_TOPIC, {d["topic"] for d in dist})

    def test_06_author_productivity_ranking(self):
        """Verify author aggregation pipeline returns ranked researchers."""
        authors = get_author_productivity_ranking(limit=5)
        self.assertIsInstance(authors, list)
        self.assertGreater(len(authors), 0)
        self.assertIn("author", authors[0])
        self.assertIn("papers_authored", authors[0])

    def test_07_explain_query_plan(self):
        """Verify EXPLAIN execution plan returns cost planner operations."""
        plan_res = explain_query("MATCH (p:Paper {id: $id}) RETURN p", {"id": "sample"})
        self.assertTrue(plan_res.get("has_plan", False))
        self.assertTrue(plan_res.get("operator_type"))
        self.assertIsInstance(plan_res.get("children"), list)

        bad = explain_query("MATCH (p:Paper RETURN p")
        self.assertFalse(bad["has_plan"])
        self.assertTrue(bad["error"])
        self.assertEqual(self.api.post("/api/db/queries/explain", json={"query": "MATCH (p:Paper RETURN p"}).status_code, 400)

    def test_08_crud_api_with_url_ids(self):
        """Paper ids are URLs: the CRUD routes must accept slashes and versioned arXiv URLs."""
        res = self.api.post("/api/db/crud/create", json={
            "arxiv_id": "1001.99999v2", "title": "ResearchIQ Test API Paper",
            "authors": ["ResearchIQ Test Author C"], "topic": FIXTURE_TOPIC,
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["id"], API_PAPER)

        # percent-encoded, as the frontend's encodeURIComponent would send it
        read = self.api.get("/api/db/crud/read/" + quote(API_PAPER + "v2", safe=""))
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(read.json()["arxiv_id"], "1001.99999")

        upd = self.api.put("/api/db/crud/update", json={"paper_id": API_PAPER, "citations": 9})
        self.assertEqual(upd.json()["citations"], 9)

        gone = self.api.delete("/api/db/crud/delete/https://arxiv.org/abs/1001.99999")
        self.assertEqual(gone.json()["deleted_count"], 1)
        self.assertEqual(self.api.get("/api/db/crud/read/" + API_PAPER).status_code, 404)

        self.assertEqual(self.api.post("/api/db/crud/create", json={"title": "No id"}).status_code, 400)
        self.assertEqual(self.api.post("/api/db/crud/create",
                                       json={"id": "x", "title": "Bad", "citations": -1}).status_code, 400)

    def test_09_save_search_links_topic_repos_and_code(self):
        """save_search: canonical ids, no citation reset, BELONGS_TO, HAS_IMPLEMENTATION, IMPLEMENTS."""
        create_paper_node({"arxiv_id": "1001.99998", "title": "ResearchIQ Test Search Paper", "citations": 50})
        repo = {"name": "researchiq-test/impl-1001.99998", "url": "https://github.com/researchiq-test/impl-1001.99998",
                "stars": 7, "description": "Code for arXiv 1001.99998"}
        save_search(SEARCH_TOPIC, [{
            "id": SEARCH_PAPER + "v3", "url": SEARCH_PAPER + "v3", "title": "ResearchIQ Test Search Paper",
            "summary": "Fixture abstract", "authors": ["ResearchIQ Test Author D"], "source": "arxiv",
        }], [repo])

        rows = self.client.execute_read("""
        MATCH (p:Paper) WHERE p.id STARTS WITH $prefix
        OPTIONAL MATCH (p)-[:BELONGS_TO]->(t:Topic {name: $topic})
        OPTIONAL MATCH (r:Repository {name: $repo})-[:IMPLEMENTS]->(p)
        OPTIONAL MATCH (t)-[:HAS_IMPLEMENTATION]->(r)
        RETURN p.id AS id, p.arxiv_id AS arxiv_id, p.citations AS citations,
               t IS NOT NULL AS in_topic, r IS NOT NULL AS implemented
        """, {"prefix": SEARCH_PAPER, "topic": SEARCH_TOPIC, "repo": repo["name"]})
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0]["id"], SEARCH_PAPER)
        self.assertEqual(rows[0]["arxiv_id"], "1001.99998")
        self.assertEqual(rows[0]["citations"], 50)  # arXiv copy carries no count
        self.assertTrue(rows[0]["in_topic"])
        self.assertTrue(rows[0]["implemented"])
        topic_repo = self.client.execute_read(
            "MATCH (:Topic {name: $topic})-[:HAS_IMPLEMENTATION]->(r:Repository {name: $repo}) RETURN count(r) AS c",
            {"topic": SEARCH_TOPIC, "repo": repo["name"]})
        self.assertEqual(topic_repo[0]["c"], 1)

        matches = get_paper_code_matching(topic_name=SEARCH_TOPIC, limit=50)
        self.assertGreater(len(matches), 0)
        self.assertTrue(all(m["topic"] == SEARCH_TOPIC for m in matches))

        # a search that found no papers must still record its repos
        sid = save_search(SEARCH_TOPIC + " empty", [], [{"name": "researchiq-test/only-repo", "url": "", "stars": 1}])
        found = self.client.execute_read(
            "MATCH (:Search {id: $sid})-[:FOUND_REPO]->(r:Repository) RETURN r.name AS name", {"sid": sid})
        self.assertEqual([r["name"] for r in found], ["researchiq-test/only-repo"])

    def test_10_graph_explore_uses_belongs_to(self):
        res = self.api.get("/api/graph/explore", params={"topic": FIXTURE_TOPIC, "limit": 20})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("ResearchIQ Test Fixture Paper", {n["id"] for n in data["nodes"]})
        self.assertEqual(data["links"], data["edges"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
