"""
Tests for the polyglot persistence layer: Neo4j as the graph store and
MongoDB as the document store that mirrors searches and reports.

Needs Neo4j and MongoDB running (docker compose up -d) and MONGODB_URI set.
MongoDB cases are skipped when MongoDB is not reachable. Fixture data uses
the 'ResearchIQ Test' prefix and the fake arXiv id 1001.99996 and is removed
in tearDownClass.
"""
import sys
import os
import json
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from fastapi.testclient import TestClient
from app.main import app  # first: loads .env before the clients read their settings
from app.db import mongo_client
from app.db.neo4j_client import get_neo4j_client, init_neo4j_schema
from app.db.database import save_search, save_report, get_reports, get_searches, get_report_by_id

MONGO_TOPIC = "ResearchIQ Test Mongo Topic"
MONGO_PAPER = {
    "id": "https://arxiv.org/abs/1001.99996v2",
    "title": "ResearchIQ Test Mongo Paper",
    "authors": ["ResearchIQ Test Author"],
    "year": "2024",
    "source": "arxiv",
}
MONGO_PAPER_ID = "http://arxiv.org/abs/1001.99996"
MONGO_REPO = {"name": "researchiq-test/mongo-repo", "url": "https://github.com/researchiq-test/mongo-repo",
              "stars": 3, "description": "fixture"}


class TestMongoDocumentStore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_neo4j_schema()
        mongo_client.init_mongo_schema()
        if not mongo_client.is_available():
            raise unittest.SkipTest("MongoDB is not reachable (set MONGODB_URI and start the container)")
        cls.report_content = json.dumps({"gaps": [{"gap": "fixture gap"}]})
        cls.report_id = save_report(MONGO_TOPIC, "gaps", cls.report_content,
                                    repos=[MONGO_REPO], papers=[MONGO_PAPER])
        cls.search_id = save_search(MONGO_TOPIC, [MONGO_PAPER], [MONGO_REPO])

    @classmethod
    def tearDownClass(cls):
        db = mongo_client._db()
        if db is not None:
            db.reports.delete_many({"topic": MONGO_TOPIC})
            db.searches.delete_many({"query": MONGO_TOPIC})
            db.papers.delete_many({"_id": MONGO_PAPER_ID})
        client = get_neo4j_client()
        if client.connect():
            client.execute_write("MATCH (n) WHERE (n:Report OR n:Topic) AND (n.topic = $t OR n.name = $t) DETACH DELETE n",
                                 {"t": MONGO_TOPIC})
            client.execute_write("MATCH (s:Search {query: $t}) DETACH DELETE s", {"t": MONGO_TOPIC})
            client.execute_write("MATCH (p:Paper {id: $id}) DETACH DELETE p", {"id": MONGO_PAPER_ID})
            client.execute_write("MATCH (a:Author {name: 'ResearchIQ Test Author'}) DETACH DELETE a")
            client.execute_write("MATCH (r:Repository {name: $n}) DETACH DELETE r", {"n": MONGO_REPO["name"]})

    def test_01_report_mirrored_with_same_id(self):
        doc = mongo_client.get_report_by_id(self.report_id)
        self.assertIsNotNone(doc)
        self.assertEqual(doc["id"], self.report_id)
        self.assertEqual(doc["content"], self.report_content)
        self.assertEqual([p["id"] for p in doc["papers"]], [MONGO_PAPER_ID])
        json.dumps(doc)  # documents must be JSON serializable

    def test_02_search_mirrored(self):
        ids = [s["id"] for s in mongo_client.get_searches(50)]
        self.assertIn(self.search_id, ids)

    def test_03_reads_fall_back_to_mongo_when_neo4j_is_down(self):
        client = get_neo4j_client()
        with mock.patch.object(client, "connect", return_value=False):
            self.assertIn(self.report_id, [r["id"] for r in get_reports(50)])
            self.assertIn(self.search_id, [s["id"] for s in get_searches(50)])
            report = get_report_by_id(self.report_id)
            self.assertIsNotNone(report)
            self.assertEqual(report["content"], self.report_content)

    def test_04_status_endpoints(self):
        with TestClient(app) as api:
            status = api.get("/api/nosql/status").json()
            self.assertTrue(status["graph_store"]["connected"])
            self.assertTrue(status["document_store"]["connected"])
            self.assertNotIn("@", status["document_store"].get("host", ""))
            self.assertGreaterEqual(status["document_store"]["stats"]["reports"], 1)
            neo = api.get("/api/neo4j/status").json()
            self.assertTrue(neo["connected"])
            self.assertGreater(neo["stats"]["papers"], 0)


if __name__ == "__main__":
    unittest.main()
