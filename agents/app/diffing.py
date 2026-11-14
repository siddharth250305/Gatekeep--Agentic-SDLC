"""Unified diffs of a run workspace, shared by the MCP server and the pipeline.

workspace_diff() runs git with the repo's own program hooks disabled, because a
workspace holds untrusted content (see drawback.md 1.5)."""

from __future__ import annotations

import os
import re
import subprocess
from typing import Any

from .fingerprint import skipped
from .repository.security import is_sensitive_path, redact_secrets

# Per-file cap on diff lines sent to the dashboard.
_MAX_DIFF_LINES = 3000

# Workspaces hold untrusted repo content, so git must never run programs named
# in the repo's own config (fsmonitor hooks, external diff, textconv drivers).
_GIT_SAFE_CONFIG = ("-c", "core.fsmonitor=false")
_GIT_SAFE_DIFF = ("--no-ext-diff", "--no-textconv")



def workspace_diff(workspace: str) -> str:
    """`git diff HEAD` plus every new untracked file, so reviewers see all
    changes. Secret values are hidden (D3): the diff goes to the robot and
    to the dashboard."""
    if not os.path.isdir(os.path.join(workspace, ".git")):
        return ""

    def git(*args: str) -> str:
        proc = subprocess.run(["git", *_GIT_SAFE_CONFIG, *args], cwd=workspace,
                              capture_output=True, text=True, timeout=15)
        return proc.stdout

    parts = [git("diff", *_GIT_SAFE_DIFF, "HEAD")]
    # Every new file, including ones .gitignore hides: whatever runs in the
    # sandbox must be visible to the reviewer (a conftest.py could be ignored).
    untracked = git("ls-files", "--others", "-z").split("\0")
    for path in sorted(p for p in untracked if p):
        if skipped(path) or is_sensitive_path(path):
            continue
        # --no-index exits 1 when the files differ, which is always the case here.
        parts.append(git("diff", *_GIT_SAFE_DIFF, "--no-index", "--", "/dev/null", path))
    return redact_secrets("".join(parts))[0]


def diff_artifacts(diff_text: str) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Split a unified diff into the dashboard's `files` list and `diff` object."""
    by_file: dict[str, dict[str, Any]] = {}
    current: dict[str, Any] | None = None
    old_n = new_n = 0
    in_hunk = False
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            path = line.split(" b/", 1)[-1]
            current = by_file[path] = {"file": path, "status": "M", "add": 0, "rem": 0, "lines": []}
            in_hunk = False
            continue
        if current is None:
            continue
        if not in_hunk:
            if line.startswith("new file mode"):
                current["status"] = "A"
            elif line.startswith("deleted file mode"):
                current["status"] = "D"
        if line.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)", line)
            old_n, new_n = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
            in_hunk = True
            continue
        if not in_hunk or line.startswith("\\"):
            continue
        if line.startswith("+"):
            current["add"] += 1
            entry = {"n1": None, "n2": new_n, "type": "add", "text": line[1:]}
            new_n += 1
        elif line.startswith("-"):
            current["rem"] += 1
            entry = {"n1": old_n, "n2": None, "type": "rem", "text": line[1:]}
            old_n += 1
        else:
            entry = {"n1": old_n, "n2": new_n, "type": "ctx", "text": line[1:]}
            old_n += 1
            new_n += 1
        if len(current["lines"]) < _MAX_DIFF_LINES:
            current["lines"].append(entry)

    if not by_file:
        return [], None
    files = [{"path": p, "status": f["status"], "add": f["add"], "rem": f["rem"]} for p, f in by_file.items()]
    first = next(iter(by_file.values()))
    return files, {**first, "by_file": by_file}
