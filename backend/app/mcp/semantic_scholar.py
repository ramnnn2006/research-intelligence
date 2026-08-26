import aiohttp

class SemanticScholarMCP:
    BASE = "https://api.semanticscholar.org/graph/v1"

    async def search(self, query: str, max_results: int = 10) -> list:
        url = f"{self.BASE}/paper/search"
        params = {"query": query, "limit": max_results,
                  "fields": "title,abstract,authors,year,citationCount,externalIds,url"}
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(url, params=params, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    if r.status != 200: return []
                    data = await r.json()
            results = []
            for p in data.get("data", []):
                ext = p.get("externalIds", {})
                aid = ext.get("ArXiv", "")
                link = f"https://arxiv.org/abs/{aid}" if aid else p.get("url","")
                results.append({
                    "id": link, "title": p.get("title",""),
                    "summary": p.get("abstract","") or "",
                    "authors": [a.get("name","") for a in p.get("authors",[])[:5]],
                    "year": str(p.get("year","")),
                    "citations": p.get("citationCount", 0),
                    "url": link, "source": "semantic_scholar"
                })
            return results
        except Exception: return []

    async def get_citations(self, title: str) -> dict:
        search_url = f"{self.BASE}/paper/search"
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(search_url, params={"query": title, "limit": 1},
                                 timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status != 200: return {}
                    data = await r.json()
                if not data.get("data"): return {}
                pid = data["data"][0]["paperId"]
                async with s.get(f"{self.BASE}/paper/{pid}",
                                 params={"fields": "citations.title,references.title,authors,citationCount"},
                                 timeout=aiohttp.ClientTimeout(total=15)) as r2:
                    if r2.status == 200: return await r2.json()
        except Exception: pass
        return {}
