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


HF_TOPIC = "ResearchIQ Test HF Topic"
HF_PAPER = {"id": "http://arxiv.org/abs/1001.99995v1", "title": "ResearchIQ Test HF Paper",
            "authors": ["ResearchIQ Test HF Author"], "year": "2024", "source": "arxiv"}
HF_MODEL = {"id": "researchiq-test/hf-model", "name": "hf-model", "pipeline_tag": "text-classification",
            "downloads": 10, "likes": 2}
HF_DATASET = {"id": "researchiq-test/hf-dataset", "name": "hf-dataset", "downloads": 5}


class TestHuggingFaceKnowledgeGraph(unittest.TestCase):
    """POST /api/search with the external connectors stubbed, so no network is needed."""

    @classmethod
    def setUpClass(cls):
        init_neo4j_schema()
        from app.api import routes
        cls.routes = routes

    @classmethod
    def tearDownClass(cls):
        client = get_neo4j_client()
        if client.connect():
            client.execute_write("MATCH (n) WHERE n.id IN $ids OR n.name IN $names DETACH DELETE n",
                                 {"ids": [HF_MODEL["id"], HF_DATASET["id"], "http://arxiv.org/abs/1001.99995"],
                                  "names": [HF_TOPIC, "ResearchIQ Test HF Author"]})
            client.execute_write("MATCH (s:Search {query: $q}) DETACH DELETE s", {"q": HF_TOPIC})
        db = mongo_client._db()
        if db is not None:
            db.searches.delete_many({"query": HF_TOPIC})
            db.papers.delete_many({"_id": "http://arxiv.org/abs/1001.99995"})

    def _search(self):
        r = self.routes
        with mock.patch.object(r.arxiv, "search", mock.AsyncMock(return_value=[HF_PAPER])), \
             mock.patch.object(r.scholar, "search", mock.AsyncMock(return_value=[])), \
             mock.patch.object(r.github, "search", mock.AsyncMock(return_value=[])), \
             mock.patch.object(r.hf, "search_all", mock.AsyncMock(return_value={"models": [HF_MODEL], "datasets": [HF_DATASET]})), \
             TestClient(app) as api:
            return api.post("/api/search", json={"query": HF_TOPIC, "max_results": 3})

    def test_01_search_returns_and_stores_models_and_datasets(self):
        res = self._search()
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual([m["id"] for m in body["models"]], [HF_MODEL["id"]])
        self.assertEqual([d["id"] for d in body["datasets"]], [HF_DATASET["id"]])
        self.assertEqual(body["graph_source"], "neo4j")
        types = {n["id"]: n["type"] for n in body["graph"]["nodes"]}
        self.assertEqual(types.get(HF_MODEL["id"]), "model")
        self.assertEqual(types.get(HF_DATASET["id"]), "dataset")
        relations = {l["relation"] for l in body["graph"]["links"]}
        self.assertTrue({"model", "dataset", "authored"} <= relations)
        self.assertEqual(body["graph"]["links"], body["graph"]["edges"])

    def test_02_topic_graph_endpoint_and_no_duplicate_nodes(self):
        self._search()  # a second identical search must not duplicate nodes
        client = get_neo4j_client()
        counts = client.execute_read(
            "MATCH (t:Topic {name: $t}) RETURN COUNT { (t)-[:HAS_MODEL]->() } AS models, "
            "COUNT { (t)-[:USES_DATASET]->() } AS datasets, COUNT { (t)<-[:BELONGS_TO]-() } AS papers", {"t": HF_TOPIC})
        self.assertEqual(counts, [{"models": 1, "datasets": 1, "papers": 1}])
        with TestClient(app) as api:
            self.assertEqual(api.get("/api/neo4j/graph/" + HF_TOPIC).status_code, 200)
            self.assertEqual(api.get("/api/neo4j/graph/ResearchIQ Test No Such Topic").status_code, 404)


CIT_ROOT = {"id": "http://arxiv.org/abs/1001.99994v3", "title": "ResearchIQ Test Citation Root",
            "year": "2020", "citations": 50, "authors": ["ResearchIQ Test Cite Author"]}
CIT_CITING = {"doi": "10.9999/RIQ-TEST-CITING", "title": "ResearchIQ Test Citing Paper", "year": "2022", "citations": 3}
CIT_REF = {"url": "https://arxiv.org/abs/1001.99993", "title": "ResearchIQ Test Referenced Paper", "year": "2018", "citations": 9}
CIT_IDS = ["http://arxiv.org/abs/1001.99994", "https://doi.org/10.9999/riq-test-citing", "http://arxiv.org/abs/1001.99993"]


