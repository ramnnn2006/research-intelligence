"""Async code must not call blocking storage (Neo4j, Mongo, PDF store) on the event loop.

The check resolves what each name points to, so it follows the import forms used in
this repo: `from app.db.x import f`, `from app.db import x`, `import app.db.x as y`,
relative imports, full dotted references, and simple local aliases (`g = x.f`).
Known limit: names built dynamically (getattr, dict lookups, passing a module around)
are not followed.
"""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "backend" / "app"
BLOCKING_PACKAGES = ("db", "rag")
IN_MEMORY_ONLY = {"count", "get_stats", "max_pdf_bytes", "arxiv_pdf_filename"}
PURE_MODULES = {"app.db.ids"}
STARTUP_HOOKS = {"lifespan"}


def _parse(path):
    return ast.parse(path.read_text(encoding="utf-8-sig"))


def _module_name(app_dir, path):
    parts = list(path.relative_to(app_dir).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(["app"] + parts)


def _blocking_modules(app_dir):
    """{module: (sync function names, module-level objects built by a call)}"""
    table = {}
    for package in BLOCKING_PACKAGES:
        for path in sorted((app_dir / package).glob("*.py")):
            module = _module_name(app_dir, path)
            if module in PURE_MODULES:
                continue
            tree = _parse(path)
            sync = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
            sync -= {n.name for n in tree.body if isinstance(n, ast.AsyncFunctionDef)}
            objects = {t.id for n in tree.body if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
                       for t in n.targets if isinstance(t, ast.Name) and t.id not in {"logger", "log"}}
            table[module] = (sync - IN_MEMORY_ONLY, objects)
    return table


def _all_modules(app_dir):
    return {_module_name(app_dir, p) for p in app_dir.rglob("*.py")}


class _Resolver:
    def __init__(self, module, is_package, tree, table, modules):
        self.table, self.modules, self.symbols = table, modules, {}
        pkg = module if is_package else module.rpartition(".")[0]
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    if a.asname:
                        self.symbols[a.asname] = ("module", a.name)
                    else:
                        self.symbols[a.name.split(".")[0]] = ("module", a.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    root = pkg.split(".")[: len(pkg.split(".")) - (node.level - 1)]
                    base = ".".join(root + ([node.module] if node.module else []))
                for a in node.names:
                    full = f"{base}.{a.name}"
                    self.symbols[a.asname or a.name] = ("module", full) if full in modules else ("attr", base, a.name)
        for node in ast.walk(tree):  # simple aliases: g = x.f
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                target = self.resolve(node.value)
                if target:
                    self.symbols[node.targets[0].id] = target

    def resolve(self, node):
        if isinstance(node, ast.Name):
            return self.symbols.get(node.id)
        if isinstance(node, ast.Attribute):
            base = self.resolve(node.value)
            if base and base[0] == "module":
                full = f"{base[1]}.{node.attr}"
                return ("module", full) if full in self.modules or any(m.startswith(full + ".") for m in self.modules) \
                    else ("attr", base[1], node.attr)
            if base and base[0] == "attr":
                return ("method", base[1], base[2], node.attr)
        return None

    def blocking(self, call):
        target = self.resolve(call.func)
        if not target or target[1] not in self.table:
            return None
        sync, objects = self.table[target[1]]
        if target[0] == "attr" and target[2] in sync:
            return f"{target[1]}.{target[2]}"
        if target[0] == "method" and target[2] in objects and target[3] not in IN_MEMORY_ONLY:
            return f"{target[1]}.{target[2]}.{target[3]}"
        return None


def direct_blocking_calls(app_dir):
    table, modules = _blocking_modules(app_dir), _all_modules(app_dir)
    found = []
    for path in sorted(app_dir.rglob("*.py")):
        tree = _parse(path)
        module = _module_name(app_dir, path)
        resolver = _Resolver(module, path.name == "__init__.py", tree, table, modules)
        for fn in (n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name not in STARTUP_HOOKS):
            for call in (n for n in ast.walk(fn) if isinstance(n, ast.Call)):
                label = resolver.blocking(call)
                if label:
                    found.append(f"{path.relative_to(app_dir)}:{call.lineno} async {fn.name} calls blocking {label}()")
    return found


def test_async_code_never_calls_blocking_storage_directly():
    offenders = direct_blocking_calls(APP)
    assert not offenders, (
        "Blocking database or PDF-store call on the event loop. Wrap it: "
        "await run_in_threadpool(fn, *args).\n" + "\n".join(offenders)
    )


def _tree(tmp_path, caller):
    app = tmp_path / "app"
    (app / "db").mkdir(parents=True)
    (app / "services").mkdir()
    for p in (app, app / "db", app / "services"):
        (p / "__init__.py").write_text("")
    (app / "db" / "store.py").write_text("def read_thing():\n    return 1\n\nasync def aread():\n    return 1\n\ndef count():\n    return 0\n\nclient = make()\n")
    (app / "services" / "svc.py").write_text(caller)
    return app


UNSAFE = {
    "from_import": "from app.db.store import read_thing\nasync def f():\n    read_thing()\n",
    "from_import_alias": "from app.db.store import read_thing as r\nasync def f():\n    r()\n",
    "package_module": "from app.db import store\nasync def f():\n    store.read_thing()\n",
    "module_alias": "from app.db import store as s\nasync def f():\n    s.read_thing()\n",
    "import_as": "import app.db.store as s\nasync def f():\n    s.read_thing()\n",
    "full_dotted": "import app.db.store\nasync def f():\n    app.db.store.read_thing()\n",
    "relative": "from ..db import store\nasync def f():\n    store.read_thing()\n",
    "relative_name": "from ..db.store import read_thing\nasync def f():\n    read_thing()\n",
    "local_alias": "from app.db import store\nasync def f():\n    g = store.read_thing\n    g()\n",
    "module_alias_assign": "from app.db import store\ns = store\nasync def f():\n    s.read_thing()\n",
    "object_method": "from app.db.store import client\nasync def f():\n    client.query()\n",
    "nested_in_await_arg": "from app.db import store\nasync def f(x):\n    return await x(store.read_thing())\n",
}
SAFE = {
    "threadpooled": "from app.db import store\nfrom fastapi.concurrency import run_in_threadpool\nasync def f():\n    await run_in_threadpool(store.read_thing)\n",
    "sync_caller": "from app.db import store\ndef f():\n    return store.read_thing()\n",
    "async_db_function": "from app.db import store\nasync def f():\n    await store.aread()\n",
    "in_memory_only": "from app.db import store\nasync def f():\n    return store.count()\n",
    "unrelated_same_name": "async def f(store):\n    return store.read_thing()\n",
}


def test_guard_catches_every_import_form(tmp_path):
    for name, source in UNSAFE.items():
        offenders = direct_blocking_calls(_tree(tmp_path / name, source))
        assert offenders, f"guard missed unsafe form: {name}"


def test_guard_accepts_safe_forms(tmp_path):
    for name, source in SAFE.items():
        offenders = direct_blocking_calls(_tree(tmp_path / name, source))
        assert not offenders, f"guard flagged safe form {name}: {offenders}"
