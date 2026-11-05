"""
Hugging Face Hub connector: pretrained models and datasets for a research topic.

Result shapes match what the frontend ModelCard and DatasetCard components read:
  model:   {id, name, author, url, downloads, likes, pipeline_tag, private, tags, arxiv_id}
  dataset: {id, name, author, url, downloads, likes, tags}
"""
import os
import re
import asyncio
import logging
from typing import Any, Dict, List, Optional

import aiohttp

logger = logging.getLogger("research_iq.hf")

USER_AGENT = "ResearchIQ/1.0"
MAX_LIMIT = 50
_ARXIV_TAG = re.compile(r"^arxiv:(\d{4}\.\d{4,5}|[a-z][a-z\-]*(?:\.[A-Za-z]{2})?/\d{7})", re.I)


def _usable_secret(value: Optional[str]) -> str:
    """Return the secret, or '' when it is blank or an .env.example placeholder."""
    text = (value or "").strip()
    lowered = text.lower()
    if not text or lowered.startswith("your_") or lowered.startswith("optional"):
        return ""
    return text


def _clamp_limit(value: Any, default: int = 6) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(1, min(n, MAX_LIMIT))


class HuggingFaceMCP:
    BASE_MODELS = "https://huggingface.co/api/models"
    BASE_DATASETS = "https://huggingface.co/api/datasets"
    TIMEOUT = aiohttp.ClientTimeout(total=12)

    def _headers(self) -> Dict[str, str]:
        headers = {"User-Agent": USER_AGENT}
        token = _usable_secret(os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN"))
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _get_list(self, url: str, params: Dict[str, Any], kind: str) -> List[Dict[str, Any]]:
        try:
            async with aiohttp.ClientSession(headers=self._headers()) as s:
                async with s.get(url, params=params, timeout=self.TIMEOUT) as r:
                    if r.status != 200:
                        logger.warning("Hugging Face %s API returned status %s", kind, r.status)
                        return []
                    data = await r.json(content_type=None)
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.warning("Hugging Face %s query failed: %s", kind, e)
            return []

    @staticmethod
    def _split_id(repo_id: str):
        parts = repo_id.split("/", 1)
        if len(parts) == 2:
            return parts[0], parts[1]
        return "community", repo_id

    async def search_models(self, query: str, max_results: int = 6) -> List[Dict[str, Any]]:
        """Search pretrained open-source models on the Hugging Face Hub."""
        clean_query = (query or "").strip()
        if not clean_query:
            return []
        limit = _clamp_limit(max_results)
        params = {"search": clean_query, "limit": limit, "full": "false",
                  "sort": "downloads", "direction": "-1"}
        items = await self._get_list(self.BASE_MODELS, params, "models")

        results = []
        for item in items[:limit]:
            if not isinstance(item, dict):
                continue
            mid = item.get("id") or item.get("modelId") or ""
            if not mid:
                continue
            author, name = self._split_id(mid)
            tags = [str(t) for t in (item.get("tags") or [])]
            arxiv_id = None
            for t in tags:
                m = _ARXIV_TAG.match(t)
                if m:
                    arxiv_id = m.group(1)
                    break
            results.append({
                "id": mid,
                "name": name,
                "author": author,
                "url": f"https://huggingface.co/{mid}",
                "downloads": int(item.get("downloads") or 0),
                "likes": int(item.get("likes") or 0),
                "pipeline_tag": item.get("pipeline_tag") or "general",
                "private": bool(item.get("private", False)),
                "tags": tags[:6],
                "arxiv_id": arxiv_id,
            })
        return results

    async def search_datasets(self, query: str, max_results: int = 6) -> List[Dict[str, Any]]:
        """Search benchmark and evaluation datasets on the Hugging Face Hub."""
        clean_query = (query or "").strip()
        if not clean_query:
            return []
        limit = _clamp_limit(max_results)
        params = {"search": clean_query, "limit": limit, "full": "false",
                  "sort": "downloads", "direction": "-1"}
        items = await self._get_list(self.BASE_DATASETS, params, "datasets")

        results = []
        for item in items[:limit]:
            if not isinstance(item, dict):
                continue
            did = item.get("id") or ""
            if not did:
                continue
            author, name = self._split_id(did)
            results.append({
                "id": did,
                "name": name,
                "author": author,
                "url": f"https://huggingface.co/datasets/{did}",
                "downloads": int(item.get("downloads") or 0),
                "likes": int(item.get("likes") or 0),
                "tags": [str(t) for t in (item.get("tags") or [])][:5],
            })
        return results

    async def search_all(self, query: str, max_models: int = 6, max_datasets: int = 6) -> Dict[str, Any]:
        """Fetch models and datasets concurrently. Always returns both keys."""
        models, datasets = await asyncio.gather(
            self.search_models(query, max_models),
            self.search_datasets(query, max_datasets),
            return_exceptions=True,
        )
        return {
            "models": models if isinstance(models, list) else [],
            "datasets": datasets if isinstance(datasets, list) else [],
        }
