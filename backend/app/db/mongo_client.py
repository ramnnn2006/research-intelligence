"""
MongoDB document mirror for ResearchIQ.

Neo4j is the primary store. MongoDB keeps a document copy of papers, searches,
reports and chat messages, and serves reads when Neo4j is down. Search and
report ids are the same uuid strings Neo4j uses, stored as the document _id,
so both stores agree on identity and no ObjectId ever leaves this module.

Availability is probed once at startup (init_mongo_schema) and then cached:
a failed probe is remembered for FAIL_TTL seconds and refreshed by a
background thread, so requests never wait on an absent server. Every public
function is a cheap no-op (or returns an empty value) while Mongo is down.

Read shapes match app.db.database so these functions can stand in as the
fallback:
  get_reports      -> [{id, topic, report_type, created_at}]
  get_searches     -> [{id, query, created_at, repos: [{name, url, stars, description}]}]
  get_report_by_id -> {id, topic, report_type, content, created_at,
                       papers: [{id, title, arxiv_id, url, year, citations, authors}],
                       repos:  [{name, url, stars, description}]}
"""
import os
import re
import json
import time
import uuid
import logging
import datetime
import threading
from typing import Any, Dict, List, Optional

from app.db.ids import canonical_paper_id, arxiv_id_from

logger = logging.getLogger("research_iq.mongo")

try:
    from pymongo import MongoClient, UpdateOne, DESCENDING, ASCENDING
    from pymongo.errors import PyMongoError, ConnectionFailure, ServerSelectionTimeoutError, ConfigurationError
    PYMONGO_AVAILABLE = True
except ImportError:  # pymongo is optional; the mirror simply stays off
    PYMONGO_AVAILABLE = False
    PyMongoError = ConnectionFailure = ServerSelectionTimeoutError = ConfigurationError = Exception

SERVER_SELECTION_MS = 1500
FAIL_TTL = 30.0   # seconds a failed probe is trusted before re-probing
OK_TTL = 60.0     # seconds a successful probe is trusted before re-probing

_client = None
_client_uri: Optional[str] = None
_client_lock = threading.Lock()

_state: Dict[str, Any] = {"ok": None, "checked": 0.0, "error": None}
_probe_lock = threading.Lock()
_probe_running = False


# ── Configuration ───────────────────────────────────────────────────────────
def _uri() -> str:
    return (os.getenv("MONGODB_URI") or "").strip()


def _db_name() -> str:
    return (os.getenv("MONGODB_DATABASE") or os.getenv("MONGODB_DB_NAME") or "researchiq").strip()


_HOST_CHARS = re.compile(r"^[A-Za-z0-9.\-_:,\[\]%]+$")


def _host_label(uri: str) -> str:
    """
    Host list from a MongoDB URI with credentials, path and options removed.
    When the URI is ambiguous (an '@' only after the '?'), nothing is shown
    rather than risk printing part of a password.
    """
    if not uri:
        return ""
    rest = uri.split("://", 1)[-1]
    before_query = rest.split("?", 1)[0]
    if "@" in before_query:
        # Userinfo precedes the hosts, so text after the last '@' holds no credentials.
        hosts = before_query.rpartition("@")[2]
    elif "@" in rest:
        return ""
    else:
        hosts = before_query
    hosts = hosts.split("/", 1)[0]
    return hosts if _HOST_CHARS.match(hosts) else ""


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _iso(value: Any) -> str:
    """ISO-8601 UTC string with offset for a datetime, an ISO string, or None (now)."""
    if value is None or value == "":
        return _now_iso()
    if isinstance(value, datetime.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=datetime.timezone.utc)
        return value.astimezone(datetime.timezone.utc).isoformat()
    return str(value)


def _jsonable(value: Any) -> Any:
    """Recursively convert BSON values (ObjectId, datetime, bytes) to JSON types."""
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, datetime.datetime):
        return _iso(value)
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)  # ObjectId, Decimal128 and other BSON types


