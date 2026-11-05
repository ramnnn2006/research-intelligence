"""
Knowledge graph features on top of the shared Neo4j client.

  ensure_schema()                    uniqueness constraints for Model.id and Dataset.id
  save_hf_artifacts(...)             (Topic)-[:HAS_MODEL]->(Model), (Topic)-[:USES_DATASET]->(Dataset)
  save_citation_network(...)         (citing)-[:CITES]->(root), (root)-[:CITES]->(reference)
  save_author_portfolio(...)         (Author)-[:AUTHORED]->(Paper) for an author search
  get_multi_hop_citations(...)       directed citation neighbourhood up to 3 hops
  get_topic_graph(topic)             papers, authors, repos, models, datasets of one topic
  get_local_citations(...)           stored citations of one paper (offline fallback)
  get_local_author_papers(...)       stored papers of one author (offline fallback)
  get_neo4j_status()                 connectivity and label counts

Every Paper is keyed by app.db.ids.canonical_paper_id, so a paper reached through
search, citations or an author portfolio is always the same node. All writes are
single UNWIND batches. Nothing here needs APOC or GDS.

All functions are synchronous; async callers should use asyncio.to_thread.
Read functions return None or empty values when Neo4j is offline.
"""
import re
import logging
import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from app.db.neo4j_client import get_neo4j_client
from app.db.ids import canonical_paper_id, arxiv_id_from

logger = logging.getLogger("research_iq.knowledge_graph")

MULTIHOP_NODE_CAP = 60      # per direction
TOPIC_PAPER_LIMIT = 200
TOPIC_OTHER_LIMIT = 60


