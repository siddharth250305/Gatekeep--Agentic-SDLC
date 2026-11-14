"""GateKeep MCP tool implementations — wraps existing WorkspaceTools, Docker
sandbox, and Node backend API into a session-scoped governance layer.

Every method takes a session_id to resolve the workspace and run context.
State-mutating operations are audit-logged through the backend."""

from __future__ import annotations

import logging
import os
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import httpx

from ..repository.context import build_context
from ..repository.tools import WorkspaceTools
from ..backend_auth import auth_headers
from ..diffing import diff_artifacts, workspace_diff
from ..fingerprint import tree_fingerprint
from ..sandbox import SandboxRunner
from ..workspace import WORKSPACES, validate_run_id
from .policy import PolicyEngine
from .session import McpSession, SessionManager


log = logging.getLogger("gatekeep.mcp")

# What a backend call can fail with: transport and HTTP status errors, or a
# body that is not valid JSON (json.JSONDecodeError is a ValueError).
BACKEND_ERRORS = (httpx.HTTPError, ValueError)
# What building a workspace diff can fail with: git timing out or missing.
DIFF_ERRORS = (subprocess.SubprocessError, OSError)


@contextmanager
def _undo_on_failure(target: Path) -> Iterator[None]:
    """Restore *target* to its previous bytes (or remove it) if the block raises.

    Used so a file change whose audit entry cannot be written is rolled back:
    nothing changes in the workspace without a record of it."""
    before = target.read_bytes() if target.is_file() else None
    try:
        yield
    except Exception:
        if before is None:
            target.unlink(missing_ok=True)
        else:
            target.write_bytes(before)
        raise


