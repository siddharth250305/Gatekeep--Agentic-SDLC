"""The project policy file, gatekeep.yaml (I5), on the agent side.

The file is read from the run's base commit (``git show HEAD:gatekeep.yaml``),
not the working tree, so nothing the robot writes can change the rules it is
judged by; the robot cannot commit, and GateKeepTools never lets it write
gatekeep.yaml or .gatekeep/ anyway. The parsed content goes to the backend,
which validates it (backend/src/policy/policy.js) and stores it once per run.
GateKeepTools then enforces the stored rules from ``run["policy"]``.

Path patterns follow one definition, shared with the backend and tested
against backend/test/fixtures/glob-cases.json.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

POLICY_FILE = "gatekeep.yaml"
MAX_POLICY_BYTES = 64 * 1024


def normalize_path(path: str) -> str:
    p = str(path).strip().replace("\\", "/")
    p = re.sub(r"/(\./)+", "/", p)
    p = re.sub(r"/{2,}", "/", p)
    p = re.sub(r"^(\./)+", "", p)
    return p.lstrip("/")


@lru_cache(maxsize=512)
def _compile(pattern: str) -> re.Pattern[str]:
    p = re.sub(r"(\*\*/)+", "**/", normalize_path(pattern))  # repeated **/ count once (no long backtracking)
    if p.endswith("/"):
        p += "**"
    if "/" not in p:
        p = f"**/{p}"
    out = []
    i = 0
    while i < len(p):
        c = p[i]
        if c == "*":
            at_start = i == 0 or p[i - 1] == "/"
            double = i + 1 < len(p) and p[i + 1] == "*"
            if double and at_start and i + 2 < len(p) and p[i + 2] == "/":
                out.append("(?:[^/]*/)*")
                i += 3
                continue
            if double and at_start and i + 2 == len(p):
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
            i += 2 if double else 1
            continue
        out.append("[^/]" if c == "?" else re.escape(c))
        i += 1
    return re.compile("^" + "".join(out) + "$", re.DOTALL)


def glob_match(pattern: str, path: str) -> bool:
    """Does *path* (relative to the workspace) match a gatekeep.yaml pattern?"""
    if not isinstance(pattern, str) or not isinstance(path, str):
        return False
    return _compile(pattern).match(normalize_path(path)) is not None


def has_glob(pattern: str) -> bool:
    return "*" in pattern or "?" in pattern


def plan_covers(entry_path: str, path: str) -> bool:
    """Does a design-plan entry cover *path*? Same rule as backend runs/trace.js."""
    if has_glob(entry_path):
        return glob_match(entry_path, path)
    return normalize_path(entry_path) == normalize_path(path)


# Folders left out of the fingerprint, the review diff and the sandbox copy
# (fingerprint.py), matched in any letter case and at any depth: anything the
# robot wrote there would ship without review (ECC review).
HIDDEN_DIRS = frozenset({".gatekeep", ".git", "__pycache__", ".pytest_cache"})
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def has_control_chars(path: str) -> bool:
    return bool(_CONTROL.search(str(path)))


def is_governance_path(path: str) -> bool:
    """gatekeep.yaml, and any folder the review cannot see (.gatekeep/,
    __pycache__/, ...), can never be written by the robot."""
    parts = [p for p in normalize_path(path).lower().split("/") if p not in ("", ".")]
    resolved: list[str] = []
    for part in parts:
        if part == "..":
            if resolved:
                resolved.pop()
        else:
            resolved.append(part)
    return resolved == [POLICY_FILE] or any(p in HIDDEN_DIRS for p in resolved[:-1])


def _git(workspace: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(workspace), *args],
                          capture_output=True, timeout=30)


def _committed_policy(workspace: Path) -> bytes | None:
    """gatekeep.yaml at HEAD, or None when HEAD has no such file. Any git
    failure raises: an unreadable policy is never taken for "no policy",
    because the backend records the answer once for the whole run (fail closed)."""
    listing = _git(workspace, "ls-tree", "--name-only", "HEAD", "--", POLICY_FILE)
    if listing.returncode != 0:
        raise subprocess.CalledProcessError(listing.returncode, "git ls-tree", listing.stdout, listing.stderr)
    if listing.stdout.strip() != POLICY_FILE.encode():
        return None
    shown = _git(workspace, "show", f"HEAD:{POLICY_FILE}")
    if shown.returncode != 0:
        raise subprocess.CalledProcessError(shown.returncode, "git show", shown.stdout, shown.stderr)
    return shown.stdout


class _PlainDataLoader(yaml.SafeLoader):
    """safe_load without anchors and aliases (no alias bombs, no shared or
    recursive structures): gatekeep.yaml is plain data."""

    def compose_node(self, parent, index):  # type: ignore[override]
        if self.check_event(yaml.AliasEvent):
            raise yaml.YAMLError("anchors and aliases (*name) are not allowed in gatekeep.yaml")
        return super().compose_node(parent, index)


def load_policy_file(workspace: str) -> dict[str, Any]:
    """What PUT /runs/:id/policy expects:
    {"found": False} | {"found": True, "sha256", "content"} | {"found": True, "sha256", "error"}.

    In a git workspace the file comes from HEAD (the base commit); in a plain
    folder (no git) from disk."""
    root = Path(workspace)
    if (root / ".git").exists():
        data = _committed_policy(root)
    else:
        f = root / POLICY_FILE
        data = f.read_bytes() if f.is_file() and not f.is_symlink() else None
    if data is None:
        return {"found": False}
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > MAX_POLICY_BYTES:
        return {"found": True, "sha256": digest, "error": f"{POLICY_FILE} is larger than {MAX_POLICY_BYTES} bytes"}
    try:
        content = yaml.load(data.decode("utf-8"), Loader=_PlainDataLoader)  # noqa: S506 (a SafeLoader)
        # Only what JSON can carry goes to the backend (no dates, no odd types).
        content = json.loads(json.dumps({} if content is None else content, allow_nan=False))
    except (yaml.YAMLError, UnicodeDecodeError, TypeError, ValueError, RecursionError) as exc:
        return {"found": True, "sha256": digest, "error": f"{POLICY_FILE} could not be used: {exc}"[:500]}
    return {"found": True, "sha256": digest, "content": content}