class TestCitationNetwork(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_neo4j_schema()
        from app.db import knowledge_graph
        cls.kg = knowledge_graph
        cls.saved = knowledge_graph.save_citation_network(CIT_ROOT, [CIT_CITING], [CIT_REF])

    @classmethod
    def tearDownClass(cls):
        client = get_neo4j_client()
        if client.connect():
            client.execute_write("MATCH (p:Paper) WHERE p.id IN $ids DETACH DELETE p", {"ids": CIT_IDS})
            client.execute_write("MATCH (a:Author {name: 'ResearchIQ Test Cite Author'}) DETACH DELETE a")

    def test_01_saved_with_canonical_ids_and_direction(self):
        self.assertTrue(self.saved.get("saved"))
        self.assertEqual(self.saved.get("root_id"), CIT_IDS[0])
        rows = get_neo4j_client().execute_read(
            "MATCH (a:Paper)-[:CITES]->(b:Paper) WHERE a.id IN $ids AND b.id IN $ids RETURN a.id AS src, b.id AS dst",
            {"ids": CIT_IDS})
        self.assertEqual(sorted((r["src"], r["dst"]) for r in rows),
                         sorted([(CIT_IDS[1], CIT_IDS[0]), (CIT_IDS[0], CIT_IDS[2])]))

    def test_02_resave_never_resets_citation_count(self):
        self.kg.save_citation_network(dict(CIT_ROOT, citations=0), [CIT_CITING], [])
        rows = get_neo4j_client().execute_read("MATCH (p:Paper {id: $id}) RETURN p.citations AS c", {"id": CIT_IDS[0]})
        self.assertEqual(rows, [{"c": 50}])

    def test_03_empty_network_writes_nothing(self):
        res = self.kg.save_citation_network({"title": "ResearchIQ Test Lonely Paper"}, [], [])
        self.assertFalse(res.get("saved"))
        rows = get_neo4j_client().execute_read("MATCH (p:Paper {title: 'ResearchIQ Test Lonely Paper'}) RETURN count(p) AS n")
        self.assertEqual(rows, [{"n": 0}])

    def test_04_multihop_route(self):
        with TestClient(app) as api:
            res = api.post("/api/neo4j/citations/multihop", json={"title": "researchiq test citation root", "hops": 2})
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertEqual(body["root_id"], CIT_IDS[0])
            self.assertTrue(set(CIT_IDS) <= {n["id"] for n in body["nodes"]})
            self.assertEqual(body["links"], body["edges"])
            missing = api.post("/api/neo4j/citations/multihop", json={"title": "ResearchIQ Test No Such Paper", "hops": 2})
            self.assertEqual(missing.status_code, 404)
            self.assertEqual(api.post("/api/neo4j/citations/multihop", json={"title": "x", "hops": 9}).status_code, 422)


def _tiny_pdf(text: str) -> bytes:
    """A one-page PDF with extractable text, built by hand so no PDF library is needed."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return out


class TestPdfRag(unittest.TestCase):
    PDF = _tiny_pdf("ResearchIQ fixture: graph attention networks use masked self attention over neighbours.")

    def setUp(self):
        from app.rag.pdf_engine import pdf_store
        pdf_store.clear()

    def tearDown(self):
        from app.rag.pdf_engine import pdf_store
        pdf_store.clear()

    def _upload(self, api, data, name="fixture.pdf"):
        return api.post("/api/pdf/upload", files={"file": (name, data, "application/pdf")})

    def test_01_upload_dedupe_and_status(self):
        with TestClient(app) as api:
            first = self._upload(api, self.PDF)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(first.json()["info"]["pages"], 1)
            self.assertGreaterEqual(first.json()["info"]["chunks"], 1)
            again = self._upload(api, self.PDF, "renamed.pdf")
            self.assertTrue(again.json()["info"]["already_loaded"])
            status = api.get("/api/pdf/status").json()
            self.assertEqual(status["loaded"], 1)
            self.assertEqual([p["name"] for p in status["papers"]], ["fixture.pdf"])
            self.assertEqual(api.delete("/api/pdf/clear").json()["stats"]["loaded"], 0)

    def test_02_rejects_bad_input(self):
        with TestClient(app) as api:
            self.assertEqual(self._upload(api, self.PDF, "notes.txt").status_code, 400)
            self.assertEqual(self._upload(api, b"not a pdf at all").status_code, 400)
            with mock.patch.dict(os.environ, {"PDF_MAX_MB": "1"}):
                self.assertEqual(self._upload(api, b"%PDF-" + b"0" * (1024 * 1024)).status_code, 413)
            self.assertEqual(api.post("/api/pdf/fetch_arxiv", json={"arxiv_id": "../../etc/passwd"}).status_code, 400)

    def test_03_chat_answers_with_page_excerpts_and_maps_llm_errors(self):
        from app.api import routes
        from app.agents.research_agent import LLMError
        with TestClient(app) as api:
            self._upload(api, self.PDF)
            with mock.patch.object(routes, "answer_pdf_question", mock.AsyncMock(return_value="Masked attention [Page 1]")):
                res = api.post("/api/pdf/chat", json={"question": "how does graph attention work"})
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.json()["chunks"][0]["page"], 1)
            with mock.patch.object(routes, "answer_pdf_question", mock.AsyncMock(side_effect=LLMError("GROQ_API_KEY is not set"))):
                res = api.post("/api/pdf/chat", json={"question": "graph attention"})
                self.assertEqual(res.status_code, 502)
                self.assertIn("GROQ_API_KEY", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
