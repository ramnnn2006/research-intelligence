import aiohttp, os


def _env_token(name: str) -> str:
    """Env value, treating blanks and .env.example placeholders (your_..., optional) as unset."""
    value = os.getenv(name, "").strip()
    return "" if not value or value.lower().startswith(("your_", "optional")) else value

class GitHubMCP:
    BASE = "https://api.github.com/search/repositories"

    async def search(self, query: str, max_results: int = 6) -> list:
        headers = {"Accept": "application/vnd.github.v3+json"}
        token = _env_token("GITHUB_TOKEN")
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
