"""
Graph snapshot backup, restore and integrity verification for the ResearchIQ Neo4j graph.

  python scripts/backup_restore.py --backup [--out backups/]
  python scripts/backup_restore.py --restore backups/graph_backup_20261008_211827.json
  python scripts/backup_restore.py --verify

--verify exits with 1 if it finds integrity errors, 2 if Neo4j is unreachable.
Orphaned nodes are reported as warnings only, they don't fail the run.
"""
import os
import sys
import json
import time
import argparse
from collections import defaultdict

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.db.neo4j_client import get_neo4j_client, init_neo4j_schema

try:
    from neo4j.time import Date, DateTime, Time
except ImportError:  # the client module already warns when the driver is missing
    Date = DateTime = Time = None

# label -> property that uniquely identifies a node (matches the schema constraints)
NODE_KEYS = {"Paper": "id", "Author": "name", "Repository": "name", "Topic": "name", "Search": "id", "Report": "id",
             "Model": "id", "Dataset": "id"}
EXPECTED_CONSTRAINTS = ["paper_id_uniq", "author_name_uniq", "repo_name_uniq",
                        "topic_name_uniq", "search_id_uniq", "report_id_uniq"]
BATCH = 500
# temporary label + index so relationship restore finds nodes by index, not by scanning every node
RESTORE_LABEL = "ResearchIQRestoring"
RESTORE_INDEX = "restore_id_tmp"
TEMPORAL_TAG = "$neo4j_temporal"


def _encode(value):
    """json.dump default: keep Neo4j temporal values restorable instead of plain strings."""
    if DateTime is not None:
        for kind, cls in (("datetime", DateTime), ("date", Date), ("time", Time)):
            if isinstance(value, cls):
                return {TEMPORAL_TAG: kind, "iso": value.iso_format()}
    return str(value)


def _decode(obj):
    """json.load object_hook: turn tagged temporal values back into driver types."""
    kind = obj.get(TEMPORAL_TAG) if isinstance(obj, dict) else None
    if kind and DateTime is not None:
        cls = {"datetime": DateTime, "date": Date, "time": Time}.get(kind)
        if cls is not None:
            try:
                return cls.from_iso_format(obj["iso"])
            except Exception:
                return obj["iso"]
    return obj


def connect():
    client = get_neo4j_client()
    if not client.connect():
        print(f"Error: cannot connect to Neo4j at {client.uri}. Is the server running?")
        sys.exit(2)
    return client


def backup(out_dir: str) -> str:
    client = connect()
    nodes = client.execute_read("""
    MATCH (n)
    RETURN elementId(n) AS eid, labels(n) AS labels, properties(n) AS props
    """)
    rels = client.execute_read("""
    MATCH (a)-[r]->(b)
    RETURN elementId(a) AS start, elementId(b) AS end, type(r) AS type, properties(r) AS props
    """)
    schema = client.execute_read("SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN *")

    snapshot = {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": client.uri,
        "counts": {"nodes": len(nodes), "relationships": len(rels)},
        "constraints": schema,
        "nodes": nodes,
        "relationships": rels,
    }
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, time.strftime("graph_backup_%Y%m%d_%H%M%S.json"))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=1, default=_encode)
    print(f"Backed up {len(nodes)} nodes and {len(rels)} relationships to {path}")
    return path


def restore(path: str):
    with open(path, encoding="utf-8") as f:
        snapshot = json.load(f, object_hook=_decode)
    client = connect()
    init_neo4j_schema()
    client.execute_write(f"CREATE INDEX {RESTORE_INDEX} IF NOT EXISTS FOR (n:{RESTORE_LABEL}) ON (n._restore_id)")
    client.execute_write("CALL db.awaitIndexes(300)")

    # Nodes are merged on their natural key so a restore into a live graph doesn't
    # duplicate anything. Nodes without a key (unknown label, or the key property
    # is missing) are created as new nodes. Every restored node carries the old
    # elementId on _restore_id plus a temporary label while edges are rebuilt.
    by_label = defaultdict(list)
    for n in snapshot["nodes"]:
        by_label[n["labels"][0] if n["labels"] else "Node"].append(n)
    for label, items in by_label.items():
        key = NODE_KEYS.get(label)
        keyed = [n for n in items if key and n["props"].get(key) is not None]
        unkeyed = [n for n in items if not (key and n["props"].get(key) is not None)]
        for i in range(0, len(keyed), BATCH):
            chunk = [{"eid": n["eid"], "props": n["props"]} for n in keyed[i:i + BATCH]]
            client.execute_write(
                f"UNWIND $rows AS row MERGE (n:`{label}` {{{key}: row.props.{key}}}) "
                f"SET n += row.props, n._restore_id = row.eid, n:{RESTORE_LABEL}", {"rows": chunk})
        for i in range(0, len(unkeyed), BATCH):
            chunk = [{"eid": n["eid"], "props": n["props"]} for n in unkeyed[i:i + BATCH]]
            client.execute_write(
                f"UNWIND $rows AS row CREATE (n:`{label}`) "
                f"SET n = row.props, n._restore_id = row.eid, n:{RESTORE_LABEL}", {"rows": chunk})

    by_type = defaultdict(list)
    for r in snapshot["relationships"]:
        by_type[r["type"]].append(r)
    for rel_type, items in by_type.items():
        for i in range(0, len(items), BATCH):
            client.execute_write(f"""
            UNWIND $rows AS row
            MATCH (a:{RESTORE_LABEL} {{_restore_id: row.start}})
            MATCH (b:{RESTORE_LABEL} {{_restore_id: row.end}})
            MERGE (a)-[r:`{rel_type}`]->(b)
            SET r += row.props
            """, {"rows": items[i:i + BATCH]})

    client.execute_write(f"MATCH (n:{RESTORE_LABEL}) REMOVE n._restore_id, n:{RESTORE_LABEL}")
    client.execute_write(f"DROP INDEX {RESTORE_INDEX} IF EXISTS")
    print(f"Restored {len(snapshot['nodes'])} nodes and {len(snapshot['relationships'])} relationships from {path}")


