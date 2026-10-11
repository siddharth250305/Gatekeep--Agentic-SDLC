"""Recursively scan a cloned workspace into structured, typed file records.

Ignores VCS/build/dependency dirs, binary files, and sensitive files. Extensible
via the LANGUAGES / IGNORE_DIRS / *_FILES tables below.
"""

from __future__ import annotations

import os
from pathlib import Path

from .security import is_sensitive_path

# extension -> language. Extend here to support more languages.
LANGUAGES: dict[str, str] = {
    ".py": "python",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".jsx": "jsx",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".c": "c", ".h": "c",
    ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp",
    ".html": "html", ".htm": "html",
    ".css": "css", ".scss": "css",
    ".json": "json",
    ".yaml": "yaml", ".yml": "yaml",
    ".md": "markdown",
    ".toml": "toml", ".ini": "ini", ".cfg": "ini",
    ".sh": "shell",
    ".txt": "text",
}

CODE_LANGUAGES = {"python", "javascript", "jsx", "typescript", "tsx", "java",
                  "go", "rust", "c", "cpp", "shell"}

IGNORE_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
    "coverage", ".next", ".cache", "target", "vendor", ".pytest_cache",
    ".mypy_cache", ".idea", ".vscode", ".tox", "egg-info",
}

DEPENDENCY_FILES = {
    "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
    "requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile", "Pipfile.lock",
    "pom.xml", "build.gradle", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum",
    "Gemfile", "composer.json",
}

CONFIG_FILES = {
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "tsconfig.json",
    ".eslintrc", ".eslintrc.json", ".prettierrc", "Makefile", ".gitignore",
}
CONFIG_PREFIXES = ("vite.config.", "next.config.", "webpack.config.", "jest.config.")


def detect_language(ext: str) -> str | None:
    return LANGUAGES.get(ext.lower())


def _is_binary(path: Path, sniff: int = 8192) -> bool:
    try:
        with open(path, "rb") as fh:
            return b"\x00" in fh.read(sniff)
    except OSError:
        return True


def _classify(rel: str, ext: str, name: str, language: str | None) -> str:
    n = name.lower()
    parts = rel.replace("\\", "/").lower().split("/")
    if name in DEPENDENCY_FILES:
        return "dependency"
    if (n.startswith("test_") or n.endswith(("_test.py", ".test.js", ".spec.js",
                                             ".test.ts", ".spec.ts", ".test.jsx"))
            or "tests" in parts or "__tests__" in parts):
        return "test"
    if ext == ".md" or n == "readme" or parts[0] == "docs":
        return "doc"
    if (name in CONFIG_FILES or name.startswith(CONFIG_PREFIXES)
            or ext in {".json", ".yaml", ".yml", ".toml", ".ini", ".cfg"}):
        return "config"
    if language in CODE_LANGUAGES:
        return "source"
    return "other"


def scan(workspace: str) -> list[dict]:
    """Return a sorted list of file records for the workspace."""
    root = Path(workspace)
    records: list[dict] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.endswith(".egg-info")]
        for fn in filenames:
            full = Path(dirpath) / fn
            try:
                rel = str(full.relative_to(root))
            except ValueError:
                continue
            if is_sensitive_path(rel):
                continue  # secrets never enter the index
            ext = full.suffix.lower()
            language = detect_language(ext)
            recognised = (language is not None or fn in DEPENDENCY_FILES
                          or fn in CONFIG_FILES or fn.startswith(CONFIG_PREFIXES))
            if not recognised:
                continue  # skip unknown/binary noise
            if _is_binary(full):
                continue
            try:
                size = full.stat().st_size
            except OSError:
                continue
            records.append({
                "path": rel,
                "language": language or "other",
                "extension": ext,
                "type": _classify(rel, ext, fn, language),
                "size": size,
            })
    records.sort(key=lambda r: r["path"])
    return records