class GateKeepTools:
    """Wraps core GateKeep capabilities behind session-aware, audit-traced methods."""

    def __init__(self, session_manager: SessionManager, base_url: str | None = None):
        self.session_manager = session_manager
        self.policy = PolicyEngine()
        self.base_url = base_url or os.getenv("GATEKEEP_API", "http://localhost:4040")
        # One lock per run: a write, a test run and a review request on the
        # same workspace never interleave, so the fingerprint handed over at
        # "request review" is the code that was actually there (B6, B7).
        self._run_locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _run_lock(self, run_id: str) -> threading.Lock:
        with self._locks_guard:
            return self._run_locks.setdefault(run_id, threading.Lock())

    # ── helpers ──────────────────────────────────────────────────────────

    def _get_session(self, session_id: str) -> McpSession:
        """Get a session or raise an error if not found."""
        session = self.session_manager.get_session(session_id)
        if not session:
            raise ValueError(f"Invalid session_id: {session_id}")
        return session

    def _workspace_path(self, session: McpSession) -> str:
        """Resolve the absolute workspace directory for a session's run."""
        return str(WORKSPACES / validate_run_id(session.run_id))

    def _get_workspace_tools(self, session_id: str) -> WorkspaceTools:
        """Create a WorkspaceTools instance scoped to the session's run workspace."""
        session = self._get_session(session_id)
        return WorkspaceTools(self._workspace_path(session))

    def _backend_get(self, path: str) -> dict[str, Any] | list[Any]:
        """GET request to the Node backend. Collections (/runs, /audit) come
        back as lists, single resources as objects."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.get(url, headers=auth_headers(), timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _backend_get_object(self, path: str) -> dict[str, Any]:
        body = self._backend_get(path)
        if not isinstance(body, dict):
            raise ValueError(f"backend returned {type(body).__name__} for {path}, expected an object")
        return body

    def _backend_get_list(self, path: str) -> list[Any]:
        body = self._backend_get(path)
        if not isinstance(body, list):
            raise ValueError(f"backend returned {type(body).__name__} for {path}, expected a list")
        return body

    def _backend_post(self, path: str, json_data: dict[str, Any]) -> dict[str, Any]:
        """POST request to the Node backend."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.post(url, json=json_data, headers=auth_headers(), timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _backend_put(self, path: str, json_data: dict[str, Any]) -> dict[str, Any]:
        """PUT request to the Node backend."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.put(url, json=json_data, headers=auth_headers(), timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _backend_patch(self, path: str, json_data: dict[str, Any]) -> dict[str, Any]:
        """PATCH request to the Node backend."""
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        resp = httpx.patch(url, json=json_data, headers=auth_headers(), timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def _robot_action(self, run_id: str, action: str, body: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        """Ask the backend state machine to make a robot move.

        Returns (True, run) when the move happened (or had already happened),
        or (False, {"error", "step"}) when the backend refused it. The backend
        decides; this side never writes phase state or run status (B1)."""
        url = f"{self.base_url.rstrip('/')}/runs/{run_id}/actions/{action}"
        resp = httpx.post(url, json=body, headers=auth_headers(), timeout=30.0)
        if resp.status_code in (400, 403, 404, 409):
            try:
                refusal = resp.json()
            except ValueError:
                refusal = {}
            return False, {"error": refusal.get("error") or f"refused ({resp.status_code})", "step": refusal.get("step")}
        resp.raise_for_status()
        return True, resp.json()

    def _audit(self, run_id: str, event: str, payload: dict[str, Any] | None = None,
               required: bool = False) -> None:
        """Append an audit event through the backend.

        With required=True a failure raises, so the caller can undo the action
        it is recording. Otherwise failures are logged and ignored."""
        try:
            # The backend stamps the actor (this agent's token) and the time.
            self._backend_post(f"runs/{run_id}/audit", {
                "event": event,
                "payload": payload or {},
            })
        except BACKEND_ERRORS as exc:
            if required:
                raise RuntimeError(f"audit log unavailable, action was not applied: {exc}") from exc
            log.warning("audit warning: %s", exc)

    # ── run / context ────────────────────────────────────────────────────

    def list_runs(self) -> list[dict[str, Any]]:
        """List all active and recent runs in GateKeep."""
        runs = self._backend_get_list("runs")
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
            if isinstance(r, dict)
        ]

    def get_run(self, session_id: str) -> dict[str, Any]:
        """Get the full run object from the Node backend."""
        session = self._get_session(session_id)
        return self._backend_get_object(f"runs/{session.run_id}")

    def get_agent_context(self, session_id: str) -> dict[str, Any]:
        """Return a structured context packet for the external LLM.

        Includes current phase, repository info, approved requirements/design,
        active restrictions, and previous test failures if any.
        """
        run = self.get_run(session_id)

        active_phase = self.policy.current_phase(run)
        if active_phase is None:
            # Finished or rejected: nothing is allowed.
            phase_perms = {"allowed_tools": [], "denied_tools": sorted(self.policy.TOOL_PERMISSIONS)}
        else:
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
                "run_tests always runs the whole suite; existing tests must keep running",
                "Gate 3 can only approve the exact code of a passing test run",
                "After request_approval the workspace is frozen until a reviewer decides",
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
        """Hand the requirements to the backend, which opens Gate 1 if the run
        is at Requirements. They are stored only if that move is allowed."""
        session = self._get_session(session_id)
        ok, body = self._robot_action(session.run_id, "submit_requirements",
                                      {"artifacts": {"requirements": requirements}})
        if not ok:
            return {"submitted": False, **body}
        return {"submitted": True, "step": body.get("step"), "awaiting": "Gate 1 — Planner review"}

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
        """Hand the design to the backend, which opens Gate 2 if the run is at
        Design. It is stored only if that move is allowed."""
        session = self._get_session(session_id)
        ok, body = self._robot_action(session.run_id, "submit_design", {"artifacts": {"design": design}})
        if not ok:
            return {"submitted": False, **body}
        return {"submitted": True, "step": body.get("step"), "awaiting": "Gate 2 — Engineer review"}

    # ── coding ───────────────────────────────────────────────────────────

    def _frozen_refusal(self, session: McpSession, wt: WorkspaceTools, tool: str, path: str) -> dict[str, Any] | None:
        """B6: while a review is pending the workspace is frozen. The freeze
        lifts only when the backend says the run is back at Code (Gate 3 sent
        the work back); any other answer, or no answer, keeps it frozen."""
        if not wt.is_frozen():
            return None
        run = self.get_run(session.session_id)
        if self.policy.current_phase(run) == "code":
            wt.thaw()
            return None
        denial = {
            "error": "The workspace is frozen: the code was handed over for review at Gate 3. "
                     "No file can change unless the reviewer sends the work back.",
            "frozen": True, "path": path, "tool": tool,
        }
        self._audit(session.run_id, "mcp.policy.denied", denial)
        return denial

    def apply_patch(self, session_id: str, path: str, find: str, replace: str) -> dict[str, Any]:
        """Apply a surgical code edit in the workspace (find → replace)."""
        session = self._get_session(session_id)
        wt = self._get_workspace_tools(session_id)
        with self._run_lock(session.run_id):
            refusal = self._frozen_refusal(session, wt, "apply_patch", path)
            if refusal:
                return refusal
            with _undo_on_failure(wt._safe(path)):
                result = wt.apply_patch(path, find, replace)
                self._audit(session.run_id, "mcp.file.patched",
                            {"path": path, "applied": result.get("applied")}, required=True)
        return result

    def write_file(self, session_id: str, path: str, content: str) -> dict[str, Any]:
        """Write or overwrite a file in the workspace."""
        session = self._get_session(session_id)
        wt = self._get_workspace_tools(session_id)
        with self._run_lock(session.run_id):
            refusal = self._frozen_refusal(session, wt, "write_file", path)
            if refusal:
                return refusal
            with _undo_on_failure(wt._safe(path)):
                result = wt.write_file(path, content)
                self._audit(session.run_id, "mcp.file.written",
                            {"path": path, "bytes": result.get("bytes")}, required=True)
        return result

    def get_diff(self, session_id: str) -> str:
        """Get `git diff HEAD` for the workspace, including new untracked files."""
        session = self._get_session(session_id)
        try:
            return workspace_diff(self._workspace_path(session))
        except DIFF_ERRORS as exc:
            log.warning("diff warning: %s", exc)
            return ""

    # ── testing ──────────────────────────────────────────────────────────

    def run_tests(self, session_id: str, target: str | None = None) -> dict[str, Any]:
        """Run the project's whole test suite in the Docker sandbox and record
        the result as a test run bound to the code fingerprint (C2, C3, B7).

        *target* is accepted for older clients but never narrows the run: the
        existing tests always run alongside the robot's new ones."""
        session = self._get_session(session_id)
        workspace = self._workspace_path(session)

        with self._run_lock(session.run_id):
            fingerprint = tree_fingerprint(workspace)
            result = SandboxRunner().run_path(workspace)

        test_run_id = None
        try:
            recorded = self._backend_post(f"runs/{session.run_id}/test-runs", {
                "fingerprint": fingerprint,
                "status": result["status"],
                "passed": result["passed"],
                "failed": result["failed"],
                "skipped": result.get("skipped", 0),
                "total": result["total"],
                "duration_ms": result["duration_ms"],
                "output": result["output"][:8000],
                "cases": result.get("cases", [])[:2000],
                "missing_existing": result.get("missing_existing", []),
            })
            test_run_id = recorded.get("id")
        except BACKEND_ERRORS as exc:
            log.warning("test report warning: %s", exc)

        self._audit(session.run_id, "mcp.tests.run", {
            "test_run": test_run_id,
            "fingerprint": fingerprint,
            "status": result["status"],
            "exit_code": result["exit_code"],
            "passed": result["passed"],
            "failed": result["failed"],
        })

        out = {**result, "test_run_id": test_run_id, "fingerprint": fingerprint}
        if target:
            out["note"] = (f"GateKeep always runs the whole test suite; the target {target!r} "
                           "did not narrow the run.")
        return out

    def get_test_results(self, session_id: str) -> dict[str, Any]:
        """Get the latest test results from the run."""
        run = self.get_run(session_id)
        return {
            "tests": run.get("tests"),
            "sandbox": run.get("sandbox"),
        }

    # ── approval ─────────────────────────────────────────────────────────

    def request_approval(self, session_id: str, summary: str) -> dict[str, Any]:
        """Ask for code review: the backend moves the run from Code to Gate 3
        (B3) and stores the summary and the full diff with that move.

        The workspace is frozen first and the code fingerprint goes with the
        move (B6, B7). If the backend refuses, the freeze is lifted again."""
        session = self._get_session(session_id)
        run = self.get_run(session_id)

        if run.get("status") == "awaiting_gate":
            return {"already_awaiting": True, "gate": run.get("gate")}

        workspace = self._workspace_path(session)
        wt = WorkspaceTools(workspace)
        with self._run_lock(session.run_id):
            fingerprint = tree_fingerprint(workspace)
            wt.freeze(fingerprint)
            try:
                result = self._hand_over(session, run, workspace, summary, fingerprint)
            except Exception:
                # The move may have gone through even though no answer came
                # back: lift the freeze only if the run is certainly not at Gate 3.
                self._thaw_unless_in_review(session, wt)
                raise
            if not result.get("requested"):
                wt.thaw()
        return result

    def _thaw_unless_in_review(self, session: McpSession, wt: WorkspaceTools) -> None:
        try:
            run = self.get_run(session.session_id)
        except BACKEND_ERRORS:
            return  # unknown: stay frozen (fail closed); a later write asks again
        if self.policy.current_phase(run) == "code":
            wt.thaw()

    def _hand_over(self, session: McpSession, run: dict[str, Any], workspace: str,
                   summary: str, fingerprint: str) -> dict[str, Any]:
        # The summary and the full diff go with the move, so the reviewer sees the actual changes.
        try:
            files, diff = diff_artifacts(workspace_diff(workspace))
        except DIFF_ERRORS as exc:
            log.warning("diff warning: %s", exc)
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

        ok, body = self._robot_action(session.run_id, "request_review", {
            "artifacts": artifacts,
            "fingerprint": fingerprint,
            "details": {"summary": summary[:500], "files": [f["path"] for f in files]},
        })
        if not ok:
            return {"requested": False, **body}
        return {
            "requested": True,
            "step": body.get("step"),
            "status": body.get("status"),
            "gate": body.get("gate"),
            "fingerprint": fingerprint,
            "message": "Gate 3: a human Engineer has been asked to review the code on the dashboard. "
                       "The workspace is frozen until they decide.",
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
        return self._backend_get_list(f"runs/{session.run_id}/audit")

    def report_model(self, session_id: str, model: str) -> dict[str, Any]:
        """Update the active session's model identifier on the backend."""
        session = self._get_session(session_id)
        session.model = model
        try:
            self._backend_patch(f"mcp/sessions/{session.session_id}", {"model": model})
        except BACKEND_ERRORS as exc:
            log.warning("report_model warning: %s", exc)
        return {"updated": True, "model": model}
