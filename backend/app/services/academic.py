"""
Citation networks and author portfolios from OpenAlex, Semantic Scholar, arXiv
and the local Neo4j graph.

Public API (return shapes are what the frontend CitationModal and author view read):

  await get_paper_citations(title, limit=15) ->
      {success, paper, citations, references, citation_count, graph, source}
  await search_author_portfolio(name, max_results=20) ->
      {success, author, papers, co_authors, total_papers, graph}

All network I/O is aiohttp. Neo4j and MongoDB work runs in worker threads with a
time limit, so a slow or absent database never blocks the event loop or the reply.
"""
import os
import re
import asyncio
import logging
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

from app.db import knowledge_graph, mongo_client
from app.db.ids import canonical_paper_id, arxiv_id_from, normalize_doi

logger = logging.getLogger("research_iq.academic")

USER_AGENT = "ResearchIQ/1.0"
OPENALEX = "https://api.openalex.org"
S2 = "https://api.semanticscholar.org/graph/v1"
ARXIV_API = "https://export.arxiv.org/api/query"
ATOM = "{http://www.w3.org/2005/Atom}"

HTTP_TIMEOUT = aiohttp.ClientTimeout(total=12)
DB_TIMEOUT = 10.0  # seconds allowed for a Neo4j/Mongo read or write before the reply goes out without it

OA_LIST_FIELDS = "id,doi,title,publication_year,cited_by_count,primary_location,authorships"
OA_WORK_FIELDS = OA_LIST_FIELDS + ",referenced_works,abstract_inverted_index,locations"
S2_PAPER_FIELDS = "paperId,title,year,citationCount,externalIds,url,authors"

_ARXIV_DOI = re.compile(r"10\.48550/arxiv\.(.+)$", re.I)
_S2_ID = re.compile(r"^[0-9A-Za-z]{6,64}$")
_OA_ID = re.compile(r"^[WA]\d+$")


# ── Small helpers ───────────────────────────────────────────────────────────
def _usable_secret(value: Optional[str]) -> str:
    """Return the secret, or '' when it is blank or an .env.example placeholder."""
    text = (value or "").strip()
    lowered = text.lower()
    if not text or lowered.startswith("your_") or lowered.startswith("optional"):
        return ""
    return text


def _s2_headers() -> Dict[str, str]:
    headers = {"User-Agent": USER_AGENT}
    key = _usable_secret(os.getenv("SEMANTIC_SCHOLAR_API_KEY"))
    if key:
        headers["x-api-key"] = key
    return headers


def _norm(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _clean(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _clamp(value: Any, low: int, high: int, default: int) -> int:
    try:
        return max(low, min(int(value), high))
    except (TypeError, ValueError):
        return default


async def _get_json(session: aiohttp.ClientSession, url: str, params: Optional[Dict[str, Any]] = None,
                    headers: Optional[Dict[str, str]] = None) -> Optional[Any]:
    try:
        async with session.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT) as r:
            if r.status != 200:
                logger.info("GET %s returned %s", url, r.status)
                return None
            return await r.json(content_type=None)
    except Exception as e:
        logger.info("GET %s failed: %s", url, e)
        return None


async def _in_thread(fn, *args, default=None):
    """Run blocking database work in a thread with a time limit."""
    try:
        return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=DB_TIMEOUT)
    except asyncio.TimeoutError:
        logger.warning("%s took longer than %ss; continuing without it", getattr(fn, "__name__", fn), DB_TIMEOUT)
    except Exception as e:
        logger.warning("%s failed: %s", getattr(fn, "__name__", fn), e)
    return default


def _abstract_from_inverted_index(index: Any, max_words: int = 1200) -> str:
    """OpenAlex ships abstracts as {word: [positions]}; rebuild the text."""
    if not isinstance(index, dict) or not index:
        return ""
    slots: List[Tuple[int, str]] = []
    for word, positions in index.items():
        for pos in positions or []:
            if isinstance(pos, int) and 0 <= pos < 20000:
                slots.append((pos, str(word)))
    slots.sort()
    return " ".join(word for _, word in slots[:max_words])


