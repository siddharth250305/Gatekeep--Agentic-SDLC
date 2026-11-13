"""Fetch a real git repo into a per-run workspace so the pipeline operates on
actual code, not canned samples.

Public repos need no auth. For private repos, set GIT_TOKEN (a GitHub PAT) in
the agent's environment. It is handed to git as a one-off config value through
the environment, so it never appears in the process arguments, in error
messages, or in the workspace's .git/config (which the agent could read).
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
from pathlib import Path

WORKSPACES = Path(__file__).resolve().parent.parent / "workspaces"

_OWNER_REPO = re.compile(r"^[\w.-]+/[\w.-]+$")
# Run ids become directory names under WORKSPACES, so they must never contain
# path separators or dot segments.
_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def validate_run_id(run_id: str) -> str:
    """Return run_id unchanged, or raise ValueError if it is unsafe as a directory name."""
    if not isinstance(run_id, str) or not _RUN_ID.match(run_id):
        raise ValueError(f"Invalid run id {run_id!r}: use letters, digits, '-' or '_' (max 64)")
    return run_id


def is_git_url(repo: str | None) -> bool:
    """True for a real repo reference (URL or owner/repo), not a plain label."""
    if not repo:
        return False
    if repo.startswith(("https://", "git@", "file://")) or _OWNER_REPO.match(repo):
        return True
    # a local git repo path (useful for dev + offline tests)
    return os.path.isdir(os.path.join(repo, ".git"))


def _clone_url(repo: str) -> str:
    return f"https://github.com/{repo}.git" if _OWNER_REPO.match(repo) else repo


def _git_env(url: str, token: str | None) -> dict[str, str]:
    """Environment for git clone. The token is only ever sent to github.com."""
    env = dict(os.environ)
    if token and url.startswith("https://github.com/"):
        basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        env.update({
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.extraHeader",
            "GIT_CONFIG_VALUE_0": f"Authorization: Basic {basic}",
        })
    return env


def fetch_repo(run_id: str, repo: str, branch: str | None = None,
               token: str | None = None, timeout: int = 120) -> dict | None:
    """Clone repo (shallow) into workspaces/<run_id>. Returns
    {path, commit, files, count} or None if `repo` is not a real repo ref.
    Raises subprocess.CalledProcessError / TimeoutExpired on clone failure."""
    if not is_git_url(repo):
        return None

    dest = WORKSPACES / validate_run_id(run_id)
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    args = ["git", "clone", "--depth", "1", "--single-branch"]
    if branch:
        args += ["--branch", branch]
    url = _clone_url(repo)
    args += [url, str(dest)]
    subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True,
                   env=_git_env(url, token))

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
