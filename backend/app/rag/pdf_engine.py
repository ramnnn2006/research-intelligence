"""
In-memory full-text store for PDF question answering.

PDFs are split into overlapping chunks per page and searched by term overlap.
Limits and safety:
  * size cap: PDF_MAX_MB (default 25) for uploads and while streaming arXiv downloads
  * page cap: PDF_MAX_PAGES (default 600)
  * at most PDF_MAX_DOCS documents (default 20); the oldest is dropped first
  * a PDF already loaded (same sha256) is not parsed again
  * arXiv downloads only ever go to https://arxiv.org/pdf/<validated id>

add_pdf_bytes() parses synchronously; call it with asyncio.to_thread from async code.
It raises ValueError with a readable message for files that are too large, empty,
not PDFs, encrypted or unparseable.
"""
import io
import os
import re
import math
import hashlib
import logging
import threading
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlsplit

import aiohttp
import pypdf

from app.db.ids import arxiv_id_from

logger = logging.getLogger("research_iq.pdf")

CHUNK_SIZE = 700
CHUNK_OVERLAP = 120
MIN_CHUNK_CHARS = 80
USER_AGENT = "ResearchIQ/1.0"
_ARXIV_HOSTS = {"arxiv.org", "export.arxiv.org", "www.arxiv.org"}
_TOKEN = re.compile(r"[a-z0-9]+")


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(int(os.getenv(name, default)), high))
    except (TypeError, ValueError):
        return default


class PDFTooLarge(ValueError):
    """The PDF exceeds the configured size or page limit."""


def max_pdf_bytes() -> int:
    return _env_int("PDF_MAX_MB", 25, 1, 500) * 1024 * 1024


def max_pdf_mb() -> int:
    return max_pdf_bytes() // (1024 * 1024)