def _node_link(nodes: Dict[str, Dict[str, Any]], links: List[Dict[str, Any]]) -> Dict[str, Any]:
    node_list = [dict(attrs, id=node_id) for node_id, attrs in nodes.items()]
    return {"directed": True, "multigraph": False, "graph": {},
            "nodes": node_list, "links": links, "edges": links}


# ── OpenAlex ────────────────────────────────────────────────────────────────
def _oa_authors(w: Dict[str, Any], cap: Optional[int] = None) -> List[str]:
    names = []
    for a in w.get("authorships") or []:
        name = ((a or {}).get("author") or {}).get("display_name")
        if name:
            names.append(name)
    return names[:cap] if cap else names


def _oa_arxiv_id(w: Dict[str, Any]) -> str:
    m = _ARXIV_DOI.search(str(w.get("doi") or ""))
    if m:
        aid = arxiv_id_from(m.group(1))
        if aid:
            return aid
    for loc in [w.get("primary_location")] + list(w.get("locations") or []):
        loc = loc or {}
        aid = arxiv_id_from(loc.get("landing_page_url")) or arxiv_id_from(loc.get("pdf_url"))
        if aid:
            return aid
    return ""


def _oa_paper(w: Dict[str, Any], author_cap: Optional[int] = 4) -> Dict[str, Any]:
    oa_id = str(w.get("id") or "")
    doi = normalize_doi(w.get("doi"))
    aid = _oa_arxiv_id(w)
    doi_url = f"https://doi.org/{doi}" if doi else ""
    landing = (w.get("primary_location") or {}).get("landing_page_url")
    paper = {
        "id": canonical_paper_id({"arxiv_id": aid, "id": doi_url or oa_id, "title": w.get("title")}),
        "title": _clean(w.get("title")),
        "year": str(w.get("publication_year") or ""),
        "citations": _int(w.get("cited_by_count")),
        "url": landing or doi_url or oa_id,
        "authors": _oa_authors(w, author_cap),
        "source": "openalex",
    }
    if aid:
        paper["arxiv_id"] = aid
    if doi:
        paper["doi"] = doi
    return paper


async def _oa_find_work(session: aiohttp.ClientSession, text: str) -> Optional[Dict[str, Any]]:
    """Resolve user input (title, arXiv id or DOI) to one OpenAlex work."""
    aid = arxiv_id_from(text)
    doi = normalize_doi(text)
    if doi and (".." in doi or not re.match(r"^10\.\d{4,9}/\S+$", doi)):
        doi = ""
    if aid or doi:
        key = f"doi:10.48550/arxiv.{aid}" if aid else f"doi:{doi}"
        w = await _get_json(session, f"{OPENALEX}/works/{key}", {"select": OA_WORK_FIELDS},
                            {"User-Agent": USER_AGENT})
        if w and w.get("id"):
            return w
    query = _clean(text.replace("|", " "))[:300]
    data = await _get_json(session, f"{OPENALEX}/works",
                           {"filter": f"title.search:{query}", "per-page": 5, "select": OA_WORK_FIELDS},
                           {"User-Agent": USER_AGENT})
    results = [w for w in (data or {}).get("results") or [] if w.get("title")]
    if not results:
        return None
    wanted = _norm(text)
    for w in results:
        if _norm(w.get("title")) == wanted:
            return w
    return results[0]


async def _oa_citations(session: aiohttp.ClientSession, text: str, limit: int):
    """Returns (root_paper, citing, references); root_paper is None when nothing matched."""
    w = await _oa_find_work(session, text)
    if not w:
        return None, [], []
    root = _oa_paper(w, author_cap=None)
    root["abstract"] = _abstract_from_inverted_index(w.get("abstract_inverted_index"))
    wid = str(w.get("id") or "").rsplit("/", 1)[-1]
    if not _OA_ID.match(wid):
        return root, [], []

    ref_ids = []
    for ref in w.get("referenced_works") or []:
        rid = str(ref).rsplit("/", 1)[-1]
        if _OA_ID.match(rid):
            ref_ids.append(rid)
    ref_ids = ref_ids[:min(limit, 50)]

    headers = {"User-Agent": USER_AGENT}
    citing_req = _get_json(session, f"{OPENALEX}/works", {
        "filter": f"cites:{wid}", "sort": "cited_by_count:desc",
        "per-page": limit, "select": OA_LIST_FIELDS}, headers)

    async def no_refs():
        return None
    refs_req = _get_json(session, f"{OPENALEX}/works", {
        "filter": "openalex_id:" + "|".join(ref_ids),
        "per-page": len(ref_ids), "select": OA_LIST_FIELDS}, headers) if ref_ids else no_refs()

    c_data, r_data = await asyncio.gather(citing_req, refs_req)
    citing = [_oa_paper(x) for x in (c_data or {}).get("results") or [] if x.get("title")]
    refs = [_oa_paper(x) for x in (r_data or {}).get("results") or [] if x.get("title")]
    refs.sort(key=lambda p: p["citations"], reverse=True)
    return root, citing, refs


