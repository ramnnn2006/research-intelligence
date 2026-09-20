"""
Automated Test Suite for Neo4j Graph Queries and CRUD Layer
Course: BCSE406L - NoSQL Databases (Review 2 Verification)
"""
import sys
import os
import unittest

# Add backend directory to module search path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.db.neo4j_client import get_neo4j_client
from app.db.crud import create_paper_node, read_paper_node, update_paper_citations, delete_paper_node
from app.db.queries import (
    get_coauthorship_network,
    get_paper_code_matching,
    get_indegree_centrality,
    get_topic_citation_distribution,
    get_author_productivity_ranking,
    get_cross_topic_research_gaps,
    explain_query
)

class TestNeo4jDatabase(unittest.TestCase):
    def setUp(self):
        self.client = get_neo4j_client()
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
        if network:
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
