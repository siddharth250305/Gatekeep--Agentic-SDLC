"""Fetch a real git repo into a per-run workspace so the pipeline operates on
actual code, not canned samples.

Public repos need no auth. For private repos, set GIT_TOKEN (a GitHub PAT) in
the agent's environment; it is injected into the clone URL and never logged or
stored.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

WORKSPACES = Path(__file__).resolve().parent.parent / "workspaces"

_OWNER_REPO = re.compile(r"^[\w.-]+/[\w.-]+$")


def is_git_url(repo: str | None) -> bool:
    """True for a real repo reference (URL or owner/repo), not a plain label."""
    if not repo:
        return False
    if repo.startswith(("https://", "git@", "file://")) or _OWNER_REPO.match(repo):
        return True
    # a local git repo path (useful for dev + offline tests)
    return os.path.isdir(os.path.join(repo, ".git"))


def _clone_url(repo: str, token: str | None) -> str:
    url = f"https://github.com/{repo}.git" if _OWNER_REPO.match(repo) else repo
    if token and url.startswith("https://"):
        url = url.replace("https://", f"https://{token}@", 1)
    return url


def fetch_repo(run_id: str, repo: str, branch: str | None = None,
               token: str | None = None, timeout: int = 120) -> dict | None:
    """Clone repo (shallow) into workspaces/<run_id>. Returns
    {path, commit, files, count} or None if `repo` is not a real repo ref.
    Raises subprocess.CalledProcessError / TimeoutExpired on clone failure."""
    if not is_git_url(repo):
        return None

    dest = WORKSPACES / run_id
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    args = ["git", "clone", "--depth", "1", "--single-branch"]
    if branch:
        args += ["--branch", branch]
    args += [_clone_url(repo, token), str(dest)]
    subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True)

    commit = subprocess.run(
        ["git", "-C", str(dest), "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()
    files = subprocess.run(
        ["git", "-C", str(dest), "ls-files"],
        capture_output=True, text=True,
    ).stdout.splitlines()

    return {"path": str(dest), "commit": commit, "files": files, "count": len(files)}


def read_file(workspace: str, rel_path: str, max_lines: int = 60) -> list[str]:
    """Read the first N lines of a file inside the workspace (for the diff view)."""
    p = Path(workspace) / rel_path
    try:
        return p.read_text(errors="replace").splitlines()[:max_lines]
    except Exception:
        return []