# ── Semantic Scholar ────────────────────────────────────────────────────────
def _s2_paper(p: Dict[str, Any], author_cap: Optional[int] = 4) -> Optional[Dict[str, Any]]:
    if not isinstance(p, dict) or not p.get("title"):
        return None
    ext = p.get("externalIds") or {}
    aid = arxiv_id_from(ext.get("ArXiv"))
    doi = normalize_doi(ext.get("DOI"))
    s2_url = p.get("url") or (f"https://www.semanticscholar.org/paper/{p['paperId']}" if p.get("paperId") else "")
    doi_url = f"https://doi.org/{doi}" if doi else ""
    authors = [a.get("name") for a in (p.get("authors") or []) if isinstance(a, dict) and a.get("name")]
    paper = {
        "id": canonical_paper_id({"arxiv_id": aid, "id": doi_url or s2_url, "title": p.get("title")}),
        "title": _clean(p.get("title")),
        "year": str(p.get("year") or ""),
        "citations": _int(p.get("citationCount")),
        "url": f"https://arxiv.org/abs/{aid}" if aid else (doi_url or s2_url),
        "authors": authors[:author_cap] if author_cap else authors,
        "source": "semantic_scholar",
    }
    if aid:
        paper["arxiv_id"] = aid
    if doi:
        paper["doi"] = doi
    return paper


async def _s2_citations(session: aiohttp.ClientSession, text: str, limit: int):
    """Returns (root_paper, citing, references) from Semantic Scholar."""
    headers = _s2_headers()
    found = await _get_json(session, f"{S2}/paper/search",
                            {"query": _clean(text)[:300], "limit": 1, "fields": S2_PAPER_FIELDS}, headers)
    hits = (found or {}).get("data") or []
    if not hits or not _S2_ID.match(str(hits[0].get("paperId") or "")):
        return None, [], []
    hit = hits[0]
    pid = hit["paperId"]
    root = _s2_paper(hit, author_cap=None)
    fields = "title,year,citationCount,externalIds,url,authors"
    # Sequential on purpose: the keyless S2 tier rate-limits bursts.
    c_data = await _get_json(session, f"{S2}/paper/{pid}/citations",
                             {"fields": fields, "limit": limit}, headers)
    r_data = await _get_json(session, f"{S2}/paper/{pid}/references",
                             {"fields": fields, "limit": limit}, headers)
    citing = [x for x in (_s2_paper((i or {}).get("citingPaper")) for i in (c_data or {}).get("data") or []) if x]
    refs = [x for x in (_s2_paper((i or {}).get("citedPaper")) for i in (r_data or {}).get("data") or []) if x]
    return root, citing, refs


# ── Citation graph ──────────────────────────────────────────────────────────
def _build_rich_citation_graph(root_paper: dict, citing_papers: list, referenced_papers: list) -> dict:
    root_title = root_paper.get("title") or "Selected Paper"
    nodes: Dict[str, Dict[str, Any]] = {
        root_title: {"type": "root", "label": root_title[:60], "citations": root_paper.get("citations", 0),
                     "year": root_paper.get("year", ""), "size": 18, "is_top_influential": True}
    }
    links: List[Dict[str, Any]] = []
    seen_links = set()
    for c in citing_papers[:15]:
        t = c.get("title")
        if t and t != root_title:
            nodes.setdefault(t, {"type": "cited_by", "label": t[:50], "citations": c.get("citations", 0),
                                 "year": c.get("year", ""), "size": 11})
            if (t, root_title) not in seen_links:
                seen_links.add((t, root_title))
                links.append({"relation": "cited_by", "source": t, "target": root_title})
    for r in referenced_papers[:15]:
        t = r.get("title")
        if t and t != root_title:
            nodes.setdefault(t, {"type": "reference", "label": t[:50], "citations": r.get("citations", 0),
                                 "year": r.get("year", ""), "size": 10})
            if (root_title, t) not in seen_links:
                seen_links.add((root_title, t))
                links.append({"relation": "reference", "source": root_title, "target": t})
    return _node_link(nodes, links)


