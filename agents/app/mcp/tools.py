"""GateKeep MCP tool implementations — wraps existing WorkspaceTools, Docker
sandbox, and Node backend API into a session-scoped governance layer.

Every method takes a session_id to resolve the workspace and run context.
State-mutating operations are audit-logged through the backend."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

import httpx

from ..repository.context import build_context
from ..repository.tools import WorkspaceTools
from ..sandbox import SandboxRunner
from .policy import PolicyEngine
from .session import McpSession, SessionManager

# Absolute root for workspaces so paths resolve correctly regardless of cwd.
_WORKSPACES = Path(__file__).resolve().parent.parent.parent / "workspaces"


class GateKeepTools:
    """Wraps core GateKeep capabilities behind session-aware, audit-traced methods."""

    def __init__(self, session_manager: SessionManager, base_url: str | None = None):
        self.session_manager = session_manager
        self.policy = PolicyEngine()
        self.base_url = base_url or os.getenv("GATEKEEP_API", "http://localhost:4000")

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
        """Get `git diff HEAD` for the workspace."""
        session = self._get_session(session_id)
        workspace = self._workspace_path(session)

        if not os.path.isdir(os.path.join(workspace, ".git")):
            return ""

        try:
            proc = subprocess.run(
                ["git", "diff", "HEAD"],
                cwd=workspace,
                capture_output=True, text=True, timeout=15,
            )
            return proc.stdout
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

        # Store a summary artifact so the reviewer sees context
        self._backend_put(f"runs/{session.run_id}/artifacts", {"summary": summary})

        self._audit(session.run_id, "mcp.approval.requested", {"summary": summary[:500]})

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
