"""Turn a finished run into a GitHub Pull Request (I6).

The backend builds the signed evidence bundle and the PR description; this
service holds the workspace and the GitHub token, so it does the git work:

1. refuse unless the workspace is still exactly the approved code (the
   fingerprint Gate 3 approved, from the bundle),
2. commit it on ``gatekeep/<run>`` with the bundle in
   ``.gatekeep/evidence/<run>.json``, and check the commit holds exactly the
   approved code (an ignored file would silently drop out otherwise),
3. push the branch and open the PR through the GitHub API.

Every refusal is a PullRequestError with a short code. The token never goes
on a command line, in a URL, or in an error message.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import httpx

from .fingerprint import digest_entries, skipped, tree_fingerprint
from .workspace import _git_env, validate_run_id

FINGERPRINT = re.compile(r"^[0-9a-f]{64}$")
_SLUG = re.compile(r"^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?$")
# Workspaces hold untrusted repo content: git must never run programs the
# repo names (hooks, fsmonitor), same as diffing.py.
_GIT_SAFE = ("-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null")


class PullRequestError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def github_slug(repo: str | None) -> str | None:
    """owner/repo for a GitHub repository reference, else None."""
    if not repo:
        return None
    for prefix in ("https://github.com/", "git@github.com:"):
        if repo.startswith(prefix):
            repo = repo[len(prefix):].rstrip("/")
            break
    else:
        if "://" in repo or repo.startswith(("/", ".", "~")):
            return None
    m = _SLUG.match(repo)
    if not m or {m.group(1), m.group(2)} & {".", ".."}:
        return None
    return f"{m.group(1)}/{m.group(2)}"


def _git(ws: Path, *args: str, env: dict[str, str] | None = None, timeout: int = 120) -> str:
    proc = subprocess.run(["git", *_GIT_SAFE, "-C", str(ws), *args], capture_output=True, text=True,
                          timeout=timeout, env=env)
    if proc.returncode != 0:
        command = next((a for a in args if not a.startswith("-") and "=" not in a), "git")
        raise subprocess.CalledProcessError(proc.returncode, command, proc.stdout, proc.stderr)
    return proc.stdout


def commit_fingerprint(ws: Path, rev: str = "HEAD") -> str:
    """The fingerprint of the code in a commit, computed exactly like
    tree_fingerprint() of a folder holding it (B7)."""
    listing = subprocess.run(["git", *_GIT_SAFE, "-C", str(ws), "ls-tree", "-r", "-z", rev],
                             capture_output=True, check=True, timeout=120).stdout
    entries: list[tuple[str, str, bytes]] = []
    for item in filter(None, listing.split(b"\0")):
        meta, path_bytes = item.split(b"\t", 1)
        mode, kind, sha = meta.decode().split()
        path = path_bytes.decode("utf-8", "surrogateescape")
        if kind != "blob" or skipped(path):
            continue
        data = subprocess.run(["git", *_GIT_SAFE, "-C", str(ws), "cat-file", "blob", sha],
                              capture_output=True, check=True, timeout=120).stdout
        entries.append((path, "L" if mode == "120000" else "F", data))
    return digest_entries(entries)


def _redact(text: str, token: str) -> str:
    return text.replace(token, "***") if token else text


def create_pull_request(*, workspace: str, run_id: str, repo: str, base: str | None, title: str, body: str,
                        evidence: dict[str, Any], token: str, api_url: str | None = None,
                        transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Push the approved code with its evidence and open the PR. Returns
    {"url", "number", "branch"}; raises PullRequestError."""
    slug = github_slug(repo)
    if not slug:
        raise PullRequestError("no_github_repo", "this run's repository is not a GitHub repository, so no PR can be opened")
    if not token:
        raise PullRequestError("no_token", "GIT_TOKEN is not set on the agent service")
    validate_run_id(run_id)
    ws = Path(workspace)
    if not (ws / ".git").is_dir():
        raise PullRequestError("no_workspace", f"the workspace of {run_id} is not there")
    approved = ((evidence or {}).get("code") or {}).get("fingerprint")
    if not isinstance(approved, str) or not FINGERPRINT.match(approved):
        raise PullRequestError("bad_evidence", "the evidence names no approved code fingerprint")
    if tree_fingerprint(str(ws)) != approved:
        raise PullRequestError("code_changed", "the code in the workspace is no longer the code Gate 3 approved")

    branch = f"gatekeep/{run_id}"
    evidence_rel = f".gatekeep/evidence/{run_id}.json"
    # The repository is untrusted: a shortcut on the evidence path would send
    # the write somewhere else (ECC review).
    for rel in (".gatekeep", ".gatekeep/evidence", evidence_rel):
        if (ws / rel).is_symlink():
            raise PullRequestError("unsafe_evidence_path", f"{rel} is a shortcut in the repository; no PR was opened")
    try:
        start = _git(ws, "rev-parse", "--abbrev-ref", "HEAD").strip()
        start_commit = _git(ws, "rev-parse", "HEAD").strip()
        base = base or _default_branch(ws) or "main"
        _git(ws, "checkout", "-q", "-B", branch)
        target = ws / evidence_rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        _git(ws, "add", "-A")
        _git(ws, "-c", "user.name=GateKeep", "-c", "user.email=gatekeep@localhost", "commit", "-q", "--allow-empty",
             "-m", f"{title}\n\nApproved through GateKeep. Signed evidence: {evidence_rel}")
        if commit_fingerprint(ws) != approved:
            _undo(ws, start, branch, target)
            raise PullRequestError("commit_mismatch", "the commit would not hold exactly the approved code "
                                   "(an ignored or unreadable file is part of it); no PR was opened")
        # Anything the fingerprint leaves out (pytest caches, ...) was never
        # reviewed: only the evidence file may be new there (ECC review).
        changed = _git(ws, "diff", "--name-only", "-z", start_commit, "HEAD").split("\0")
        hidden = sorted(p for p in changed if p and p != evidence_rel and skipped(p))
        if hidden:
            _undo(ws, start, branch, target)
            raise PullRequestError("hidden_files", f"files the review never saw would be committed: {hidden[:5]}; "
                                   "no PR was opened")
        remote = _git(ws, "remote", "get-url", "origin").strip()
        _git(ws, "push", "-q", "origin", f"HEAD:refs/heads/{branch}", env=_git_env(remote, token))
    except subprocess.CalledProcessError as exc:
        raise PullRequestError("push_failed", _redact(f"git {exc.cmd} failed: {(exc.stderr or '').strip()}"[:400], token)) from None
    except subprocess.TimeoutExpired:
        raise PullRequestError("push_failed", "git timed out") from None

    api = (api_url or os.getenv("GATEKEEP_GITHUB_API") or "https://api.github.com").rstrip("/")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    try:
        with httpx.Client(transport=transport, timeout=30.0) as client:
            resp = client.post(f"{api}/repos/{slug}/pulls", headers=headers,
                               json={"title": title, "head": branch, "base": base, "body": body})
    except httpx.HTTPError as exc:
        raise PullRequestError("github_unreachable", _redact(f"GitHub could not be reached: {exc}", token)) from None
    if resp.status_code == 422 and "already exists" in resp.text:
        # The PR was opened before (an earlier answer was lost): return it.
        existing = _existing_pr(api, slug, branch, headers, transport)
        if existing:
            return existing
    if not 200 <= resp.status_code < 300:
        try:
            message = resp.json().get("message", "")
        except ValueError:
            message = ""
        raise PullRequestError("github_refused", _redact(f"GitHub refused the PR ({resp.status_code}): {message}"[:400], token))
    out = resp.json()
    return {"url": out.get("html_url"), "number": out.get("number"), "branch": branch}