def _local_paper(p: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": p.get("id"), "title": p.get("title") or "", "year": str(p.get("year") or ""),
            "citations": _int(p.get("citations")), "url": p.get("url") or "",
            "authors": [a for a in (p.get("authors") or []) if a][:4], "source": "neo4j"}


async def get_paper_citations(title: str, limit: int = 15) -> Dict[str, Any]:
    """
    Papers citing a paper and papers it cites.
    Order: OpenAlex, then Semantic Scholar, then the local Neo4j graph.
    External results are stored in Neo4j under the resolved paper's canonical id.
    """
    clean_title = _clean(title)
    if not clean_title:
        return {"success": False, "paper": {}, "citations": [], "references": [], "citation_count": 0,
                "graph": {"nodes": [], "links": [], "edges": []}, "source": "none"}
    limit = _clamp(limit, 1, 50, 15)

    root_paper: Optional[Dict[str, Any]] = None
    citing: List[Dict[str, Any]] = []
    refs: List[Dict[str, Any]] = []
    source = "openalex"

    async with aiohttp.ClientSession() as session:
        try:
            root_paper, citing, refs = await _oa_citations(session, clean_title, limit)
        except Exception as e:
            logger.warning("OpenAlex citation lookup failed: %s", e)

        if not citing and not refs:
            try:
                s2_root, s2_citing, s2_refs = await _s2_citations(session, clean_title, limit)
            except Exception as e:
                logger.warning("Semantic Scholar citation lookup failed: %s", e)
                s2_root, s2_citing, s2_refs = None, [], []
            if s2_citing or s2_refs:
                source = "semantic_scholar"
                citing, refs = s2_citing, s2_refs
                same_paper = root_paper and s2_root and (
                    root_paper["id"] == s2_root["id"] or _norm(root_paper["title"]) == _norm(s2_root["title"]))
                if same_paper:
                    root_paper["citations"] = max(root_paper["citations"], s2_root["citations"])
                else:
                    root_paper = s2_root
            elif root_paper is None:
                root_paper = s2_root

    # Only externally resolved data is written back; the stored graph is never re-saved.
    should_persist = bool(citing or refs) and root_paper is not None
    if not citing and not refs:
        for key in dict.fromkeys(k for k in ((root_paper or {}).get("id"), clean_title) if k):
            local = await _in_thread(knowledge_graph.get_local_citations, key, limit)
            if local and (local.get("citations") or local.get("references")):
                source = "neo4j"
                citing = [_local_paper(p) for p in local["citations"]]
                refs = [_local_paper(p) for p in local["references"]]
                if root_paper is None and local.get("root"):
                    root_paper = _local_paper(local["root"])
                    root_paper["arxiv_id"] = local["root"].get("arxiv_id")
                break

    if should_persist:
        await _in_thread(knowledge_graph.save_citation_network, root_paper, citing, refs)

    if root_paper is None:
        root_paper = {"title": clean_title, "citations": 0, "year": "", "authors": [], "url": ""}
        if not citing and not refs:
            source = "none"

    graph = _build_rich_citation_graph(root_paper, citing, refs)
    return {
        "success": True,
        "paper": root_paper,
        "citations": citing,
        "references": refs,
        "citation_count": root_paper.get("citations") or len(citing),
        "graph": graph,
        "source": source,
    }


