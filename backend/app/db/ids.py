"""
Canonical identifiers for Paper nodes.

The same arXiv paper arrives with a different URL from every source
(http vs https, /abs/ vs /pdf/, with or without a version suffix such
as v2). Using those raw URLs as the Paper key created duplicate nodes
that split citations, authors and PageRank. Every writer calls
canonical_paper_id() so one paper always maps to one node.

arXiv papers use the form  http://arxiv.org/abs/<id>  with no version
suffix, which matches the existing snapshot data once versions are
stripped. Other papers keep their id or URL as given.
"""
import re
from typing import Any, Dict

# New-style ids (2206.03003) and old-style ids (hep-th/9901001, math.GT/0309136)
_ARXIV_ID = r"(\d{4}\.\d{4,5}|[a-z][a-z\-]*(?:\.[A-Za-z]{2})?/\d{7})"
_ARXIV_URL = re.compile(r"arxiv\.org/(?:abs|pdf)/" + _ARXIV_ID + r"(?:v\d+)?(?:\.pdf)?/?(?:[?#].*)?$", re.I)
_ARXIV_BARE = re.compile(r"^(?:arxiv:)?" + _ARXIV_ID + r"(?:v\d+)?$", re.I)
_DOI_URL = re.compile(r"^https?://(?:dx\.)?doi\.org/", re.I)

ARXIV_ABS_PREFIX = "http://arxiv.org/abs/"


def arxiv_id_from(value: Any) -> str:
    """Return the versionless arXiv id found in a URL or bare id, or ''."""
    text = str(value or "").strip()
    if not text:
        return ""
    m = _ARXIV_URL.search(text) or _ARXIV_BARE.match(text)
    return m.group(1) if m else ""


def normalize_doi(value: Any) -> str:
    """Return a lowercase DOI without the resolver prefix, or ''."""
    text = _DOI_URL.sub("", str(value or "").strip())
    return text.lower() if text.startswith("10.") else ""


def canonical_paper_id(paper: Dict[str, Any]) -> str:
    """
    Stable Paper key for a paper dict from any source.

    Priority: arXiv id (from arxiv_id, url or id) > existing id > url >
    DOI > normalised title. Returns '' only when nothing usable exists.
    """
    for key in ("arxiv_id", "url", "id"):
        aid = arxiv_id_from(paper.get(key))
        if aid:
            return ARXIV_ABS_PREFIX + aid

    for key in ("id", "url"):
        value = str(paper.get(key) or "").strip()
        if value:
            # DOIs are case-insensitive, so CrossRef and OpenAlex forms must match
            doi = normalize_doi(value) if _DOI_URL.match(value) else ""
            return "https://doi.org/" + doi if doi else value

    doi = normalize_doi(paper.get("doi"))
    if doi:
        return "https://doi.org/" + doi

    title = re.sub(r"\s+", " ", str(paper.get("title") or "")).strip().lower()
    return "title:" + title[:200] if title else ""