class PDFChunkStore:
    def __init__(self):
        self._lock = threading.Lock()
        self.chunks: List[Dict[str, Any]] = []
        self.loaded_papers: List[Dict[str, Any]] = []   # [{name, pages, chunks, sha256}]

    # ── Mutations ───────────────────────────────────────────────────────────
    def clear(self) -> None:
        with self._lock:
            self.chunks = []
            self.loaded_papers = []

    def add_pdf_bytes(self, pdf_bytes: bytes, filename: str) -> Dict[str, Any]:
        """
        Parse and index one PDF. Returns {name, pages, chunks, sha256, already_loaded}.
        Re-adding the same bytes returns the stored info without parsing again.
        """
        data = bytes(pdf_bytes or b"")
        limit = max_pdf_bytes()
        if not data:
            raise ValueError("The PDF is empty.")
        if len(data) > limit:
            raise PDFTooLarge(f"The PDF is {len(data) / 1048576:.1f} MB; the limit is {max_pdf_mb()} MB.")
        if b"%PDF-" not in data[:1024]:
            raise ValueError("The file is not a PDF.")

        digest = hashlib.sha256(data).hexdigest()
        with self._lock:
            for info in self.loaded_papers:
                if info["sha256"] == digest:
                    return dict(info, already_loaded=True)

        pages, new_chunks = self._parse(data, digest)

        with self._lock:
            for info in self.loaded_papers:          # another thread may have added it meanwhile
                if info["sha256"] == digest:
                    return dict(info, already_loaded=True)
            name = self._unique_name(os.path.basename(filename or "") or f"{digest[:12]}.pdf")
            for chunk in new_chunks:
                chunk["paper"] = name
            info = {"name": name, "pages": pages, "chunks": len(new_chunks), "sha256": digest}
            self.loaded_papers.append(info)
            self.chunks = self.chunks + new_chunks
            self._evict_oldest()
            return dict(info, already_loaded=False)

    def _parse(self, data: bytes, digest: str):
        max_pages = _env_int("PDF_MAX_PAGES", 600, 1, 5000)
        try:
            reader = pypdf.PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                try:
                    unlocked = reader.decrypt("")
                except Exception:
                    unlocked = 0
                if not unlocked:
                    raise ValueError("The PDF is password protected.")
            num_pages = len(reader.pages)
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"Could not read the PDF: {type(e).__name__}: {e}") from e
        if num_pages == 0:
            raise ValueError("The PDF has no pages.")
        if num_pages > max_pages:
            raise PDFTooLarge(f"The PDF has {num_pages} pages; the limit is {max_pages}.")

        chunks: List[Dict[str, Any]] = []
        for page_idx in range(num_pages):
            try:
                text = reader.pages[page_idx].extract_text() or ""
            except Exception as e:
                logger.info("Skipping page %s of %s: %s", page_idx + 1, digest[:12], e)
                continue
            text = re.sub(r"\s+", " ", text).strip()
            start = 0
            while start < len(text):
                end = min(start + CHUNK_SIZE, len(text))
                piece = text[start:end].strip()
                if len(piece) > MIN_CHUNK_CHARS:
                    chunks.append({"id": f"{digest[:12]}_p{page_idx + 1}_{len(chunks)}",
                                   "paper": "", "page": page_idx + 1, "text": piece,
                                   "_tokens": frozenset(_TOKEN.findall(piece.lower()))})
                if end == len(text):
                    break
                start += CHUNK_SIZE - CHUNK_OVERLAP
        if not chunks:
            raise ValueError("No extractable text was found in the PDF (it may be a scanned image).")
        return num_pages, chunks

    def _unique_name(self, name: str) -> str:
        taken = {p["name"] for p in self.loaded_papers}
        if name not in taken:
            return name
        stem, ext = os.path.splitext(name)
        n = 2
        while f"{stem} ({n}){ext}" in taken:
            n += 1
        return f"{stem} ({n}){ext}"

    def _evict_oldest(self) -> None:
        max_docs = _env_int("PDF_MAX_DOCS", 20, 1, 500)
        while len(self.loaded_papers) > max_docs:
            dropped = self.loaded_papers.pop(0)
            self.chunks = [c for c in self.chunks if c["paper"] != dropped["name"]]

    # ── Reads ───────────────────────────────────────────────────────────────
    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            papers = [{"name": p["name"], "pages": p["pages"], "chunks": p["chunks"]} for p in self.loaded_papers]
            total_chunks = len(self.chunks)
        return {
            "loaded": total_chunks > 0,
            "total_papers": len(papers),
            "papers": papers,
            "paper_names": [p["name"] for p in papers],
            "total_pages": sum(p["pages"] for p in papers),
            "total_chunks": total_chunks,
            "max_mb": max_pdf_mb(),
        }

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Top chunks by term overlap with sub-linear length normalisation: [{id, paper, page, text}]."""
        with self._lock:
            chunks = self.chunks          # the list is replaced, never mutated, so this snapshot is safe
        if not chunks:
            return []
        top_k = max(1, min(int(top_k or 5), 50))
        q_tokens = set(_TOKEN.findall((query or "").lower()))
        if not q_tokens:
            return [self._public(c) for c in chunks[:top_k]]
        scored = []
        for chunk in chunks:
            overlap = len(q_tokens & chunk["_tokens"])
            if overlap:
                scored.append((overlap / (1 + math.log(1 + len(chunk["_tokens"]))), chunk))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [self._public(c) for _, c in scored[:top_k]]

    @staticmethod
    def _public(chunk: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": chunk["id"], "paper": chunk["paper"], "page": chunk["page"], "text": chunk["text"]}


pdf_store = PDFChunkStore()


# ── arXiv download ──────────────────────────────────────────────────────────
def arxiv_pdf_filename(arxiv_id_or_url: str) -> str:
    """'1706.03762.pdf' or 'hep-th_9901001.pdf' for a valid id, '' otherwise."""
    aid = arxiv_id_from(arxiv_id_or_url)
    return f"{aid.replace('/', '_')}.pdf" if aid else ""


def _is_arxiv_url(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and (parts.hostname or "").lower() in _ARXIV_HOSTS


async def download_arxiv_pdf(arxiv_id_or_url: str) -> Optional[bytes]:
    """
    Download a paper PDF from arxiv.org.
    Accepts new-style (1706.03762, 1706.03762v5) and old-style (hep-th/9901001) ids or
    arXiv abs/pdf URLs. Returns None when arXiv has no such paper or is unreachable.
    Raises ValueError for an invalid id, a response that is not a PDF, or a file over the size cap.
    """
    aid = arxiv_id_from(arxiv_id_or_url)
    if not aid:
        raise ValueError("Not a valid arXiv id. Use a form like 1706.03762 or hep-th/9901001.")
    url = f"https://arxiv.org/pdf/{aid}"
    limit = max_pdf_bytes()
    headers = {"User-Agent": USER_AGENT}
    timeout = aiohttp.ClientTimeout(total=60, sock_read=30)

    try:
        async with aiohttp.ClientSession(headers=headers, timeout=timeout) as s:
            for _ in range(4):   # follow at most 3 redirects, each must stay on arxiv.org
                async with s.get(url, allow_redirects=False) as r:
                    if r.status in (301, 302, 303, 307, 308):
                        nxt = urljoin(url, r.headers.get("Location", ""))
                        if not _is_arxiv_url(nxt):
                            logger.warning("Refusing redirect away from arXiv: %s", nxt)
                            return None
                        url = nxt
                        continue
                    if r.status != 200:
                        logger.info("arXiv PDF %s returned status %s", aid, r.status)
                        return None
                    declared = r.headers.get("Content-Length")
                    if declared and declared.isdigit() and int(declared) > limit:
                        raise PDFTooLarge(f"The arXiv PDF is {int(declared) / 1048576:.1f} MB; "
                                         f"the limit is {max_pdf_mb()} MB.")
                    buf = bytearray()
                    async for block in r.content.iter_chunked(64 * 1024):
                        buf.extend(block)
                        if len(buf) > limit:
                            raise PDFTooLarge(f"The arXiv PDF is larger than the {max_pdf_mb()} MB limit.")
                    data = bytes(buf)
                    if b"%PDF-" not in data[:1024]:
                        raise ValueError("arXiv did not return a PDF for this id (it may be withdrawn or not yet processed).")
                    return data
            logger.warning("Too many redirects fetching arXiv PDF %s", aid)
            return None
    except ValueError:
        raise
    except Exception as e:
        logger.warning("Could not download arXiv PDF %s: %s", aid, e)
        return None
