import aiohttp, os


def _env_token(name: str) -> str:
    """Env value, treating blanks and .env.example placeholders (your_..., optional) as unset."""
    value = os.getenv(name, "").strip()
    return "" if not value or value.lower().startswith(("your_", "optional")) else value


# fields requested for each citing / referenced paper in get_citations
_LINKED_FIELDS = ("title", "year", "citationCount", "authors", "externalIds", "url")


class SemanticScholarMCP:
    BASE = "https://api.semanticscholar.org/graph/v1"

    def _headers(self) -> dict:
        headers = {"User-Agent": "ResearchIQ/1.0"}
        key = _env_token("SEMANTIC_SCHOLAR_API_KEY")
        if key: headers["x-api-key"] = key
        return headers

    async def search(self, query: str, max_results: int = 10) -> list:
        url = f"{self.BASE}/paper/search"
        params = {"query": query, "limit": max_results,
                  "fields": "title,abstract,authors,year,citationCount,externalIds,url"}
        try:
            async with aiohttp.ClientSession(headers=self._headers()) as s:
                async with s.get(url, params=params, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    if r.status != 200: return []
                    data = await r.json()
            results = []
            for p in data.get("data") or []:
                ext = p.get("externalIds") or {}
                aid = ext.get("ArXiv") or ""
                link = f"https://arxiv.org/abs/{aid}" if aid else (p.get("url") or "")
                year = p.get("year")
                results.append({
                    "id": link, "title": p.get("title") or "",
                    "summary": p.get("abstract") or "",
                    "authors": [a.get("name") or "" for a in (p.get("authors") or [])[:5]],
                    # S2 sends "year": null for some papers; never turn that into "None"
                    "year": str(year) if year else "",
                    "citations": p.get("citationCount") or 0,
                    "url": link, "source": "semantic_scholar"
                })
            return results
        except Exception: return []

    async def get_citations(self, title: str) -> dict:
        search_url = f"{self.BASE}/paper/search"
        fields = ",".join([f"citations.{f}" for f in _LINKED_FIELDS] +
                          [f"references.{f}" for f in _LINKED_FIELDS] +
                          ["title", "authors", "citationCount"])
        try:
            async with aiohttp.ClientSession(headers=self._headers()) as s:
                async with s.get(search_url, params={"query": title, "limit": 1},
                                 timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status != 200: return {}
                    data = await r.json()
                if not data.get("data"): return {}
                pid = data["data"][0]["paperId"]
                async with s.get(f"{self.BASE}/paper/{pid}",
                                 params={"fields": fields},
                                 timeout=aiohttp.ClientTimeout(total=15)) as r2:
                    if r2.status == 200: return await r2.json()
        except Exception: pass
        return {}
