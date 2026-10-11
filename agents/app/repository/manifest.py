"""Build a repository manifest from scanned file records. No invented data -
every field is derived from what is actually present."""

from __future__ import annotations

from pathlib import PurePosixPath

ENTRY_POINT_NAMES = {
    "main.py", "app.py", "__main__.py", "manage.py", "wsgi.py", "asgi.py",
    "server.py", "index.js", "main.js", "server.js", "app.js", "index.ts",
    "main.ts", "main.go", "main.rs", "Main.java",
}


def _is_entry_point(rel: str) -> bool:
    name = PurePosixPath(rel).name
    if name in ENTRY_POINT_NAMES:
        return True
    parts = rel.replace("\\", "/").split("/")
    return len(parts) >= 2 and parts[0] == "cmd" and name.endswith(".go")


def build_manifest(repository_url: str, commit_sha: str, files: list[dict]) -> dict:
    # language percentages by total bytes (falls back to file count if no size)
    by_lang: dict[str, int] = {}
    total = 0
    for f in files:
        if f["language"] in ("markdown", "text", "json", "yaml", "toml", "ini", "other"):
            continue  # weight by real code languages
        by_lang[f["language"]] = by_lang.get(f["language"], 0) + max(f["size"], 1)
        total += max(f["size"], 1)
    languages = (
        {lang: round(b / total * 100, 1) for lang, b in sorted(by_lang.items(), key=lambda x: -x[1])}
        if total else {}
    )

    return {
        "repository_url": repository_url,
        "commit_sha": commit_sha,
        "languages": languages,
        "files": files,
        "entry_points": [f["path"] for f in files if _is_entry_point(f["path"])],
        "dependency_files": [f["path"] for f in files if f["type"] == "dependency"],
        "test_files": [f["path"] for f in files if f["type"] == "test"],
        "documentation": [f["path"] for f in files if f["type"] == "doc"],
    }