# ── Client and availability ─────────────────────────────────────────────────
def _get_client():
    """Lazily create the MongoClient. Returns None when Mongo is not configured."""
    global _client, _client_uri
    uri = _uri()
    if not PYMONGO_AVAILABLE or not uri:
        return None
    with _client_lock:
        if _client is not None and _client_uri == uri:
            return _client
        old = _client
        _client = MongoClient(
            uri,
            serverSelectionTimeoutMS=SERVER_SELECTION_MS,
            connectTimeoutMS=SERVER_SELECTION_MS,
            socketTimeoutMS=10000,
            appname="ResearchIQ",
            tz_aware=True,
        )
        _client_uri = uri
        if old is not None:
            try:
                old.close()
            except Exception:
                pass
        return _client


def _probe() -> bool:
    """Blocking ping. Updates the cached availability state."""
    try:
        client = _get_client()
        if client is None:
            ok, err = False, "not configured" if PYMONGO_AVAILABLE else "pymongo not installed"
        else:
            client.admin.command("ping")
            ok, err = True, None
    except Exception as e:
        ok, err = False, type(e).__name__
    if ok and _state["ok"] is not True:
        logger.info("MongoDB mirror available at %s", _host_label(_uri()))
    elif not ok and _state["ok"] is not False:
        logger.warning("MongoDB mirror unavailable (%s); continuing without it", err)
    _state.update(ok=ok, checked=time.monotonic(), error=err)
    return ok


def _background_probe() -> None:
    global _probe_running
    try:
        _probe()
    finally:
        with _probe_lock:
            _probe_running = False


def is_available() -> bool:
    """
    Cached availability. Never blocks a request except for the very first
    call when init_mongo_schema() was not run at startup. Stale results are
    refreshed by a background thread while the cached answer is returned.
    """
    global _probe_running
    if not PYMONGO_AVAILABLE or not _uri():
        return False
    ok = _state["ok"]
    if ok is None:
        return _probe()
    ttl = OK_TTL if ok else FAIL_TTL
    if time.monotonic() - _state["checked"] >= ttl:
        with _probe_lock:
            if not _probe_running:
                _probe_running = True
                threading.Thread(target=_background_probe, name="mongo-probe", daemon=True).start()
    return bool(ok)


def _mark_down(exc: Exception) -> None:
    """Record a connection-level failure seen during an operation."""
    if isinstance(exc, (ConnectionFailure, ServerSelectionTimeoutError, ConfigurationError)):
        _state.update(ok=False, checked=time.monotonic(), error=type(exc).__name__)


def _db():
    """Database handle, or None when Mongo is unavailable."""
    if not is_available():
        return None
    try:
        client = _get_client()
    except Exception as e:  # e.g. SRV lookup failure after a URI change
        _state.update(ok=False, checked=time.monotonic(), error=type(e).__name__)
        return None
    return client[_db_name()] if client is not None else None


