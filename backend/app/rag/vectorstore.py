"""
Lightweight in-memory vector store using simple TF-IDF-style keyword overlap.
No external dependencies beyond stdlib. Replaced chromadb since it's not installed.
Papers are stored in memory and survive only for the process lifetime.
"""
import re, math
from collections import defaultdict

_store: list = []   # list of paper dicts

def _tokens(text: str) -> list:
    return re.findall(r"[a-z]+", text.lower())

def _score(query_tokens: set, doc_tokens: list) -> float:
    doc_set = set(doc_tokens)
    if not doc_set: return 0.0
    overlap = len(query_tokens & doc_set)
    return overlap / (1 + math.log(1 + len(doc_set)))

def add_papers(papers: list):
    global _store
    existing_titles = {p.get("title","").lower()[:60] for p in _store}
    for p in papers:
        key = p.get("title","").lower()[:60]
        if key and key not in existing_titles:
            _store.append(p)
            existing_titles.add(key)

def query(text: str, n_results: int = 8) -> list:
    if not _store: return []
    qtok = set(_tokens(text))
    scored = []
    for p in _store:
        doc = f"{p.get('title','')} {p.get('summary','')}"
        scored.append((p, _score(qtok, _tokens(doc))))
    scored.sort(key=lambda x: x[1], reverse=True)
    return [p for p, _ in scored[:n_results]]

def count() -> int:
    return len(_store)