# ── Helpers ─────────────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _ready() -> bool:
    client = get_neo4j_client()
    return client.is_connected() or client.connect()


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _norm_title(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _safe_uri(uri: str) -> str:
    """scheme://host:port with credentials, path and query removed."""
    try:
        parts = urlsplit(uri or "")
        host = parts.hostname or ""
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{host}{port}" if parts.scheme else host
    except ValueError:
        return ""


def _paper_row(p: Dict[str, Any], author_cap: int = 5) -> Optional[Dict[str, Any]]:
    """Normalise a paper dict from any source into the row shape the writes use."""
    if not isinstance(p, dict):
        return None
    pid = canonical_paper_id(p)
    if not pid:
        return None
    authors = [str(a).strip() for a in (p.get("authors") or []) if str(a or "").strip()]
    abstract = str(p.get("abstract") or p.get("summary") or "")[:3000]
    return {
        "id": pid,
        "arxiv_id": arxiv_id_from(p.get("arxiv_id")) or arxiv_id_from(pid) or None,
        "title": re.sub(r"\s+", " ", str(p.get("title") or "")).strip()[:250],
        "abstract": abstract or None,
        "year": str(p.get("year") or ""),
        "url": str(p.get("url") or ("" if pid.startswith("title:") else pid)),
        "source": str(p.get("source") or "unknown"),
        "citations": _int(p.get("citations")),
        "authors": authors[:author_cap],
    }


def _paper_rows(papers: Any, exclude: str = "", author_cap: int = 5) -> List[Dict[str, Any]]:
    rows, seen = [], {exclude} if exclude else set()
    for p in papers or []:
        row = _paper_row(p, author_cap)
        if row and row["id"] not in seen:
            seen.add(row["id"])
            rows.append(row)
    return rows


def _upsert_paper(var: str, row: str) -> str:
    """
    Property rules shared by every Paper MERGE:
    keep stored title/year/url/abstract when present, add arxiv_id when known,
    and never replace a stored citation count with 0.
    """
    return f"""
    ON CREATE SET {var}.created_at = $now, {var}.source = {row}.source
    SET {var}.title = CASE WHEN coalesce({var}.title, '') = '' THEN {row}.title ELSE {var}.title END,
        {var}.year = CASE WHEN coalesce({var}.year, '') = '' THEN {row}.year ELSE {var}.year END,
        {var}.url = CASE WHEN coalesce({var}.url, '') = '' THEN {row}.url ELSE {var}.url END,
        {var}.abstract = CASE WHEN coalesce({var}.abstract, '') = '' THEN {row}.abstract ELSE {var}.abstract END,
        {var}.arxiv_id = coalesce({row}.arxiv_id, {var}.arxiv_id),
        {var}.citations = CASE WHEN coalesce({row}.citations, 0) > 0 THEN {row}.citations
                               ELSE coalesce({var}.citations, 0) END,
        {var}.updated_at = $now
    FOREACH (author_name IN coalesce({row}.authors, []) |
        MERGE (au:Author {{name: author_name}})
        MERGE (au)-[:AUTHORED]->({var})
    )
    """


def _graph(nodes: List[Dict[str, Any]], links: List[Dict[str, Any]]) -> Dict[str, Any]:
    """node-link JSON in the shape the Graph component reads, with edges mirrored."""
    return {"directed": True, "multigraph": False, "graph": {},
            "nodes": nodes, "links": links, "edges": links}


# ── Schema ──────────────────────────────────────────────────────────────────
def ensure_schema() -> bool:
    if not _ready():
        return False
    ok = True
    for stmt in (
        "CREATE CONSTRAINT model_id_uniq IF NOT EXISTS FOR (m:Model) REQUIRE m.id IS UNIQUE",
        "CREATE CONSTRAINT dataset_id_uniq IF NOT EXISTS FOR (d:Dataset) REQUIRE d.id IS UNIQUE",
    ):
        try:
            get_neo4j_client().execute_write(stmt)
        except Exception as e:
            ok = False
            logger.warning("Schema statement failed [%s]: %s", stmt, e)
    return ok


# ── Writes ──────────────────────────────────────────────────────────────────
def save_hf_artifacts(topic: str, models: List[Dict[str, Any]], datasets: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Attach Hugging Face models and datasets to a Topic in one transaction."""
    topic = (topic or "").strip()
    model_rows, dataset_rows, seen = [], [], set()
    for m in models or []:
        mid = str((m or {}).get("id") or "").strip()
        if mid and mid not in seen:
            seen.add(mid)
            model_rows.append({
                "id": mid,
                "name": str(m.get("name") or mid),
                "url": str(m.get("url") or f"https://huggingface.co/{mid}"),
                "author": str(m.get("author") or ""),
                "task": str(m.get("pipeline_tag") or m.get("task") or "general"),
                "downloads": _int(m.get("downloads")),
                "likes": _int(m.get("likes")),
                "arxiv_id": arxiv_id_from(m.get("arxiv_id")) or None,
            })
    seen = set()
    for d in datasets or []:
        did = str((d or {}).get("id") or "").strip()
        if did and did not in seen:
            seen.add(did)
            dataset_rows.append({
                "id": did,
                "name": str(d.get("name") or did),
                "url": str(d.get("url") or f"https://huggingface.co/datasets/{did}"),
                "author": str(d.get("author") or ""),
                "downloads": _int(d.get("downloads")),
                "likes": _int(d.get("likes")),
            })

    if not topic or not (model_rows or dataset_rows):
        return {"saved": False, "reason": "nothing to save", "models": 0, "datasets": 0}
    if not _ready():
        return {"saved": False, "reason": "neo4j offline", "models": 0, "datasets": 0}

    cypher = """
    MERGE (t:Topic {name: $topic})
    ON CREATE SET t.created_at = $now
    WITH t
    CALL {
        WITH t
        UNWIND $models AS m
        MERGE (model:Model {id: m.id})
        ON CREATE SET model.created_at = $now
        SET model.name = m.name, model.url = m.url, model.author = m.author,
            model.task = m.task, model.downloads = m.downloads, model.likes = m.likes,
            model.arxiv_id = coalesce(m.arxiv_id, model.arxiv_id), model.updated_at = $now
        MERGE (t)-[:HAS_MODEL]->(model)
        RETURN count(model) AS models_saved
    }
    CALL {
        WITH t
        UNWIND $datasets AS d
        MERGE (ds:Dataset {id: d.id})
        ON CREATE SET ds.created_at = $now
        SET ds.name = d.name, ds.url = d.url, ds.author = d.author,
            ds.downloads = d.downloads, ds.likes = d.likes, ds.updated_at = $now
        MERGE (t)-[:USES_DATASET]->(ds)
        RETURN count(ds) AS datasets_saved
    }
    RETURN models_saved, datasets_saved
    """
    try:
        res = get_neo4j_client().execute_write(cypher, {
            "topic": topic, "models": model_rows, "datasets": dataset_rows, "now": _now_iso()})
    except Exception as e:
        logger.warning("save_hf_artifacts failed: %s", e)
        return {"saved": False, "reason": str(e), "models": 0, "datasets": 0}
    if not res:
        return {"saved": False, "reason": "neo4j offline", "models": 0, "datasets": 0}
    return {"saved": True, "models": res[0]["models_saved"], "datasets": res[0]["datasets_saved"]}


def save_citation_network(root: Dict[str, Any], citing: List[Dict[str, Any]],
                          references: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Persist a paper's citation neighbourhood:
      (c)-[:CITES]->(root) for every citing paper, (root)-[:CITES]->(r) for every reference.
    `root` must be the resolved paper (from OpenAlex or Semantic Scholar), never raw user input.
    Does nothing when both lists are empty.
    """
    root_row = _paper_row(root or {}, author_cap=8)
    if not root_row:
        return {"saved": False, "reason": "root paper has no usable id", "citing": 0, "references": 0}
    citing_rows = _paper_rows(citing, exclude=root_row["id"])
    ref_rows = _paper_rows(references, exclude=root_row["id"])
    if not citing_rows and not ref_rows:
        return {"saved": False, "reason": "no citations or references", "citing": 0, "references": 0}
    if not _ready():
        return {"saved": False, "reason": "neo4j offline", "citing": 0, "references": 0}

    cypher = f"""
    MERGE (root:Paper {{id: $root.id}})
    {_upsert_paper("root", "$root")}
    WITH root
    CALL {{
        WITH root
        UNWIND $citing AS c
        MERGE (p:Paper {{id: c.id}})
        {_upsert_paper("p", "c")}
        MERGE (p)-[:CITES]->(root)
        RETURN count(p) AS citing_saved
    }}
    CALL {{
        WITH root
        UNWIND $refs AS r
        MERGE (q:Paper {{id: r.id}})
        {_upsert_paper("q", "r")}
        MERGE (root)-[:CITES]->(q)
        RETURN count(q) AS refs_saved
    }}
    RETURN root.id AS root_id, citing_saved, refs_saved
    """
    try:
        res = get_neo4j_client().execute_write(cypher, {
            "root": root_row, "citing": citing_rows, "refs": ref_rows, "now": _now_iso()})
    except Exception as e:
        logger.warning("save_citation_network failed: %s", e)
        return {"saved": False, "reason": str(e), "citing": 0, "references": 0}
    if not res:
        return {"saved": False, "reason": "neo4j offline", "citing": 0, "references": 0}
    return {"saved": True, "root_id": res[0]["root_id"],
            "citing": res[0]["citing_saved"], "references": res[0]["refs_saved"]}


def save_author_portfolio(author_name: str, papers: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Link an author to the papers found for them, plus each paper's listed co-authors."""
    name = (author_name or "").strip()
    rows = _paper_rows(papers, author_cap=8)
    if not name or not rows:
        return {"saved": False, "reason": "nothing to save", "papers": 0}
    if not _ready():
        return {"saved": False, "reason": "neo4j offline", "papers": 0}
    cypher = f"""
    MERGE (me:Author {{name: $author}})
    WITH me
    UNWIND $papers AS row
    MERGE (p:Paper {{id: row.id}})
    {_upsert_paper("p", "row")}
    MERGE (me)-[:AUTHORED]->(p)
    RETURN count(p) AS saved
    """
    try:
        res = get_neo4j_client().execute_write(cypher, {"author": name, "papers": rows, "now": _now_iso()})
    except Exception as e:
        logger.warning("save_author_portfolio failed: %s", e)
        return {"saved": False, "reason": str(e), "papers": 0}
    if not res:
        return {"saved": False, "reason": "neo4j offline", "papers": 0}
    return {"saved": True, "papers": res[0]["saved"]}


# ── Paper resolution ────────────────────────────────────────────────────────
def resolve_paper(title_or_id: str) -> Optional[Dict[str, Any]]:
    """
    Find the single best stored Paper for user input.
    Exact id (raw, canonical, arXiv id or title key) wins; otherwise a
    case-insensitive title CONTAINS match, preferring an exact title, then
    the most cited paper. Returns {id, title, citations} or None.
    """
    text = (title_or_id or "").strip()
    if not text or not _ready():
        return None
    client = get_neo4j_client()

    ids = []
    for candidate in (text, canonical_paper_id({"id": text}), canonical_paper_id({"title": text})):
        if candidate and candidate not in ids:
            ids.append(candidate)
    aid = arxiv_id_from(text)
    branches = ["UNWIND $ids AS cid MATCH (p:Paper {id: cid}) RETURN p"]
    if aid:
        branches.append("MATCH (p:Paper) WHERE p.arxiv_id = $aid RETURN p")
    try:
        rows = client.execute_read(f"""
        CALL {{
            {' UNION '.join(branches)}
        }}
        RETURN p.id AS id, p.title AS title, coalesce(p.citations, 0) AS citations
        ORDER BY citations DESC
        LIMIT 1
        """, {"ids": ids, "aid": aid or None})
        if rows:
            return rows[0]

        needle = _norm_title(text)
        if len(needle) < 3:
            return None
        rows = client.execute_read("""
        MATCH (p:Paper)
        WHERE p.title IS NOT NULL AND toLower(p.title) CONTAINS $needle
        RETURN p.id AS id, p.title AS title, coalesce(p.citations, 0) AS citations,
               toLower(trim(p.title)) = $needle AS exact,
               COUNT { (p)<-[:CITES]-(:Paper) } AS cited_by
        ORDER BY exact DESC, citations DESC, cited_by DESC, size(p.title) ASC
        LIMIT 1
        """, {"needle": needle})
        return {k: rows[0][k] for k in ("id", "title", "citations")} if rows else None
    except Exception as e:
        logger.warning("resolve_paper failed: %s", e)
        return None


# ── Reads ───────────────────────────────────────────────────────────────────
def get_multi_hop_citations(title_or_id: str, hops: int = 2) -> Optional[Dict[str, Any]]:
    """
    Directed citation neighbourhood of one paper.
    Follows (root)-[:CITES*1..h]->(reference) and (citing)-[:CITES*1..h]->(root),
    keeps at most MULTIHOP_NODE_CAP distinct papers per direction, then returns
    every CITES edge among the kept papers.

    Returns None when Neo4j is offline, the paper is unknown, or it has no
    stored citations.
    Shape: {directed, multigraph, graph, nodes, links, edges, hops, root, root_id}
      node: {id, label, title, type: root|reference|cited_by, year, citations, url, arxiv_id}
      link: {source, target, relation: "cites"}
    """
    try:
        h = int(hops)
    except (TypeError, ValueError):
        h = 2
    h = max(1, min(h, 3))

    root = resolve_paper(title_or_id)
    if not root:
        return None
    client = get_neo4j_client()
    try:
        reach = client.execute_read(f"""
        MATCH (root:Paper {{id: $rid}})
        CALL {{
            WITH root
            MATCH (root)-[:CITES*1..{h}]->(x:Paper)
            WITH DISTINCT x LIMIT $cap
            RETURN collect(x.id) AS ref_ids
        }}
        CALL {{
            WITH root
            MATCH (y:Paper)-[:CITES*1..{h}]->(root)
            WITH DISTINCT y LIMIT $cap
            RETURN collect(y.id) AS cite_ids
        }}
        RETURN ref_ids, cite_ids
        """, {"rid": root["id"], "cap": MULTIHOP_NODE_CAP})
        if not reach:
            return None
        ref_ids = [i for i in reach[0]["ref_ids"] if i]
        cite_ids = [i for i in reach[0]["cite_ids"] if i and i not in ref_ids]
        if not ref_ids and not cite_ids:
            return None
        all_ids = [root["id"]] + ref_ids + cite_ids
        node_rows = client.execute_read("""
        UNWIND $ids AS pid
        MATCH (p:Paper {id: pid})
        RETURN p.id AS id, p.title AS title, p.year AS year, p.citations AS citations,
               p.url AS url, p.arxiv_id AS arxiv_id
        """, {"ids": all_ids})
        edge_rows = client.execute_read("""
        UNWIND $ids AS pid
        MATCH (a:Paper {id: pid})-[:CITES]->(b:Paper)
        WHERE b.id IN $ids
        RETURN DISTINCT a.id AS source, b.id AS target
        """, {"ids": all_ids})
    except Exception as e:
        logger.warning("get_multi_hop_citations failed: %s", e)
        return None

    ref_set, cite_set = set(ref_ids), set(cite_ids)
    nodes = []
    for r in node_rows:
        pid = r["id"]
        kind = "root" if pid == root["id"] else ("reference" if pid in ref_set else
                                                 "cited_by" if pid in cite_set else "paper")
        title = r.get("title") or pid
        nodes.append({"id": pid, "label": title, "title": title, "type": kind,
                      "year": r.get("year") or "", "citations": _int(r.get("citations")),
                      "url": r.get("url") or "", "arxiv_id": r.get("arxiv_id")})
    links = [{"source": e["source"], "target": e["target"], "relation": "cites"} for e in edge_rows]
    out = _graph(nodes, links)
    out.update({"hops": h, "root": root.get("title") or root["id"], "root_id": root["id"]})
    return out


def get_topic_graph(topic: str) -> Optional[Dict[str, Any]]:
    """
    Knowledge graph of one topic (case-insensitive name match):
    papers via (Paper)-[:BELONGS_TO]->(Topic), their authors, and the topic's
    repositories, models and datasets. Each part is its own subquery, so row
    counts add up instead of multiplying.

    Returns None when Neo4j is offline or the topic does not exist.
    Node shapes (same as the NetworkX fallback):
      topic   {id: "TOPIC:<name>", type, label, centrality}
      paper   {id: title[:80], type, label, paper_id, year, url, citations, source}
      author  {id: name, type}
      repo    {id: name, type, url, stars}
      model   {id, label, type, url, downloads, likes}
      dataset {id, label, type, url, downloads}
    Link relations: related, authored, implementation, model, dataset.
    """
    topic_lc = _norm_title(topic)
    if not topic_lc or not _ready():
        return None
    cypher = """
    MATCH (t:Topic)
    WHERE toLower(trim(t.name)) = $topic_lc
    WITH collect(t) AS topics
    WHERE size(topics) > 0
    CALL {
        WITH topics
        UNWIND topics AS t
        MATCH (p:Paper)-[:BELONGS_TO]->(t)
        WITH DISTINCT p
        ORDER BY coalesce(p.citations, 0) DESC
        LIMIT $paper_limit
        RETURN collect(p {.id, .title, .year, .url, .citations, .source,
                          authors: [(a:Author)-[:AUTHORED]->(p) | a.name][..5]}) AS papers
    }
    CALL {
        WITH topics
        UNWIND topics AS t
        MATCH (t)-[:HAS_IMPLEMENTATION]->(r:Repository)
        WITH DISTINCT r
        ORDER BY coalesce(r.stars, 0) DESC
        LIMIT $other_limit
        RETURN collect(r {.name, .url, .stars}) AS repos
    }
    CALL {
        WITH topics
        UNWIND topics AS t
        MATCH (t)-[:HAS_MODEL]->(m:Model)
        WITH DISTINCT m
        ORDER BY coalesce(m.downloads, 0) DESC
        LIMIT $other_limit
        RETURN collect(m {.id, .name, .url, .downloads, .likes}) AS models
    }
    CALL {
        WITH topics
        UNWIND topics AS t
        MATCH (t)-[:USES_DATASET]->(d:Dataset)
        WITH DISTINCT d
        ORDER BY coalesce(d.downloads, 0) DESC
        LIMIT $other_limit
        RETURN collect(d {.id, .name, .url, .downloads}) AS datasets
    }
    RETURN [t IN topics | t.name] AS names, papers, repos, models, datasets
    """
    try:
        rows = get_neo4j_client().execute_read(cypher, {
            "topic_lc": topic_lc, "paper_limit": TOPIC_PAPER_LIMIT, "other_limit": TOPIC_OTHER_LIMIT})
    except Exception as e:
        logger.warning("get_topic_graph failed: %s", e)
        return None
    if not rows:
        return None
    row = rows[0]
    name = (row.get("names") or [topic])[0]
    topic_id = f"TOPIC:{name}"
    nodes = [{"id": topic_id, "type": "topic", "label": name, "centrality": 1.0}]
    links: List[Dict[str, Any]] = []
    seen = {topic_id}

    for p in row.get("papers") or []:
        node_id = (p.get("title") or "")[:80] or p.get("id")
        if not node_id or node_id in seen:
            continue
        seen.add(node_id)
        nodes.append({"id": node_id, "type": "paper", "label": p.get("title") or node_id,
                      "paper_id": p.get("id"), "year": p.get("year") or "", "url": p.get("url") or "",
                      "citations": _int(p.get("citations")), "source": p.get("source") or ""})
        links.append({"source": topic_id, "target": node_id, "relation": "related"})
        for author in p.get("authors") or []:
            if not author:
                continue
            if author not in seen:
                seen.add(author)
                nodes.append({"id": author, "type": "author"})
            links.append({"source": author, "target": node_id, "relation": "authored"})

    for r in row.get("repos") or []:
        rname = r.get("name")
        if rname and rname not in seen:
            seen.add(rname)
            nodes.append({"id": rname, "type": "repo", "url": r.get("url") or "", "stars": _int(r.get("stars"))})
            links.append({"source": topic_id, "target": rname, "relation": "implementation"})

    for m in row.get("models") or []:
        mid = m.get("id") or m.get("name")
        if mid and mid not in seen:
            seen.add(mid)
            nodes.append({"id": mid, "label": m.get("name") or mid, "type": "model", "url": m.get("url") or "",
                          "downloads": _int(m.get("downloads")), "likes": _int(m.get("likes"))})
            links.append({"source": topic_id, "target": mid, "relation": "model"})

    for d in row.get("datasets") or []:
        did = d.get("id") or d.get("name")
        if did and did not in seen:
            seen.add(did)
            nodes.append({"id": did, "label": d.get("name") or did, "type": "dataset", "url": d.get("url") or "",
                          "downloads": _int(d.get("downloads"))})
            links.append({"source": topic_id, "target": did, "relation": "dataset"})

    return _graph(nodes, links)


def get_local_citations(title_or_id: str, limit: int = 15) -> Optional[Dict[str, Any]]:
    """
    Stored citation neighbourhood of one paper, used when the live APIs fail.
    Returns {root, citations, references} with paper dicts
    {id, title, year, citations, url, arxiv_id, authors}, or None.
    """
    root = resolve_paper(title_or_id)
    if not root:
        return None
    limit = max(1, min(_int(limit) or 15, 100))
    projection = "{.id, .title, .year, .citations, .url, .arxiv_id, authors: [(a:Author)-[:AUTHORED]->(%s) | a.name][..6]}"
    cypher = f"""
    MATCH (root:Paper {{id: $rid}})
    CALL {{
        WITH root
        MATCH (c:Paper)-[:CITES]->(root)
        WITH c ORDER BY coalesce(c.citations, 0) DESC LIMIT $limit
        RETURN collect(c {projection % "c"}) AS citing
    }}
    CALL {{
        WITH root
        MATCH (root)-[:CITES]->(r:Paper)
        WITH r ORDER BY coalesce(r.citations, 0) DESC LIMIT $limit
        RETURN collect(r {projection % "r"}) AS refs
    }}
    RETURN root {projection % "root"} AS root, citing, refs
    """
    try:
        rows = get_neo4j_client().execute_read(cypher, {"rid": root["id"], "limit": limit})
    except Exception as e:
        logger.warning("get_local_citations failed: %s", e)
        return None
    if not rows:
        return None
    return {"root": rows[0]["root"], "citations": rows[0]["citing"] or [], "references": rows[0]["refs"] or []}


def get_local_author_papers(name: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Stored papers of the closest matching authors: [{id, title, year, citations, url, source, authors}]."""
    clean = (name or "").strip()
    if len(clean) < 2 or not _ready():
        return []
    limit = max(1, min(_int(limit) or 20, 100))
    cypher = """
    MATCH (a:Author)
    WHERE toLower(a.name) CONTAINS toLower($name)
    WITH a ORDER BY toLower(a.name) = toLower($name) DESC, size(a.name) ASC
    LIMIT 5
    MATCH (a)-[:AUTHORED]->(p:Paper)
    WITH DISTINCT p
    ORDER BY coalesce(p.citations, 0) DESC
    LIMIT $limit
    RETURN p.id AS id, p.title AS title, p.year AS year, p.citations AS citations,
           p.url AS url, p.source AS source,
           [(co:Author)-[:AUTHORED]->(p) | co.name] AS authors
    """
    try:
        return get_neo4j_client().execute_read(cypher, {"name": clean, "limit": limit})
    except Exception as e:
        logger.warning("get_local_author_papers failed: %s", e)
        return []


def get_neo4j_status() -> Dict[str, Any]:
    """{connected, uri, stats: {papers, authors, topics, repositories, models, datasets, relationships}}."""
    client = get_neo4j_client()
    zero = {"papers": 0, "authors": 0, "topics": 0, "repositories": 0,
            "models": 0, "datasets": 0, "relationships": 0}
    info: Dict[str, Any] = {"connected": False, "uri": _safe_uri(client.uri), "stats": dict(zero)}
    if not _ready():
        info["error"] = "Neo4j is not reachable"
        return info
    try:
        rows = client.execute_read("""
        CALL { MATCH (p:Paper) RETURN count(p) AS papers }
        CALL { MATCH (a:Author) RETURN count(a) AS authors }
        CALL { MATCH (t:Topic) RETURN count(t) AS topics }
        CALL { MATCH (r:Repository) RETURN count(r) AS repositories }
        CALL { MATCH (m:Model) RETURN count(m) AS models }
        CALL { MATCH (d:Dataset) RETURN count(d) AS datasets }
        CALL { MATCH ()-[rel]->() RETURN count(rel) AS relationships }
        RETURN papers, authors, topics, repositories, models, datasets, relationships
        """)
    except Exception as e:
        info["error"] = type(e).__name__
        return info
    if rows:
        info["connected"] = True
        info["stats"] = {k: _int(rows[0].get(k)) for k in zero}
    return info