# ── Document shaping ────────────────────────────────────────────────────────
def _authors(p: Dict[str, Any]) -> List[str]:
    return [str(a).strip() for a in (p.get("authors") or []) if str(a or "").strip()]


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _paper_ref(p: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Paper shape used inside reports (matches database.get_report_by_id)."""
    pid = canonical_paper_id(p)
    if not pid:
        return None
    aid = arxiv_id_from(p.get("arxiv_id")) or arxiv_id_from(pid) or None
    return {
        "id": pid,
        "title": str(p.get("title") or "")[:250],
        "arxiv_id": aid,
        "url": str(p.get("url") or ("" if pid.startswith("title:") else pid)),
        "year": str(p.get("year") or ""),
        "citations": _int(p.get("citations")),
        "authors": _authors(p),
    }


def _repo_ref(r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    name = str(r.get("name") or "")[:150]
    if not name:
        return None
    return {
        "name": name,
        "url": str(r.get("url") or ""),
        "stars": _int(r.get("stars")),
        "description": str(r.get("description") or "")[:500],
    }


def _clean_list(items: Any, fn) -> List[Dict[str, Any]]:
    out = []
    for item in items or []:
        if isinstance(item, dict):
            shaped = fn(item)
            if shaped:
                out.append(shaped)
    return out


# ── Schema ──────────────────────────────────────────────────────────────────
def init_mongo_schema() -> bool:
    """Probe once (call at startup) and ensure indexes. Returns availability."""
    if not PYMONGO_AVAILABLE or not _uri():
        logger.info("MongoDB mirror disabled (%s)", "MONGODB_URI not set" if PYMONGO_AVAILABLE else "pymongo not installed")
        return False
    if not _probe():
        return False
    db = _db()
    if db is None:
        return False
    try:
        db.papers.create_index([("title", ASCENDING)])
        db.searches.create_index([("created_at", DESCENDING)])
        db.reports.create_index([("created_at", DESCENDING)])
        db.reports.create_index([("topic", ASCENDING)])
        db.chat_messages.create_index([("session_id", ASCENDING), ("created_at", ASCENDING)])
        return True
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB index creation failed: %s", type(e).__name__)
        return False


# ── Writes ──────────────────────────────────────────────────────────────────
def save_papers(papers: List[Dict[str, Any]]) -> int:
    """Upsert papers keyed by canonical_paper_id. Returns the number written."""
    db = _db()
    if db is None or not papers:
        return 0
    now = _now_iso()
    ops = []
    seen = set()
    for p in papers:
        if not isinstance(p, dict):
            continue
        pid = canonical_paper_id(p)
        if not pid or pid in seen:
            continue
        seen.add(pid)
        doc = {
            "id": pid,
            "arxiv_id": arxiv_id_from(p.get("arxiv_id")) or arxiv_id_from(pid) or None,
            "title": str(p.get("title") or "")[:250],
            "abstract": str(p.get("summary") or p.get("abstract") or "")[:3000],
            "year": str(p.get("year") or ""),
            "url": str(p.get("url") or ("" if pid.startswith("title:") else pid)),
            "source": str(p.get("source") or "unknown"),
            "authors": _authors(p),
            "updated_at": now,
        }
        ops.append(UpdateOne(
            {"_id": pid},
            {"$set": doc,
             "$max": {"citations": _int(p.get("citations"))},
             "$setOnInsert": {"created_at": now}},
            upsert=True,
        ))
    if not ops:
        return 0
    try:
        res = db.papers.bulk_write(ops, ordered=False)
        return int(res.upserted_count + res.matched_count)
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB save_papers failed: %s", type(e).__name__)
        return 0


def save_search(search_id: str, query: str, papers: List[Dict[str, Any]],
                repos: List[Dict[str, Any]], created_at: Any = None) -> bool:
    """Mirror a search record under the same id Neo4j uses."""
    db = _db()
    if db is None or not search_id:
        return False
    doc = {
        "_id": str(search_id),
        "query": str(query or ""),
        "created_at": _iso(created_at),
        "papers": _clean_list(papers, _paper_ref)[:50],
        "repos": _clean_list(repos, _repo_ref),
    }
    try:
        db.searches.replace_one({"_id": doc["_id"]}, doc, upsert=True)
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB save_search failed: %s", type(e).__name__)
        return False
    save_papers(papers or [])
    return True


def save_report(report_id: str, topic: str, rtype: str, content: Any,
                repos: List[Dict[str, Any]] = None, papers: List[Dict[str, Any]] = None,
                created_at: Any = None) -> bool:
    """Mirror a generated report under the same id Neo4j uses."""
    db = _db()
    if db is None or not report_id:
        return False
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False, default=str)
    doc = {
        "_id": str(report_id),
        "topic": str(topic or ""),
        "report_type": str(rtype or ""),
        "content": content,
        "created_at": _iso(created_at),
        "papers": _clean_list(papers, _paper_ref),
        "repos": _clean_list(repos, _repo_ref),
    }
    try:
        db.reports.replace_one({"_id": doc["_id"]}, doc, upsert=True)
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB save_report failed: %s", type(e).__name__)
        return False
    save_papers(papers or [])
    return True


def save_chat_message(session_id: str, role: str, content: str,
                      sources: List[Dict[str, Any]] = None) -> Optional[str]:
    """Append one chat message. Returns the message id, or None when Mongo is down."""
    db = _db()
    if db is None:
        return None
    mid = uuid.uuid4().hex
    doc = {
        "_id": mid,
        "session_id": str(session_id or "default"),
        "role": str(role or "user"),
        "content": str(content or ""),
        "sources": _jsonable([s for s in (sources or []) if isinstance(s, dict)][:10]),
        "created_at": _now_iso(),
    }
    try:
        db.chat_messages.insert_one(doc)
        return mid
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB save_chat_message failed: %s", type(e).__name__)
        return None


# ── Reads (same shapes as app.db.database) ──────────────────────────────────
def _limit(value: Any, default: int) -> int:
    try:
        return max(1, min(int(value), 500))
    except (TypeError, ValueError):
        return default


def get_reports(limit: int = 50) -> List[Dict[str, Any]]:
    db = _db()
    if db is None:
        return []
    try:
        cursor = db.reports.find({}, {"topic": 1, "report_type": 1, "created_at": 1}) \
                           .sort("created_at", DESCENDING).limit(_limit(limit, 50))
        return [_jsonable({
            "id": d["_id"],
            "topic": d.get("topic", ""),
            "report_type": d.get("report_type", ""),
            "created_at": d.get("created_at", ""),
        }) for d in cursor]
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB get_reports failed: %s", type(e).__name__)
        return []


def get_searches(limit: int = 30) -> List[Dict[str, Any]]:
    db = _db()
    if db is None:
        return []
    try:
        cursor = db.searches.find({}, {"query": 1, "created_at": 1, "repos": 1}) \
                            .sort("created_at", DESCENDING).limit(_limit(limit, 30))
        return [_jsonable({
            "id": d["_id"],
            "query": d.get("query", ""),
            "created_at": d.get("created_at", ""),
            "repos": d.get("repos") or [],
        }) for d in cursor]
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB get_searches failed: %s", type(e).__name__)
        return []


def get_report_by_id(rid: Any) -> Optional[Dict[str, Any]]:
    db = _db()
    if db is None or rid is None:
        return None
    try:
        d = db.reports.find_one({"_id": str(rid)})
    except PyMongoError as e:
        _mark_down(e)
        logger.warning("MongoDB get_report_by_id failed: %s", type(e).__name__)
        return None
    if not d:
        return None
    return _jsonable({
        "id": d["_id"],
        "topic": d.get("topic", ""),
        "report_type": d.get("report_type", ""),
        "content": d.get("content", ""),
        "created_at": d.get("created_at", ""),
        "papers": [p for p in (d.get("papers") or []) if isinstance(p, dict)],
        "repos": [r for r in (d.get("repos") or []) if isinstance(r, dict) and r.get("name")],
    })


def get_chat_messages(session_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """Messages of one chat session in chronological order."""
    db = _db()
    if db is None:
        return []
    try:
        cursor = db.chat_messages.find({"session_id": str(session_id or "default")}) \
                                 .sort("created_at", ASCENDING).limit(_limit(limit, 100))
        out = []
        for d in cursor:
            d["id"] = d.pop("_id")
            out.append(_jsonable(d))
        return out
    except PyMongoError as e:
        _mark_down(e)
        return []


def get_mongo_stats() -> Dict[str, Any]:
    """{connected, db, host, stats}. host never includes credentials."""
    info: Dict[str, Any] = {
        "connected": False,
        "db": _db_name(),
        "host": _host_label(_uri()),
        "stats": {"papers": 0, "searches": 0, "reports": 0, "chat_messages": 0},
    }
    if not PYMONGO_AVAILABLE:
        info["error"] = "pymongo not installed"
        return info
    if not _uri():
        info["error"] = "MONGODB_URI not set"
        return info
    db = _db()
    if db is None:
        info["error"] = _state.get("error") or "unavailable"
        return info
    try:
        info["stats"] = {
            "papers": db.papers.estimated_document_count(),
            "searches": db.searches.estimated_document_count(),
            "reports": db.reports.estimated_document_count(),
            "chat_messages": db.chat_messages.estimated_document_count(),
        }
        info["connected"] = True
    except PyMongoError as e:
        _mark_down(e)
        info["error"] = type(e).__name__
    return info


def close_mongo_client() -> None:
    """Close the client on shutdown."""
    global _client, _client_uri
    with _client_lock:
        if _client is not None:
            try:
                _client.close()
            except Exception:
                pass
        _client, _client_uri = None, None
    _state.update(ok=None, checked=0.0, error=None)
