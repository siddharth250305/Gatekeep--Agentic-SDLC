"""A fingerprint of the exact code in a workspace (B7).

Each test run is recorded with the fingerprint of the code it ran on, and
"request review" hands over the fingerprint of the code being reviewed. The
backend only lets Gate 3 approve when the two match and that test run passed,
so an approval always means "this exact version, tested".

The fingerprint is a SHA-256 over every file's path and contents (and every
shortcut's target), in path order. Git metadata and pytest's caches (SKIP_DIRS) are left out.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Iterable

# The one skip rule for "what counts as the code": the fingerprint, the
# sandbox copy and the review diff all leave out exactly these directories
# (matched by exact name), so whatever runs in the sandbox is fingerprinted
# and shown to the reviewer. .gatekeep holds the evidence bundles GateKeep adds
# to its Pull Requests (I6) and is left out only at the top of the workspace:
# anywhere else it is code like any other (ECC review). The robot can never
# write into any of these folders (mcp/policy.py). backend/src/evidence/verify.js
# applies the same rule.
SKIP_DIRS = frozenset({".git", "__pycache__", ".pytest_cache"})
TOP_SKIP_DIRS = frozenset({".gatekeep"})


def skip_dir(name: str, at_top: bool) -> bool:
    """Is a folder called *name* left out (at_top: directly in the workspace)?"""
    return name in SKIP_DIRS or (at_top and name in TOP_SKIP_DIRS)


def skipped(rel: str) -> bool:
    """True if a workspace path lies inside a folder that is left out."""
    parts = rel.replace("\\", "/").split("/")
    return any(skip_dir(part, i == 0) for i, part in enumerate(parts[:-1]))


def digest_entries(entries: Iterable[tuple[str, str, bytes]]) -> str:
    """The fingerprint of (path, kind, bytes) entries; kind is F (file) or L (shortcut)."""
    h = hashlib.sha256()
    for rel, kind, data in sorted(entries):
        h.update(f"{kind}\0{rel}\0{hashlib.sha256(data).hexdigest()}\n".encode())
    return h.hexdigest()


def tree_fingerprint(workspace: str) -> str:
    """Fingerprint of every file under *workspace* (shortcuts are not followed)."""
    root = Path(workspace)
    entries: list[tuple[str, str, bytes]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        kept = []
        for d in dirnames:
            if skip_dir(d, here == root):
                continue
            if (here / d).is_symlink():
                entries.append(((here / d).relative_to(root).as_posix(), "L", os.readlink(here / d).encode()))
            else:
                kept.append(d)
        dirnames[:] = kept
        for fn in filenames:
            full = here / fn
            rel = full.relative_to(root).as_posix()
            if full.is_symlink():
                entries.append((rel, "L", os.readlink(full).encode()))
            else:
                entries.append((rel, "F", full.read_bytes()))
    return digest_entries(entries)


def files_fingerprint(files: dict[str, str]) -> str:
    """Fingerprint of an in-memory set of files; equals tree_fingerprint() of
    a directory holding exactly these files."""
    return digest_entries((rel, "F", content.encode()) for rel, content in files.items())
