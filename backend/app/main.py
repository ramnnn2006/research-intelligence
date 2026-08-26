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

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize Neo4j graph database schema & constraints on startup
    init_db()
    yield
    # Safely close Neo4j connection pool on shutdown
    close_neo4j_client()

app = FastAPI(title="Research Intelligence Platform (Neo4j Graph Powered)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)
app.include_router(router)

# Serve React frontend build (or plain HTML fallback)
static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
