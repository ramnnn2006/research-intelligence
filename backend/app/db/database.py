import sqlite3, json, os, tempfile

DB_PATH = os.path.join(tempfile.gettempdir(), "riq_platform.db")

def init_db():
    con = sqlite3.connect(DB_PATH)
    c = con.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS papers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            arxiv_id TEXT UNIQUE,
            title TEXT,
            authors TEXT,
            abstract TEXT,
            year TEXT,
            url TEXT,
            source TEXT,
            citations INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS searches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT,
            results_json TEXT,
            repos_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic TEXT,
            report_type TEXT,
            content TEXT,
            repos_json TEXT,
            papers_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    # Migrate existing reports table if repos_json/papers_json columns missing
    try:
        c.execute("ALTER TABLE reports ADD COLUMN repos_json TEXT")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE reports ADD COLUMN papers_json TEXT")
    except Exception:
        pass
    # Migrate searches table if repos_json column missing
    try:
        c.execute("ALTER TABLE searches ADD COLUMN repos_json TEXT")
    except Exception:
        pass
    con.commit(); con.close()

def _con(): return sqlite3.connect(DB_PATH)

def save_search(query: str, papers: list, repos: list):
    con = _con()
    try:
        con.execute(
            "INSERT INTO searches(query,results_json,repos_json) VALUES(?,?,?)",
            (query, json.dumps(papers), json.dumps(repos))
        )
        con.commit()
    finally:
        con.close()

def save_report(topic: str, rtype: str, content: str, repos: list = None, papers: list = None):
    con = _con()
    try:
        con.execute(
            "INSERT INTO reports(topic,report_type,content,repos_json,papers_json) VALUES(?,?,?,?,?)",
            (topic, rtype, content, json.dumps(repos or []), json.dumps(papers or []))
        )
        con.commit()
    finally:
        con.close()

def get_reports(limit=50):
    con = _con(); con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id,topic,report_type,created_at FROM reports ORDER BY created_at DESC LIMIT ?",
        (limit,)
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]

def get_searches(limit=30):
    con = _con(); con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id,query,repos_json,created_at FROM searches ORDER BY created_at DESC LIMIT ?",
        (limit,)
    ).fetchall()
    con.close()
    result = []
    for r in rows:
        d = dict(r)
        try: d['repos'] = json.loads(d.pop('repos_json') or '[]')
        except: d['repos'] = []
        result.append(d)
    return result

def get_report_by_id(rid: int):
    con = _con(); con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone()
    con.close()
    if not row: return None
    d = dict(row)
    for key in ('repos_json', 'papers_json'):
        try:
            d[key.replace('_json','')] = json.loads(d.pop(key) or '[]')
        except:
            d[key.replace('_json','')] = []
    return d
