import aiohttp, os, re

class CrossRefMCP:
    BASE = "https://api.crossref.org/works"
    HEADERS = {"User-Agent": "ResearchIQ/1.0"}

    def _to_paper(self, item: dict) -> dict:
        doi = item.get("DOI", "")
        title = (item.get("title") or [""])[0]
        authors = [f"{a.get('given','')} {a.get('family','')}".strip()
                   for a in item.get("author", [])[:5] if a.get("family")]
        parts = (item.get("issued") or {}).get("date-parts") or [[None]]
        year = parts[0][0] if parts and parts[0] else ""
        # abstracts come back as JATS XML, strip the tags
        abstract = re.sub(r"<[^>]+>", "", item.get("abstract", "") or "").strip()
        link = f"https://doi.org/{doi}" if doi else item.get("URL", "")
        return {"id": link, "title": title, "summary": abstract,
                "authors": authors, "year": str(year or ""),
                "citations": item.get("is-referenced-by-count", 0),
                "doi": doi, "url": link, "source": "crossref"}

    async def search(self, query: str, max_results: int = 10) -> list:
        params = {"query.bibliographic": query, "rows": max_results,
                  "select": "DOI,title,author,issued,abstract,is-referenced-by-count,URL"}
        # CrossRef routes requests that carry a contact email to its faster "polite" pool
        if os.getenv("CROSSREF_MAILTO"): params["mailto"] = os.getenv("CROSSREF_MAILTO")
        try:
            async with aiohttp.ClientSession(headers=self.HEADERS) as s:
                async with s.get(self.BASE, params=params, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    if r.status != 200: return []
                    data = await r.json()
            return [self._to_paper(i) for i in data.get("message", {}).get("items", []) if i.get("title")]
        except Exception: return []

    async def resolve_doi(self, doi: str) -> dict:
        """Look up a single DOI and resolve the works it cites."""
        doi = doi.replace("https://doi.org/", "").strip()
        try:
            async with aiohttp.ClientSession(headers=self.HEADERS) as s:
                async with s.get(f"{self.BASE}/{doi}", timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status != 200: return {}
                    item = (await r.json()).get("message", {})
        except Exception: return {}
        paper = self._to_paper(item)
        paper["references"] = [
            {"doi": ref.get("DOI", ""),
             "title": ref.get("article-title") or ref.get("unstructured", "")[:200],
             "year": ref.get("year", "")}
            for ref in item.get("reference", [])
        ]
        return paper
