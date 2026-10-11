"""Orchestrates the Repository Context Engine: scan -> manifest -> retrieve ->
read relevant content (secret-scrubbed, size-limited) -> a compact context
object safe to hand to the LLM."""

from __future__ import annotations

from pathlib import Path

from . import scanner
from .manifest import build_manifest
from .retriever import retrieve
from .security import is_sensitive_path, redact_secrets

MAX_RELEVANT_FILES = 10
MAX_FILE_CHARS = 6_000
MAX_CONTEXT_CHARS = 40_000


def build_context(workspace: str, feature_request: str, repository_url: str,
                  commit_sha: str, max_files: int = MAX_RELEVANT_FILES) -> dict:
    files = scanner.scan(workspace)
    manifest = build_manifest(repository_url, commit_sha, files)
    relevant = retrieve(feature_request, workspace, manifest, max_files=max_files)
    type_by_path = {f["path"]: f["type"] for f in files}
    for r in relevant:
        r["type"] = type_by_path.get(r["path"], "other")

    # read the relevant files' content, scrubbed + capped
    root = Path(workspace)
    file_contents: list[dict] = []
    budget = MAX_CONTEXT_CHARS
    for r in relevant:
        if budget <= 0:
            break
        if is_sensitive_path(r["path"]):
            continue
        try:
            raw = (root / r["path"]).read_text(errors="replace")[:MAX_FILE_CHARS]
        except OSError:
            continue
        content, redacted = redact_secrets(raw)
        content = content[:budget]
        budget -= len(content)
        file_contents.append({"path": r["path"], "content": content,
                              "truncated": len(raw) >= MAX_FILE_CHARS,
                              "redacted": redacted})

    # trimmed manifest for the LLM (no full file list, which can be huge)
    manifest_summary = {
        "repository_url": manifest["repository_url"],
        "commit_sha": manifest["commit_sha"],
        "languages": manifest["languages"],
        "file_count": len(files),
        "entry_points": manifest["entry_points"][:10],
        "dependency_files": manifest["dependency_files"],
        "test_files": manifest["test_files"][:20],
        "documentation": manifest["documentation"][:10],
    }

    return {
        "repository": {"url": repository_url, "commit_sha": commit_sha},
        "feature_request": feature_request,
        "manifest": manifest_summary,
        "relevant_files": relevant,
        "file_contents": file_contents,
        "retrieval_method": "deterministic-hybrid (filename+path+content+imports+tests)",
    }
