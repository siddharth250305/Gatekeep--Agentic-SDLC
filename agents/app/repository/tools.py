"""Controlled, workspace-scoped tools for the coding agent. The LLM only ever
calls these - never raw shell. Every path is confined to the run workspace."""

from __future__ import annotations

import json
from pathlib import Path

from . import scanner
from .security import is_sensitive_path, redact_secrets, resolve_inside


class WorkspaceTools:
    def __init__(self, workspace: str):
        self.root = Path(workspace).resolve()
        # Set while a review is pending (B6). It sits next to the workspace,
        # not inside it, so nothing the robot writes can remove it.
        self.freeze_marker = self.root.parent / ".frozen" / self.root.name

    def _safe(self, path: str) -> Path:
        # The real file behind every shortcut is checked, not just the name (D2).
        return resolve_inside(self.root, path)

    # ── B6: no writes while a review is pending ──────────────────────────

    def is_frozen(self) -> bool:
        return self.freeze_marker.exists()

    def freeze(self, fingerprint: str) -> None:
        self.freeze_marker.parent.mkdir(parents=True, exist_ok=True)
        self.freeze_marker.write_text(json.dumps({"fingerprint": fingerprint}))

    def thaw(self) -> None:
        self.freeze_marker.unlink(missing_ok=True)

    def list_files(self) -> list[str]:
        return [f["path"] for f in scanner.scan(str(self.root))]

    def read_file(self, path: str, max_bytes: int = 40_000) -> str:
        if is_sensitive_path(path):
            return "<refused: sensitive file>"
        p = self._safe(path)
        if not p.is_file():
            return f"<not found: {path}>"
        text = p.read_text(errors="replace")[:max_bytes]
        redacted, _ = redact_secrets(text)
        return redacted

    def search_code(self, query: str, limit: int = 50) -> list[dict]:
        """Matches are found in the redacted text, so a search can neither show
        a secret value nor confirm that one exists (D3)."""
        q = query.lower()
        out: list[dict] = []
        for f in scanner.scan(str(self.root)):
            try:
                text = self._safe(f["path"]).read_text(errors="replace")
            except (OSError, ValueError):
                continue
            for i, line in enumerate(redact_secrets(text)[0].splitlines(), 1):
                if q in line.lower():
                    out.append({"path": f["path"], "line": i, "text": line.strip()[:200]})
                    if len(out) >= limit:
                        return out
        return out

    def _safe_writable(self, path: str) -> Path:
        # The MCP policy engine checks this too; checking here as well covers
        # every caller, including the built-in pipeline agent.
        if self.is_frozen():
            raise ValueError("refused: the workspace is frozen while the code is at Gate 3 for review")
        if is_sensitive_path(path):
            raise ValueError(f"refused: {path} is a sensitive file")
        return self._safe(path)

    def write_file(self, path: str, content: str) -> dict:
        p = self._safe_writable(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return {"path": path, "bytes": len(content.encode())}

    def apply_patch(self, path: str, find: str, replace: str) -> dict:
        """Deterministic in-place edit: replace `find` with `replace`. Safer than
        rewriting whole files. Returns applied=False if `find` is absent."""
        p = self._safe_writable(path)
        if not p.is_file():
            return {"path": path, "applied": False, "reason": "file not found"}
        text = p.read_text(errors="replace")
        if find in text:
            p.write_text(text.replace(find, replace, 1))
            return {"path": path, "applied": True}

        # Resilient fallback: whitespace-trimmed line matching
        find_norm = "\n".join(ln.rstrip() for ln in find.strip().splitlines())
        text_lines = text.splitlines()
        text_norm = "\n".join(ln.rstrip() for ln in text_lines)
        if find_norm and find_norm in text_norm:
            idx = text_norm.find(find_norm)
            prefix_lines = text_norm[:idx].count("\n")
            target_line_count = find_norm.count("\n") + 1
            new_lines = (
                text_lines[:prefix_lines]
                + replace.splitlines()
                + text_lines[prefix_lines + target_line_count:]
            )
            p.write_text("\n".join(new_lines) + ("\n" if text.endswith("\n") else ""))
            return {"path": path, "applied": True, "resilient": True}

        return {"path": path, "applied": False, "reason": "anchor not found"}


WORKSPACE_TOOLS_SCHEMA = [
    {
        "name": "list_files",
        "description": "List all tracked and source code files in the workspace repository.",
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        },
    },
    {
        "name": "read_file",
        "description": "Read file contents (up to 40,000 bytes). Confidential files and secrets are automatically redacted.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Relative file path inside the workspace repository."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "search_code",
        "description": "Search the codebase for a text query, class name, or function name. Returns matching lines and file paths.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Text substring, symbol, or pattern to search for."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "write_file",
        "description": "Create a new file or completely overwrite an existing file in the workspace.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Relative file path."},
                "content": {"type": "STRING", "description": "Complete text content of the file."},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "apply_patch",
        "description": "Make a surgical edit by replacing an exact existing code block (`find`) with a new code block (`replace`).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {"type": "STRING", "description": "Relative file path to modify."},
                "find": {"type": "STRING", "description": "Exact existing code snippet to locate and replace."},
                "replace": {"type": "STRING", "description": "New replacement code snippet."},
            },
            "required": ["path", "find", "replace"],
        },
    },
]
