import base64
import csv
import io
import os
import secrets
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.main import app
from app.api import routes
from app.mcp.arxiv import ArxivMCP


@pytest.fixture
def access(monkeypatch):
    token = secrets.token_urlsafe(36)
    monkeypatch.setenv("API_AUTH_TOKEN", token)
    monkeypatch.setenv("API_AUTH_USER", "researchiq")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")
    return TestClient(app), {"Authorization": "Bearer " + token}, {"Authorization": "Basic " + base64.b64encode(("researchiq:" + token).encode()).decode()}


def test_all_api_routes_reject_unauthenticated(access):
    client, _, _ = access
    for route in app.routes:
        if getattr(route, "path", "").startswith("/api/"):
            method = next(iter(route.methods - {"HEAD", "OPTIONS"}))
            result = client.request(method, route.path)
            assert result.status_code == 401, (route.path, method, result.status_code)
    assert client.get("/openapi.json").status_code == 401


def test_fail_closed_configuration(access, monkeypatch):
    client, bearer, _ = access
    for token in ["", "short"]:
        monkeypatch.setenv("API_AUTH_TOKEN", token)
        assert client.get("/api/rag/count", headers=bearer).status_code == 503
    monkeypatch.setenv("API_AUTH_TOKEN", secrets.token_urlsafe(36))
    monkeypatch.setenv("CORS_ORIGINS", "*")
    assert client.get("/api/rag/count", headers=bearer).status_code == 503


def test_credentials_and_no_store(access):
    client, bearer, basic = access
    for headers in [bearer, basic]:
        r = client.get("/api/rag/count", headers=headers)
        assert r.status_code == 200
        assert r.headers["cache-control"] == "no-store"
    for value in ["Bearer wrong", "Basic !!!", "Basic bm9jb2xvbg==", "Digest nope"]:
        r = client.get("/api/rag/count", headers={"Authorization": value})
        assert r.status_code == 401
        assert "Basic" in r.headers["www-authenticate"]


def test_basic_csrf_and_bearer_delete(access):
    client, bearer, basic = access
    with patch.object(routes.pdf_store, "clear") as clear:
        assert client.delete("/api/pdf/clear", headers=basic).status_code == 403
        assert client.delete("/api/pdf/clear", headers={**basic, "Origin": "https://untrusted.invalid"}).status_code == 403
        assert client.get("/api/rag/count", headers={**basic, "Sec-Fetch-Site": "cross-site"}).status_code == 403
        assert not clear.called
        assert client.delete("/api/pdf/clear", headers={**basic, "Origin": "http://localhost:5173"}).status_code == 200
        assert clear.call_count == 1
        assert client.delete("/api/pdf/clear", headers=bearer).status_code == 200
        assert clear.call_count == 2
        assert client.delete("/api/pdf/clear", headers={**bearer, "Origin": "https://untrusted.invalid"}).status_code == 403
        assert clear.call_count == 2


@pytest.mark.parametrize("value", ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "  =1", "\t=1", "\r=1", "\n=1", "\ufeff=1", "\v=1", "\f=1"])
def test_csv_dangerous_cells(value):
    assert routes._csv_cell(value) == "'" + value


@pytest.mark.parametrize("value", ["ordinary paper", "paper, with comma", 'a "quoted" title', "", "https://arxiv.org/abs/1234.5678", -2, 3, None])
def test_csv_safe_cells_unchanged(value):
    assert routes._csv_cell(value) == value


def test_csv_exports_escape_all_text(access):
    client, bearer, _ = access
    data = {"nodes": [{"id": "=id", "label": "+title", "url": "@url", "year": 2024}, {"id": "other", "label": "normal"}], "links": [{"source": "=id", "target": "other", "relation": "-relation"}]}
    with patch.object(routes, "_subgraph", return_value=data):
        for table in ["nodes", "edges"]:
            r = client.get("/api/graph/export/csv?table=" + table, headers=bearer)
            assert r.status_code == 200
            rows = list(csv.reader(io.StringIO(r.text)))
            assert "'=id" in rows[1]
            assert "'+title" in rows[1]
            if table == "nodes":
                assert "'@url" in rows[1]
            else:
                assert "'-relation" in rows[1]


def test_arxiv_transport_is_https():
    assert ArxivMCP.BASE.startswith("https://")


def test_neo4j_no_default_credential():
    source = Path(__file__).resolve().parents[1]
    assert 'os.getenv("NEO4J_PASSWORD", "")' in (source / "backend/app/db/neo4j_client.py").read_text()
    assert "NEO4J_PASSWORD:-" not in (source / "docker-compose.yml").read_text()
    assert "NEO4J_PASSWORD=research123" not in (source / ".env.example").read_text()