def _existing_pr(api: str, slug: str, branch: str, headers: dict[str, str],
                 transport: httpx.BaseTransport | None) -> dict[str, Any] | None:
    owner = slug.split("/", 1)[0]
    try:
        with httpx.Client(transport=transport, timeout=30.0) as client:
            resp = client.get(f"{api}/repos/{slug}/pulls", headers=headers,
                              params={"head": f"{owner}:{branch}", "state": "open"})
        found = resp.json() if resp.status_code == 200 else []
    except (httpx.HTTPError, ValueError):
        return None
    if isinstance(found, list) and found and isinstance(found[0], dict):
        return {"url": found[0].get("html_url"), "number": found[0].get("number"), "branch": branch}
    return None


def _default_branch(ws: Path) -> str | None:
    try:
        ref = _git(ws, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").strip()
    except subprocess.CalledProcessError:
        return None
    return ref.removeprefix("origin/") or None


def _undo(ws: Path, start: str, branch: str, evidence: Path) -> None:
    """Best effort: leave the workspace as it was before (same files, old branch)."""
    try:
        _git(ws, "reset", "-q", "--soft", "HEAD~1")
        _git(ws, "reset", "-q")
        evidence.unlink(missing_ok=True)
        if start and start != "HEAD":
            _git(ws, "checkout", "-q", start)
            _git(ws, "branch", "-q", "-D", branch)
    except (subprocess.CalledProcessError, OSError):
        pass
