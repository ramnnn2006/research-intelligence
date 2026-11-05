"""
Lightweight in-memory vector store using simple TF-IDF-style keyword overlap.
No external dependencies beyond stdlib. Replaced chromadb since it's not installed.
Papers are stored in memory and survive only for the process lifetime.
"""
import re, math, threading
from collections import defaultdict

_store: list = []   # list of paper dicts
# routes call add_papers / query from the threadpool, so guard the shared list
_lock = threading.Lock()

def _tokens(text: str) -> list:
    return re.findall(r"[a-z]+", text.lower())

def _score(query_tokens: set, doc_tokens: list) -> float:
    doc_set = set(doc_tokens)
    if not doc_set: return 0.0
    overlap = len(query_tokens & doc_set)
    return overlap / (1 + math.log(1 + len(doc_set)))

def _key(p: dict) -> str:
    return (p.get("title") or "").lower()[:60]

def add_papers(papers: list):
    with _lock:
        existing_titles = {_key(p) for p in _store}
        for p in papers or []:
            key = _key(p)
            if key and key not in existing_titles:
                _store.append(p)
                existing_titles.add(key)

def query(text: str, n_results: int = 8) -> list:
    with _lock:
        snapshot = list(_store)
    if not snapshot: return []
    qtok = set(_tokens(text))
    scored = []
    for p in snapshot:
        doc = f"{p.get('title') or ''} {p.get('summary') or ''}"
        scored.append((p, _score(qtok, _tokens(doc))))
    scored.sort(key=lambda x: x[1], reverse=True)
    return [p for p, _ in scored[:n_results]]

def count() -> int:
    return len(_store)
