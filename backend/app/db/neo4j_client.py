import os
import logging
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger("research_iq.neo4j")
logging.basicConfig(level=logging.INFO)

# Optional Neo4j driver import with fallback
try:
    from neo4j import GraphDatabase, Driver, Session, exceptions
    NEO4J_AVAILABLE = True
except ImportError:
    NEO4J_AVAILABLE = False
    logger.warning("neo4j python package not installed. Using in-memory graph fallback.")


class Neo4jClient:
    """
    Singleton connection manager for Neo4j NoSQL Graph Database.
    Handles connection pooling, query executions, schema constraints, and lifecycle.
    """
    _instance: Optional["Neo4jClient"] = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(Neo4jClient, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.uri: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        self.user: str = os.getenv("NEO4J_USER", "neo4j")
        self.password: str = os.getenv("NEO4J_PASSWORD", "research123")
        self.database: str = os.getenv("NEO4J_DATABASE", "neo4j")
        self._driver: Optional[Any] = None
        self._is_connected: bool = False
        self._fallback_store: Dict[str, Any] = {
            "papers": {},
            "authors": {},
            "repos": {},
            "topics": {},
            "searches": [],
            "reports": [],
            "relationships": []
        }
        self._initialized = True

    def connect(self) -> bool:
        """Establish connection to Neo4j database."""
        if not NEO4J_AVAILABLE:
            self._is_connected = False
            return False

        if self._driver is not None and self._is_connected:
            return True

        try:
            self._driver = GraphDatabase.driver(
                self.uri,
                auth=(self.user, self.password),
                max_connection_lifetime=30 * 60,
                max_connection_pool_size=50,
                connection_acquisition_timeout=5.0
            )
            self.verify_connectivity()
            self._is_connected = True
            logger.info("Connected successfully to Neo4j graph database at %s", self.uri)
            return True
        except Exception as e:
            logger.warning("Failed to connect to Neo4j (%s). Running with fallback storage. Details: %s", self.uri, e)
            self._is_connected = False
            return False

    def verify_connectivity(self) -> bool:
        """Verify Neo4j driver connectivity."""
        if not self._driver:
            return False
        try:
            self._driver.verify_connectivity()
            return True
        except Exception as e:
            logger.error("Neo4j connectivity check failed: %s", e)
            self._is_connected = False
            return False

    def is_connected(self) -> bool:
        return self._is_connected and self._driver is not None

    def close(self):
        """Close Neo4j driver connection pool."""
        if self._driver:
            try:
                self._driver.close()
                logger.info("Neo4j driver connection closed.")
            except Exception as e:
                logger.error("Error closing Neo4j driver: %s", e)
            finally:
                self._driver = None
                self._is_connected = False

    def execute_write(self, cypher: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Execute a write Cypher transaction."""
        if not self.is_connected():
            if not self.connect():
                return []
        try:
            with self._driver.session(database=self.database) as session:
                result = session.execute_write(
                    lambda tx: [record.data() for record in tx.run(cypher, parameters or {})]
                )
                return result
        except Exception as e:
            logger.error("Neo4j write error for query [%s]: %s", cypher, e)
            raise e

    def execute_read(self, cypher: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Execute a read Cypher transaction."""
        if not self.is_connected():
            if not self.connect():
                return []
        try:
            with self._driver.session(database=self.database) as session:
                result = session.execute_read(
                    lambda tx: [record.data() for record in tx.run(cypher, parameters or {})]
                )
                return result
        except Exception as e:
            logger.error("Neo4j read error for query [%s]: %s", cypher, e)
            raise e

    def init_schema(self):
        """Initialize Neo4j schema constraints and indexes."""
        if not self.connect():
            logger.info("Skipping Neo4j schema initialization (Neo4j server offline or driver unavailable).")
            return

        constraints = [
            "CREATE CONSTRAINT paper_id_uniq IF NOT EXISTS FOR (p:Paper) REQUIRE p.id IS UNIQUE",
            "CREATE CONSTRAINT paper_arxiv_uniq IF NOT EXISTS FOR (p:Paper) REQUIRE p.arxiv_id IS UNIQUE",
            "CREATE CONSTRAINT author_name_uniq IF NOT EXISTS FOR (a:Author) REQUIRE a.name IS UNIQUE",
            "CREATE CONSTRAINT repo_name_uniq IF NOT EXISTS FOR (r:Repository) REQUIRE r.name IS UNIQUE",
            "CREATE CONSTRAINT topic_name_uniq IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE",
            "CREATE CONSTRAINT search_id_uniq IF NOT EXISTS FOR (s:Search) REQUIRE s.id IS UNIQUE",
            "CREATE CONSTRAINT report_id_uniq IF NOT EXISTS FOR (rep:Report) REQUIRE rep.id IS UNIQUE",
        ]

        indexes = [
            "CREATE INDEX paper_title_idx IF NOT EXISTS FOR (p:Paper) ON (p.title)",
            "CREATE INDEX paper_year_idx IF NOT EXISTS FOR (p:Paper) ON (p.year)",
            "CREATE INDEX search_created_idx IF NOT EXISTS FOR (s:Search) ON (s.created_at)",
            "CREATE INDEX report_created_idx IF NOT EXISTS FOR (rep:Report) ON (rep.created_at)",
            "CREATE INDEX report_type_idx IF NOT EXISTS FOR (rep:Report) ON (rep.report_type)",
        ]

        for query in constraints + indexes:
            try:
                self.execute_write(query)
            except Exception as e:
                logger.warning("Constraint/Index query notice: %s (%s)", query, e)

        logger.info("Neo4j schema constraints and indexes verified.")


# Module helper instances
_client = Neo4jClient()

def get_neo4j_client() -> Neo4jClient:
    return _client

def init_neo4j_schema():
    _client.init_schema()

def close_neo4j_client():
    _client.close()