# ── Author portfolio ────────────────────────────────────────────────────────
async def _oa_author(session: aiohttp.ClientSession, name: str, max_results: int):
    """Returns (author_info or None, works list)."""
    headers = {"User-Agent": USER_AGENT}
    data = await _get_json(session, f"{OPENALEX}/authors", {"search": name, "per-page": 3}, headers)
    results = (data or {}).get("results") or []
    if not results:
        return None, []
    best = results[0]
    affiliations = [((a or {}).get("institution") or {}).get("display_name")
                    for a in (best.get("affiliations") or [])[:3]]
    if not any(affiliations):
        affiliations = [(i or {}).get("display_name") for i in (best.get("last_known_institutions") or [])[:3]]
    info = {
        "name": best.get("display_name") or name,
        "affiliations": [a for a in affiliations if a],
        "works_count": _int(best.get("works_count")),
        "citation_count": _int(best.get("cited_by_count")),
        "h_index": _int((best.get("summary_stats") or {}).get("h_index")),
        "orcid": best.get("orcid") or "",
    }
    aid = str(best.get("id") or "").rsplit("/", 1)[-1]
    if not _OA_ID.match(aid):
        return info, []
    works = await _get_json(session, f"{OPENALEX}/works", {
        "filter": f"author.id:{aid}", "sort": "cited_by_count:desc", "per-page": max_results,
        "select": OA_LIST_FIELDS + ",abstract_inverted_index,locations"}, headers)
    return info, (works or {}).get("results") or []


async def _arxiv_author(session: aiohttp.ClientSession, name: str) -> List[Dict[str, Any]]:
    params = {"search_query": f'au:"{name}"', "start": 0, "max_results": 10,
              "sortBy": "submittedDate", "sortOrder": "descending"}
    try:
        async with session.get(ARXIV_API, params=params, headers={"User-Agent": USER_AGENT},
                               timeout=HTTP_TIMEOUT) as r:
            if r.status != 200:
                return []
            xml_text = await r.text()
        root = ET.fromstring(xml_text)
    except Exception as e:
        logger.info("arXiv author query failed: %s", e)
        return []
    entries = []
    for e in root.findall(f"{ATOM}entry"):
        title = _clean(e.findtext(f"{ATOM}title"))
        if not title:
            continue
        entry_id = _clean(e.findtext(f"{ATOM}id"))
        aid = arxiv_id_from(entry_id)
        entries.append({
            "id": canonical_paper_id({"arxiv_id": aid, "id": entry_id, "title": title}),
            "arxiv_id": aid or None,
            "title": title,
            "summary": _clean(e.findtext(f"{ATOM}summary")),
            "year": (e.findtext(f"{ATOM}published") or "")[:4],
            "url": f"https://arxiv.org/abs/{aid}" if aid else entry_id,
            "authors": [_clean(a.findtext(f"{ATOM}name")) for a in e.findall(f"{ATOM}author")
                        if _clean(a.findtext(f"{ATOM}name"))],
        })
    return entries


def _build_author_graph(author_info: dict, papers: list, co_authors: list) -> dict:
    author_node = author_info["name"]
    nodes: Dict[str, Dict[str, Any]] = {
        author_node: {"type": "author", "label": author_node, "size": 18, "is_top_influential": True}
    }
    links: List[Dict[str, Any]] = []
    for p in papers[:15]:
        title = p.get("title") or ""
        if title and title != author_node:
            nodes.setdefault(title, {"type": "paper", "label": title[:60], "year": p.get("year", ""),
                                     "citations": p.get("citations", 0), "size": 11})
            links.append({"relation": "authored", "source": author_node, "target": title})
    for ca in co_authors[:8]:
        name = ca.get("name")
        if name and name != author_node and name not in nodes:
            nodes[name] = {"type": "author", "label": name, "size": 9}
            links.append({"relation": "co_authored", "source": author_node, "target": name})
    return _node_link(nodes, links)