def verify() -> int:
    client = connect()
    errors, warnings = [], []

    # 1. citation edges must join two distinct, identifiable papers
    bad_cites = client.execute_read("""
    MATCH (a)-[r:CITES]->(b)
    WHERE NOT a:Paper OR NOT b:Paper OR a = b OR a.id IS NULL OR b.id IS NULL
    RETURN coalesce(a.id, a.name, elementId(a)) AS source, coalesce(b.id, b.name, elementId(b)) AS target
    LIMIT 20
    """)
    if bad_cites:
        errors.append(f"{len(bad_cites)} broken :CITES references, e.g. {bad_cites[0]['source']} -> {bad_cites[0]['target']}")

    # 2. nodes missing the key their label is identified by
    for label, key in NODE_KEYS.items():
        missing = client.execute_read(f"MATCH (n:`{label}`) WHERE n.{key} IS NULL RETURN count(n) AS c")[0]["c"]
        if missing:
            errors.append(f"{missing} :{label} nodes have no '{key}'")

    # 3. papers stored without a title (usually half-written citation stubs)
    untitled = client.execute_read("MATCH (p:Paper) WHERE p.title IS NULL OR trim(p.title) = '' RETURN count(p) AS c")[0]["c"]
    if untitled:
        errors.append(f"{untitled} :Paper nodes have an empty title")

    # 4. duplicate or missing constraints
    constraints = client.execute_read("SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN *")
    seen = defaultdict(list)
    for c in constraints:
        seen[(c["type"], tuple(c["labelsOrTypes"] or []), tuple(c["properties"] or []))].append(c["name"])
    for (ctype, labels, props), names in seen.items():
        if len(names) > 1:
            errors.append(f"duplicate {ctype} constraints on {labels}{props}: {', '.join(names)}")
    names = {c["name"] for c in constraints}
    for expected in EXPECTED_CONSTRAINTS:
        if expected not in names:
            warnings.append(f"constraint {expected} is missing (start the API once or run init_neo4j_schema)")

    # 5. orphans: nodes with no relationships at all
    orphans = client.execute_read("""
    MATCH (n)
    WHERE NOT (n)--()
    RETURN labels(n)[0] AS label, count(n) AS c, collect(coalesce(n.title, n.name, n.id))[..3] AS sample
    """)
    for o in orphans:
        warnings.append(f"{o['c']} orphaned :{o['label']} nodes, e.g. {o['sample']}")

    total = client.execute_read("MATCH (n) RETURN count(n) AS nodes")[0]["nodes"]
    rels = client.execute_read("MATCH ()-[r]->() RETURN count(r) AS rels")[0]["rels"]
    print(f"Checked {total} nodes and {rels} relationships on {client.uri}")
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  FAIL  {e}")
    print("Integrity check passed." if not errors else f"Integrity check failed with {len(errors)} error(s).")
    return 1 if errors else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backup, restore and verify the ResearchIQ Neo4j graph")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--backup", action="store_true", help="write a timestamped JSON snapshot of the whole graph")
    mode.add_argument("--restore", metavar="FILE", help="load a snapshot written by --backup")
    mode.add_argument("--verify", action="store_true", help="run graph integrity checks")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "backups"),
                        help="directory for --backup files (default: backups/)")
    args = parser.parse_args()

    if args.backup:
        backup(args.out)
    elif args.restore:
        restore(args.restore)
    else:
        sys.exit(verify())
