import aiohttp, os

class GitHubMCP:
    BASE = "https://api.github.com/search/repositories"

    async def search(self, query: str, max_results: int = 6) -> list:
        headers = {"Accept": "application/vnd.github.v3+json"}
        token = os.getenv("GITHUB_TOKEN","")
        if token: headers["Authorization"] = f"token {token}"
        params = {"q": f"{query} stars:>5", "sort": "stars", "order": "desc", "per_page": max_results}
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(self.BASE, params=params, headers=headers,
                                 timeout=aiohttp.ClientTimeout(total=10)) as r:
                    if r.status != 200: return []
                    data = await r.json()
            return [{"name": i["full_name"], "url": i["html_url"],
                     "description": i.get("description") or "",
                     "stars": i.get("stargazers_count", 0),
                     "language": i.get("language") or "",
                     "topics": i.get("topics", [])}
                    for i in data.get("items", [])[:max_results]]
        except Exception: return []
