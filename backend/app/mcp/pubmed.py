import aiohttp, os, xml.etree.ElementTree as ET

class PubMedMCP:
    BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def _params(self, **extra) -> dict:
        params = {"db": "pubmed", **extra}
        # without a key NCBI allows 3 requests/sec, with one it's 10
        key = os.getenv("NCBI_API_KEY", "")
        if key: params["api_key"] = key
        return params

    async def search(self, query: str, max_results: int = 10) -> list:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(f"{self.BASE}/esearch.fcgi",
                                 params=self._params(term=query, retmax=max_results, retmode="json", sort="relevance"),
                                 timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status != 200: return []
                    ids = (await r.json()).get("esearchresult", {}).get("idlist", [])
                if not ids: return []
                async with s.get(f"{self.BASE}/efetch.fcgi",
                                 params=self._params(id=",".join(ids), retmode="xml"),
                                 timeout=aiohttp.ClientTimeout(total=20)) as r:
                    if r.status != 200: return []
                    xml = await r.text()
            return [self._parse(a) for a in ET.fromstring(xml).iter("PubmedArticle")]
        except Exception: return []

    def _parse(self, art) -> dict:
        pmid = art.findtext(".//PMID", "")
        title = "".join(art.find(".//ArticleTitle").itertext()) if art.find(".//ArticleTitle") is not None else ""
        abstract = " ".join("".join(t.itertext()) for t in art.findall(".//Abstract/AbstractText"))
        authors = [f"{a.findtext('ForeName','')} {a.findtext('LastName','')}".strip()
                   for a in art.findall(".//AuthorList/Author")[:5] if a.findtext("LastName")]
        year = art.findtext(".//JournalIssue/PubDate/Year") or (art.findtext(".//JournalIssue/PubDate/MedlineDate") or "")[:4]
        doi = art.findtext(".//ArticleIdList/ArticleId[@IdType='doi']", "")
        link = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        return {"id": link, "title": title.strip(), "summary": abstract.strip(),
                "authors": authors, "year": year, "citations": 0,
                "doi": doi, "pmid": pmid, "url": link, "source": "pubmed"}
