import os
from contextlib import asynccontextmanager
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.routes import router
from app.db.database import init_db
from app.db.neo4j_client import close_neo4j_client
from app.db.health import get_db_health

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize Neo4j graph database schema & constraints on startup
    init_db()
    yield
    # Safely close Neo4j connection pool on shutdown
    close_neo4j_client()

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

def _cors_origins() -> list:
    """Comma-separated CORS_ORIGINS; the API has unauthenticated write endpoints, so no wildcard by default."""
    raw = os.getenv("CORS_ORIGINS", "").strip() or DEFAULT_CORS_ORIGINS
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]

app = FastAPI(title="Research Intelligence Platform (Neo4j Graph Powered)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"]
)
app.include_router(router)

@app.get("/api/db/health")
def db_health():
    """Live Neo4j diagnostics: pool, counts per label, indexes, heap and index advice."""
    return get_db_health()

# Serve React frontend build (or plain HTML fallback)
static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
