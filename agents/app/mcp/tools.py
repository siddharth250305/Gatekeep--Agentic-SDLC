"""GateKeep MCP tool implementations — wraps existing WorkspaceTools, Docker
sandbox, and Node backend API into a session-scoped governance layer.

Every method takes a session_id to resolve the workspace and run context.
State-mutating operations are audit-logged through the backend."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

import httpx

from ..repository.context import build_context
from ..repository.security import is_sensitive_path
from ..repository.tools import WorkspaceTools
from ..sandbox import SandboxRunner
from .policy import PolicyEngine
from .session import McpSession, SessionManager

# Absolute root for workspaces so paths resolve correctly regardless of cwd.
_WORKSPACES = Path(__file__).resolve().parent.parent.parent / "workspaces"

# Build output that never belongs in a review diff.
_DIFF_SKIP = ("__pycache__/", ".pytest_cache/")
# Per-file cap on diff lines sent to the dashboard.
_MAX_DIFF_LINES = 3000


def workspace_diff(workspace: str) -> str:
    """`git diff HEAD` plus every new untracked file, so reviewers see all changes."""
    if not os.path.isdir(os.path.join(workspace, ".git")):
        return ""

    def git(*args: str) -> str:
        proc = subprocess.run(["git", *args], cwd=workspace, capture_output=True, text=True, timeout=15)
        return proc.stdout

    parts = [git("diff", "HEAD")]
    untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0")
    for path in sorted(p for p in untracked if p):
        if any(skip in path for skip in _DIFF_SKIP) or is_sensitive_path(path):
            continue
        # --no-index exits 1 when the files differ, which is always the case here.
        parts.append(git("diff", "--no-index", "--", "/dev/null", path))
    return "".join(parts)


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


class GateKeepTools:
    """Wraps core GateKeep capabilities behind session-aware, audit-traced methods."""

    def __init__(self, session_manager: SessionManager, base_url: str | None = None):
        self.session_manager = session_manager
        self.policy = PolicyEngine()
        self.base_url = base_url or os.getenv("GATEKEEP_API", "http://localhost:4040")

    # ── helpers ──────────────────────────────────────────────────────────

    def _get_session(self, session_id: str) -> McpSession:
        """Get a session or raise an error if not found."""
        session = self.session_manager.get_session(session_id)
        if not session:
            raise ValueError(f"Invalid session_id: {session_id}")
        return session

    def _workspace_path(self, session: McpSession) -> str:
        """Resolve the absolute workspace directory for a session's run."""
        return str(_WORKSPACES / session.run_id)

    def _get_workspace_tools(self, session_id: str) -> WorkspaceTools:
        """Create a WorkspaceTools instance scoped to the session's run workspace."""
        session = self._get_session(session_id)
        return WorkspaceTools(self._workspace_path(session))

    def _backend_get(self, path: str) -> dict[str, Any]:
        """GET request to the Node backend."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.get(url, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _backend_post(self, path: str, json_data: dict[str, Any]) -> dict[str, Any]:
        """POST request to the Node backend."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.post(url, json=json_data, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _backend_put(self, path: str, json_data: dict[str, Any]) -> dict[str, Any]:
        """PUT request to the Node backend."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.put(url, json=json_data, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _backend_patch(self, path: str, json_data: dict[str, Any]) -> dict[str, Any]:
        """PATCH request to the Node backend."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.patch(url, json=json_data, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _audit(self, run_id: str, event: str, payload: dict[str, Any] | None = None) -> None:
        """Append an audit event through the backend. Non-fatal on failure."""
        try:
            self._backend_post(f"runs/{run_id}/audit", {
                "event": event,
                "actor": "mcp-server",
                "payload": payload or {},
            })
        except Exception as exc:
            print(f"[mcp] audit warning: {exc}")

    # ── run / context ────────────────────────────────────────────────────

    def list_runs(self) -> list[dict[str, Any]]:
        """List all active and recent runs in GateKeep."""
        runs = self._backend_get("runs")
        return [
            {
                "id": r.get("id"),
                "brief": r.get("brief"),
                "repo": r.get("repo"),
                "status": r.get("status"),
                "gate": r.get("gate"),
                "awaiting": r.get("awaiting"),
            }
            for r in runs
        ]

    def get_run(self, session_id: str) -> dict[str, Any]:
        """Get the full run object from the Node backend."""
        session = self._get_session(session_id)
        return self._backend_get(f"runs/{session.run_id}")

    def get_agent_context(self, session_id: str) -> dict[str, Any]:
        """Return a structured context packet for the external LLM.

        Includes current phase, repository info, approved requirements/design,
        active restrictions, and previous test failures if any.
        """
        run = self.get_run(session_id)

        # Determine active phase from the steps list
        active_phase = "req"
        for step in run.get("steps", []):
            if step.get("state") == "active":
                active_phase = step.get("key", "req")
                break

        phase_perms = self.policy.get_phase_permissions(active_phase)

        return {
            "run_id": run.get("id"),
            "status": run.get("status"),
            "current_phase": active_phase,
            "gate": run.get("gate"),
            "brief": run.get("brief"),
            "repo": run.get("repo"),
            "branch": run.get("branch"),
            "commit": run.get("commit"),
            "requirements": run.get("requirements"),
            "design": run.get("design"),
            "tests": run.get("tests"),
            "allowed_tools": phase_perms["allowed_tools"],
            "denied_tools": phase_perms["denied_tools"],
            "restrictions": [
                "Do not modify .env or secret files",
                "All code changes must go through apply_patch or write_file",
                "Tests must pass in Docker sandbox before approval",
                "Human approval is required at every gate",
            ],
        }

    def get_repository_context(self, session_id: str) -> dict[str, Any]:
        """Build rich repository context (manifest, relevant files) for a run."""
        session = self._get_session(session_id)
        run = self.get_run(session_id)
        workspace = self._workspace_path(session)

        if not os.path.isdir(workspace):
            return {"error": f"Workspace not found: {session.run_id}. Start the pipeline first."}

        return build_context(
            workspace=workspace,
            feature_request=run.get("brief", ""),
            repository_url=run.get("repo", ""),
            commit_sha=run.get("commit", ""),
        )

    # ── repository tools ─────────────────────────────────────────────────

    def list_files(self, session_id: str) -> list[str]:
        """List all tracked source files in the workspace."""
        return self._get_workspace_tools(session_id).list_files()

    def read_file(self, session_id: str, path: str) -> str:
        """Read a file from the workspace (secret-scrubbed, size-capped)."""
        return self._get_workspace_tools(session_id).read_file(path)

    def search_code(self, session_id: str, query: str) -> list[dict[str, Any]]:
        """Case-insensitive substring search across workspace files."""
        return self._get_workspace_tools(session_id).search_code(query)

    # ── requirements ─────────────────────────────────────────────────────

    def get_requirements_context(self, session_id: str) -> dict[str, Any]:
        """Get the current requirements artifact from the run."""
        run = self.get_run(session_id)
        return {
            "requirements": run.get("requirements"),
            "status": run.get("status"),
            "phase": next(
                (s["key"] for s in run.get("steps", []) if s.get("state") == "active"),
                "unknown",
            ),
        }

    def submit_requirements(self, session_id: str, requirements: str) -> dict[str, Any]:
        """Submit requirements for human review, opening Gate 1."""
        session = self._get_session(session_id)
        run_id = session.run_id

        # Store the requirements artifact
        self._backend_put(f"runs/{run_id}/artifacts", {"requirements": requirements})

        # Advance phase: mark req as complete, g1 as active (awaiting review)
        self._backend_put(f"runs/{run_id}/phases/req", {
            "state": "approved", "status": "Complete",
            "at": self._now_label(),
        })
        self._backend_put(f"runs/{run_id}/phases/g1", {
            "state": "active", "status": "Ready for review",
        })
        self._backend_patch(f"runs/{run_id}", {
            "status": "awaiting_gate", "gate": "Planner",
        })

        self._audit(run_id, "mcp.requirements.submitted", {"source": "external-agent"})

        return {"submitted": True, "awaiting": "Gate 1 — Planner review"}

    # ── design ───────────────────────────────────────────────────────────

    def get_design_context(self, session_id: str) -> dict[str, Any]:
        """Get the current design artifact from the run."""
        run = self.get_run(session_id)
        return {
            "design": run.get("design"),
            "requirements": run.get("requirements"),
            "status": run.get("status"),
        }

    def submit_design(self, session_id: str, design: str) -> dict[str, Any]:
        """Submit design for human review, opening Gate 2."""
        session = self._get_session(session_id)
        run_id = session.run_id

        # Store the design artifact (as JSON for structured content)
        self._backend_put(f"runs/{run_id}/artifacts", {"design": design})

        # Advance phase: mark design as complete, g2 as active
        self._backend_put(f"runs/{run_id}/phases/design", {
            "state": "approved", "status": "Complete",
            "at": self._now_label(),
        })
        self._backend_put(f"runs/{run_id}/phases/g2", {
            "state": "active", "status": "Ready for review",
        })
        self._backend_patch(f"runs/{run_id}", {
            "status": "awaiting_gate", "gate": "Engineer",
        })

        self._audit(run_id, "mcp.design.submitted", {"source": "external-agent"})

        return {"submitted": True, "awaiting": "Gate 2 — Engineer review"}

    # ── coding ───────────────────────────────────────────────────────────

    def apply_patch(self, session_id: str, path: str, find: str, replace: str) -> dict[str, Any]:
        """Apply a surgical code edit in the workspace (find → replace)."""
        session = self._get_session(session_id)
        result = self._get_workspace_tools(session_id).apply_patch(path, find, replace)
        self._audit(session.run_id, "mcp.file.patched", {"path": path, "applied": result.get("applied")})
        return result

    def write_file(self, session_id: str, path: str, content: str) -> dict[str, Any]:
        """Write or overwrite a file in the workspace."""
        session = self._get_session(session_id)
        result = self._get_workspace_tools(session_id).write_file(path, content)
        self._audit(session.run_id, "mcp.file.written", {"path": path, "bytes": result.get("bytes")})
        return result

    def get_diff(self, session_id: str) -> str:
        """Get `git diff HEAD` for the workspace, including new untracked files."""
        session = self._get_session(session_id)
        try:
            return workspace_diff(self._workspace_path(session))
        except Exception:
            return ""

    # ── testing ──────────────────────────────────────────────────────────

    def run_tests(self, session_id: str, target: str | None = None) -> dict[str, Any]:
        """Execute tests in the Docker sandbox and report results to the backend."""
        session = self._get_session(session_id)
        workspace = self._workspace_path(session)

        runner = SandboxRunner()
        result = runner.run_path(workspace, target)

        # Report to backend
        try:
            self._backend_put(f"runs/{session.run_id}/tests", {
                "status": "Passed" if result["failed"] == 0 else "Failed",
                "passed": result["passed"],
                "failed": result["failed"],
                "total": result["total"],
                "iterations": 1,
                "duration_ms": result["duration_ms"],
                "output": result["output"][:8000],
            })
        except Exception as exc:
            print(f"[mcp] test report warning: {exc}")

        self._audit(session.run_id, "mcp.tests.run", {
            "target": target,
            "passed": result["passed"],
            "failed": result["failed"],
        })

        return result

    def get_test_results(self, session_id: str) -> dict[str, Any]:
        """Get the latest test results from the run."""
        run = self.get_run(session_id)
        return {
            "tests": run.get("tests"),
            "sandbox": run.get("sandbox"),
        }

    # ── approval ─────────────────────────────────────────────────────────

    def request_approval(self, session_id: str, summary: str) -> dict[str, Any]:
        """Signal the dashboard that the external agent is ready for human review."""
        session = self._get_session(session_id)
        run = self.get_run(session_id)

        if run.get("status") == "awaiting_gate":
            return {"already_awaiting": True, "gate": run.get("gate")}

        # Store the summary and the full diff so the reviewer sees the actual changes.
        try:
            files, diff = diff_artifacts(workspace_diff(self._workspace_path(session)))
        except Exception as exc:
            print(f"[mcp] diff warning: {exc}")
            files, diff = [], None
        tests = run.get("tests") or {}
        checks = [f"{len(files)} file(s) changed: +{sum(f['add'] for f in files)} / -{sum(f['rem'] for f in files)}"]
        if tests.get("total"):
            checks.append(f"{tests.get('passed', 0)}/{tests['total']} tests passed in the sandbox")
        artifacts: dict[str, Any] = {
            "summary": {
                "headline": "Ready for your review",
                "sub": summary.strip().split("\n\n", 1)[0][:400],
                "checks": checks,
                "details": summary,
            },
        }
        if diff is not None:
            artifacts["files"] = files
            artifacts["diff"] = diff
        self._backend_put(f"runs/{session.run_id}/artifacts", artifacts)

        self._audit(session.run_id, "mcp.approval.requested", {
            "summary": summary[:500],
            "files": [f["path"] for f in files],
        })

        return {
            "requested": True,
            "status": run.get("status"),
            "gate": run.get("gate"),
            "message": "Human reviewer has been notified via the dashboard.",
        }

    def get_approval_status(self, session_id: str) -> dict[str, Any]:
        """Check current approval status and gate assignment."""
        run = self.get_run(session_id)
        return {
            "status": run.get("status"),
            "awaiting": run.get("awaiting"),
            "gate": run.get("gate"),
            "steps": [
                {"key": s["key"], "state": s["state"], "status": s["status"]}
                for s in run.get("steps", [])
            ],
        }

    # ── audit ────────────────────────────────────────────────────────────

    def get_audit_log(self, session_id: str) -> list[dict[str, Any]]:
        """Get the full cryptographic audit chain for the run."""
        session = self._get_session(session_id)
        return self._backend_get(f"runs/{session.run_id}/audit")

    def report_model(self, session_id: str, model: str) -> dict[str, Any]:
        """Update the active session's model identifier on the backend."""
        session = self._get_session(session_id)
        session.model = model
        try:
            self._backend_patch(f"mcp/sessions/{session.session_id}", {"model": model})
        except Exception as exc:
            print(f"[mcp] report_model warning: {exc}")
        return {"updated": True, "model": model}

    # ── private helpers ──────────────────────────────────────────────────

    @staticmethod
    def _now_label() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).strftime("%b %d, %H:%M") + " UTC"
