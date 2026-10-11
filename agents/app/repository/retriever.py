"""Deterministic, explainable relevance ranking. No embeddings, no vector DB.

Given a feature request + scanned files, score each file with multiple signals
and return the top-N with human-readable reasons.
"""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

STOPWORDS = {
    "add", "the", "a", "an", "to", "for", "of", "and", "or", "in", "on", "with",
    "make", "support", "implement", "create", "new", "feature", "please", "should",
    "when", "so", "that", "this", "it", "is", "are", "be", "can", "we", "i",
}

# Small domain synonym groups so "login" matches "auth.py", etc.
SYNONYMS = [
    {"login", "signin", "auth", "authentication", "authorize", "authorization", "session"},
    {"password", "reset", "credential", "credentials"},
    {"database", "db", "migration", "sql", "schema", "model", "orm", "query"},
    {"react", "component", "ui", "dashboard", "jsx", "frontend", "page", "view"},
    {"rate", "limit", "throttle", "ratelimit", "quota"},
    {"health", "status", "ping", "liveness", "readiness", "healthcheck"},
    {"api", "endpoint", "route", "router", "controller", "handler"},
    {"user", "account", "profile", "member"},
    {"payment", "billing", "invoice", "charge", "stripe"},
    {"cache", "caching", "redis", "memoize"},
]

PATH_BOOST_DIRS = {
    "src", "app", "api", "routes", "controllers", "services", "middleware",
    "components", "handlers", "lib", "core", "tests", "test",
}

_TOKEN = re.compile(r"[a-z0-9]+")
MAX_READ = 200_000  # chars scanned per file for content/imports


def keywords(feature_request: str) -> set[str]:
    toks = {t for t in _TOKEN.findall(feature_request.lower()) if len(t) >= 3 and t not in STOPWORDS}
    expanded = set(toks)
    for group in SYNONYMS:
        if toks & group:
            expanded |= group
    return expanded


def _read(path: Path) -> str:
    try:
        return path.read_text(errors="replace")[:MAX_READ]
    except OSError:
        return ""


def _stem_tokens(rel: str) -> set[str]:
    name = PurePosixPath(rel).name.lower()
    return set(_TOKEN.findall(name))


# --- import edges (approximate, best-effort) ------------------------------
_PY_IMPORT = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", re.M)
_JS_IMPORT = re.compile(r"""(?:from\s+|require\(\s*)['"]([^'"]+)['"]""")


def _resolve(module: str, importer: str, by_stem: dict[str, list[str]]) -> list[str]:
    last = module.replace("\\", "/").split("/")[-1].split(".")[-1]
    if module.startswith("."):
        # relative import: resolve against importer dir
        base = PurePosixPath(importer).parent
        cand = str((base / last).as_posix())
        return [p for p in by_stem.get(last, []) if p.startswith(str(base)) or True][:1] or by_stem.get(last, [])[:1]
    return by_stem.get(last, [])[:1]


def _import_edges(files: list[dict], root: Path) -> dict[str, list[str]]:
    by_stem: dict[str, list[str]] = {}
    for f in files:
        by_stem.setdefault(PurePosixPath(f["path"]).stem, []).append(f["path"])
    edges: dict[str, list[str]] = {}
    for f in files:
        if f["language"] not in ("python", "javascript", "jsx", "typescript", "tsx"):
            continue
        text = _read(root / f["path"])
        mods: list[str] = []
        if f["language"] == "python":
            mods += [m for a, b in _PY_IMPORT.findall(text) for m in (a, b) if m]
        else:
            mods += _JS_IMPORT.findall(text)
        targets: list[str] = []
        for mod in mods:
            targets += _resolve(mod, f["path"], by_stem)
        edges[f["path"]] = sorted({t for t in targets if t != f["path"]})
    return edges


def retrieve(feature_request: str, workspace: str, manifest: dict, max_files: int = 10) -> list[dict]:
    root = Path(workspace)
    files = manifest["files"]
    kw = keywords(feature_request)

    scores: dict[str, float] = {}
    reasons: dict[str, list[str]] = {}

    def add(path: str, pts: float, reason: str | None):
        scores[path] = scores.get(path, 0.0) + pts
        if reason and reason not in reasons.setdefault(path, []):
            reasons[path].append(reason)

    # signal 1 + 2: filename & path
    for f in files:
        rel = f["path"]
        stem = _stem_tokens(rel)
        hits = kw & stem
        if hits:
            add(rel, 3.0 * len(hits), f"filename matches {', '.join(sorted(hits))}")
        dirs = set(rel.replace("\\", "/").lower().split("/")[:-1])
        if dirs & PATH_BOOST_DIRS:
            add(rel, 0.5, None)

    # signal 3: content
    for f in files:
        if f["type"] not in ("source", "test", "config", "doc"):
            continue
        text = _read(root / f["path"]).lower()
        if not text:
            continue
        count = sum(text.count(k) for k in kw)
        if count:
            add(f["path"], min(count, 8) * 0.4, f"contains {min(count, 8)}+ references to the request")

    # signal 4: imports - boost files imported by already-relevant files
    edges = _import_edges(files, root)
    seed = {p for p, s in scores.items() if s >= 3.0}
    for importer in seed:
        for target in edges.get(importer, []):
            add(target, 2.0, f"imported by {PurePosixPath(importer).name}")

    # signal 5: tests related to selected sources
    by_stem: dict[str, list[str]] = {}
    for f in files:
        by_stem.setdefault(PurePosixPath(f["path"]).stem, []).append(f["path"])
    for f in files:
        if f["type"] != "test":
            continue
        stem = PurePosixPath(f["path"]).stem
        base = stem[5:] if stem.startswith("test_") else stem.replace("_test", "").replace(".test", "").replace(".spec", "")
        for src in by_stem.get(base, []):
            if scores.get(src, 0) >= 3.0:
                add(f["path"], 1.0, f"tests {PurePosixPath(src).name}")

    if not scores:
        return []

    # Apply the spec's priority ordering (source > tests > config > deps > docs)
    # as a type weight, so a matched source outranks its own test file.
    TYPE_WEIGHT = {"source": 1.0, "test": 0.6, "config": 0.5, "other": 0.5,
                   "dependency": 0.4, "doc": 0.4}
    type_by_path = {f["path"]: f["type"] for f in files}
    final = {p: s * TYPE_WEIGHT.get(type_by_path.get(p, "other"), 0.5) for p, s in scores.items()}

    top = max(final.values()) or 1.0
    ranked = sorted(final.items(), key=lambda kv: (-kv[1], kv[0]))[:max_files]
    return [
        {"path": p, "score": round(s / top, 3), "reasons": reasons.get(p, ["path relevance"])}
        for p, s in ranked
    ]
