import aiohttp, xml.etree.ElementTree as ET

NS = "{http://www.w3.org/2005/Atom}"

class ArxivMCP:
    BASE = "http://export.arxiv.org/api/query"

    async def search(self, query: str, max_results: int = 10) -> list:
        params = {"search_query": f"all:{query}", "start": 0,
                  "max_results": max_results, "sortBy": "relevance"}
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(self.BASE, params=params, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    if r.status != 200: return []
                    xml = await r.text()
            root = ET.fromstring(xml)
            papers = []
            for e in root.findall(f"{NS}entry"):
                t  = e.find(f"{NS}title");       title   = t.text.strip().replace("\n"," ") if t is not None else ""
                s2 = e.find(f"{NS}summary");     summary = s2.text.strip().replace("\n"," ") if s2 is not None else ""
                i  = e.find(f"{NS}id");          aid     = i.text.strip() if i is not None else ""
                pub= e.find(f"{NS}published");   year    = pub.text[:4] if pub is not None else ""
                authors = [a.find(f"{NS}name").text for a in e.findall(f"{NS}author") if a.find(f"{NS}name") is not None]
                papers.append({"id": aid, "title": title, "summary": summary,
                               "authors": authors, "year": year,
                               "url": aid, "source": "arxiv"})
            return papers
        except Exception: return []
