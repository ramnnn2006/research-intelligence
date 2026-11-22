import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.main import app  # noqa: F401  loads .env before the Neo4j client reads its settings
from app.db.neo4j_client import get_neo4j_client, init_neo4j_schema
from app.db.crud import create_paper_node
from app.db.database import save_search
from app.db import knowledge_graph

ARXIV_ID = "1001.99996"
SPELLINGS = [
    "http://arxiv.org/abs/" + ARXIV_ID,
    "https://arxiv.org/abs/" + ARXIV_ID + "v2",
    "https://arxiv.org/pdf/" + ARXIV_ID + ".pdf",
    "arXiv:" + ARXIV_ID,
]


def _paper(spelling, title="ResearchIQ Test Identity Paper"):
    return {"id": spelling, "url": spelling, "arxiv_id": ARXIV_ID, "title": title, "authors": ["ResearchIQ Test Author A"]}


def _count():
    rows = get_neo4j_client().execute_read(
        "MATCH (p:Paper) WHERE p.arxiv_id = $a OR p.id CONTAINS $a RETURN count(p) AS n", {"a": ARXIV_ID})
    return rows[0]["n"]


def _purge():
    get_neo4j_client().execute_write(
        "MATCH (p:Paper) WHERE p.arxiv_id = $a OR p.id CONTAINS $a DETACH DELETE p", {"a": ARXIV_ID})
    get_neo4j_client().execute_write(
        "MATCH (n) WHERE (n:Author OR n:Topic) AND (n.name STARTS WITH 'ResearchIQ Test Identity' OR n.name = 'ResearchIQ Test Author A') DETACH DELETE n")


@pytest.fixture(autouse=True)
def clean_graph():
    client = get_neo4j_client()
    if not client.connect():
        pytest.fail("Neo4j is not reachable; start it with docker compose up -d")
    init_neo4j_schema()
    _purge()
    yield
    _purge()


def test_every_writer_keeps_one_node_per_paper():
    for i, spelling in enumerate(SPELLINGS):
        create_paper_node(_paper(spelling))
        save_search("ResearchIQ Test Identity Topic", [_paper(spelling)], [])
        knowledge_graph.save_author_portfolio("ResearchIQ Test Identity Author", [_paper(spelling)])
        other = {"id": "https://doi.org/10.0000/researchiq-test-" + str(i), "title": "ResearchIQ Test Identity Neighbour " + str(i)}
        knowledge_graph.save_citation_network(_paper(spelling), [other], [])
    assert _count() == 1


def test_lookup_accepts_every_spelling():
    create_paper_node(_paper(SPELLINGS[0]))
    from app.db.crud import read_paper_node
    for spelling in SPELLINGS:
        found = read_paper_node(spelling)
        assert found and found["title"] == "ResearchIQ Test Identity Paper", spelling