async def search_author_portfolio(author_name: str, max_results: int = 20) -> Dict[str, Any]:
    """
    A researcher's profile, papers, frequent co-authors and collaboration graph,
    combining OpenAlex, arXiv and papers already stored in Neo4j.
    """
    clean_name = _clean(author_name)
    if not clean_name:
        return {"success": False, "author": {}, "papers": [], "co_authors": [], "total_papers": 0,
                "graph": {"nodes": [], "links": [], "edges": []}}
    max_results = _clamp(max_results, 1, 100, 20)

    async with aiohttp.ClientSession() as session:
        oa_res, arxiv_entries, local_rows = await asyncio.gather(
            _oa_author(session, clean_name, max_results),
            _arxiv_author(session, clean_name),
            _in_thread(knowledge_graph.get_local_author_papers, clean_name, 20, default=[]),
            return_exceptions=True,
        )
    oa_info, oa_works = oa_res if isinstance(oa_res, tuple) else (None, [])
    arxiv_entries = arxiv_entries if isinstance(arxiv_entries, list) else []
    local_rows = local_rows if isinstance(local_rows, list) else []

    author_info = oa_info or {"name": clean_name, "affiliations": [], "works_count": 0,
                              "citation_count": 0, "h_index": 0, "orcid": ""}
    self_names = {_norm(clean_name), _norm(author_info["name"])}
    query_norm = _norm(clean_name)
    query_is_full_name = len(query_norm.split()) >= 2

    def is_self(name: str) -> bool:
        n = _norm(name)
        return n in self_names or (query_is_full_name and query_norm in n)

    papers_map: Dict[str, Dict[str, Any]] = {}
    co_author_counts: Dict[str, int] = {}

    def add_co_authors(names: List[str]) -> List[str]:
        co = [a for a in names if a and not is_self(a)]
        for ca in co:
            co_author_counts[ca] = co_author_counts.get(ca, 0) + 1
        return co

    for w in oa_works:
        if not w.get("title"):
            continue
        paper = _oa_paper(w, author_cap=30)
        co = add_co_authors(paper["authors"])
        paper.update({"co_authors": co[:4],
                      "summary": _abstract_from_inverted_index(w.get("abstract_inverted_index"))[:1500]})
        papers_map[_norm(paper["title"])[:70]] = paper

    for e in arxiv_entries:
        key = _norm(e["title"])[:70]
        co = add_co_authors(e["authors"])
        if key in papers_map:
            existing = papers_map[key]
            if not existing.get("summary") and e["summary"]:
                existing["summary"] = e["summary"]
            if e.get("arxiv_id") and not existing.get("arxiv_id"):
                existing["arxiv_id"] = e["arxiv_id"]
            continue
        paper = {"id": e["id"], "title": e["title"], "year": e["year"], "citations": 0,
                 "authors": e["authors"], "co_authors": co[:4], "url": e["url"],
                 "source": "arxiv", "summary": e["summary"]}
        if e.get("arxiv_id"):
            paper["arxiv_id"] = e["arxiv_id"]
        papers_map[key] = paper

    for row in local_rows:
        title = _clean(row.get("title"))
        if not title:
            continue
        key = _norm(title)[:70]
        co = add_co_authors([a for a in (row.get("authors") or []) if a])
        if key not in papers_map:
            papers_map[key] = {"id": row.get("id") or title, "title": title, "year": str(row.get("year") or ""),
                               "citations": _int(row.get("citations")), "authors": [author_info["name"]] + co,
                               "co_authors": co[:4], "url": row.get("url") or "",
                               "source": row.get("source") or "neo4j", "summary": ""}

    papers_list = list(papers_map.values())
    papers_list.sort(key=lambda x: (x.get("citations") or 0, x.get("year") or "0"), reverse=True)
    top_co_authors = [{"name": n, "collaborations": c}
                      for n, c in sorted(co_author_counts.items(), key=lambda x: x[1], reverse=True)[:10]]

    if not author_info["works_count"]:
        author_info["works_count"] = len(papers_list)
    if not author_info["citation_count"]:
        author_info["citation_count"] = sum(p.get("citations") or 0 for p in papers_list)

    # Only papers that verifiably belong to this author are linked in the graph:
    # every OpenAlex work of the matched author id, and arXiv entries listing the exact name.
    owned = [p for p in papers_list
             if p["source"] == "openalex"
             or (p["source"] == "arxiv" and any(_norm(a) in self_names for a in p.get("authors") or []))]
    if owned:
        await asyncio.gather(
            _in_thread(knowledge_graph.save_author_portfolio, author_info["name"], owned),
            _in_thread(mongo_client.save_papers, owned),
        )

    # OpenAlex, arXiv and Neo4j results are merged above, so cap the combined list here
    shown = papers_list[:max_results]
    return {
        "success": True,
        "author": author_info,
        "papers": shown,
        "co_authors": top_co_authors,
        "total_papers": len(papers_list),
        "graph": _build_author_graph(author_info, shown, top_co_authors),
    }
