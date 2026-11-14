"""Phase-aware policy engine for the GateKeep MCP server.

Every tool call, from an MCP client or from the built-in pipeline, passes
through this engine (GateKeepTools.call) before execution.
It enforces:
  1. Tool → phase restrictions (e.g., coding tools only in 'code' phase)
  2. File path restrictions (same globs as repository/security.py)

Moving a run between steps is not decided here: only the backend state
machine (backend/src/runs/machine.js) does that.

The engine is stateless — it receives the current phase and tool name, and
returns a PolicyResult with allowed/denied + reason.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ..repository.security import SENSITIVE_DIRS, SENSITIVE_GLOBS, is_sensitive_path


@dataclass
class PolicyResult:
    """Outcome of a policy check."""
    allowed: bool
    reason: str


class PolicyEngine:
    """GateKeep MCP policy enforcement."""

    # The steps where something can act, in order (backend runs/machine.js).
    # 'done' and 'cancelled' are final: no tool runs there.
    VALID_PHASES = ["req", "g1", "design", "g2", "code", "g3"]

    # The one shared list lives in repository/security.py.
    BLOCKED_FILE_PATTERNS = SENSITIVE_GLOBS
    BLOCKED_DIRECTORIES = sorted(SENSITIVE_DIRS)

    # Which phases each tool is allowed in.  "ALL" means every phase.
    _ALL = VALID_PHASES

    TOOL_PERMISSIONS: dict[str, list[str]] = {
        # ── always-allowed (read-only or informational) ──
        "get_run":                _ALL,
        "get_agent_context":      _ALL,
        "get_repository_context": _ALL,
        "list_files":             _ALL,
        "read_file":              _ALL,
        "search_code":            _ALL,
        "get_approval_status":    _ALL,
        "get_audit_log":          _ALL,
        "report_model":           _ALL,
        "list_runs":              _ALL,

        # ── requirements phase only ──
        "get_requirements_context": ["req"],
        "submit_requirements":      ["req"],

        # ── design phase only ──
        "get_design_context": ["design"],
        "submit_design":      ["design"],

        # ── coding phase only ──
        "apply_patch":       ["code"],
        "write_file":        ["code"],
        "get_diff":          ["code"],
        "run_tests":         ["code"],
        "get_test_results":  ["code"],

        # ── review: moves Code to Gate 3; a repeat at Gate 3 is a no-op ──
        "request_approval":  ["code", "g3"],
    }

    # Read-only status tools that also answer on a finished or cancelled run.
    ANYTIME_TOOLS = frozenset({
        "get_run", "get_agent_context", "get_approval_status", "get_audit_log", "report_model", "list_runs",
    })

    # Tools that touch one file, and whether they write it. Their "path"
    # argument is checked against the file rules.
    FILE_TOOLS = {"read_file": False, "write_file": True, "apply_patch": True}

    def check_tool(self, phase: str, tool_name: str) -> PolicyResult:
        """Check whether *tool_name* is permitted in the given *phase*."""
        if phase not in self.VALID_PHASES:
            return PolicyResult(False, f"Unknown phase '{phase}'. Valid phases: {self.VALID_PHASES}")

        allowed_phases = self.TOOL_PERMISSIONS.get(tool_name)
        if allowed_phases is None:
            return PolicyResult(False, f"Unknown tool '{tool_name}'")

        if phase in allowed_phases:
            return PolicyResult(True, "OK")

        return PolicyResult(
            False,
            f"Tool '{tool_name}' is not allowed in phase '{phase}'. "
            f"Allowed in: {allowed_phases}",
        )

    @staticmethod
    def current_phase(run: dict[str, Any]) -> str | None:
        """The run's current step, or None when no tool may touch the run.

        The backend's ``step`` is the source of truth. A finished, cancelled,
        unknown or missing step returns None, so callers fail closed instead
        of guessing. Runs from a backend without ``step`` fall back to the
        phase row marked active; with none active, the answer is None."""
        if "step" in run:
            step = run.get("step")
            return step if step in PolicyEngine.VALID_PHASES else None
        for step in run.get("steps") or []:
            if step.get("state") == "active":
                key = step.get("key")
                return key if key in PolicyEngine.VALID_PHASES else None
        return None

    def check_file_access(self, path: str, write: bool = False) -> PolicyResult:
        """Check whether accessing *path* is permitted by policy."""
        # Split on both separators so "a\..\b" style paths are caught on every platform.
        parts = re.split(r"[\\/]+", path)

        # Path traversal guard
        if ".." in parts:
            return PolicyResult(False, "Path traversal (..) is not allowed")

        # Git metadata: a writable .git/config can make host-side git commands
        # run arbitrary programs, and it can hold credentials.
        if any(part.lower() == ".git" for part in parts):
            return PolicyResult(False, "Git metadata (.git) cannot be read or written")

        if is_sensitive_path(path):
            action = "write to" if write else "read"
            return PolicyResult(False, f"Cannot {action} '{path}' — blocked by security policy")

        return PolicyResult(True, "OK")

    def evaluate(self, run: dict[str, Any], tool_name: str, path: str | None = None,
                 write: bool = False) -> dict[str, Any] | None:
        """The whole policy decision for one tool call on *run*.

        Returns None when the call may go ahead, or a denial (``error`` plus
        what was refused) that the caller returns and records. Unknown tools
        and runs with no active step are refused (fail closed)."""
        if tool_name not in self.TOOL_PERMISSIONS:
            return {"error": f"Unknown tool '{tool_name}'", "tool": tool_name}
        if tool_name in self.ANYTIME_TOOLS:
            return None
        phase = self.current_phase(run)
        if phase is None:
            return {
                "error": "This run has no active phase (it is finished or cancelled), "
                         "so no tool can act on it.",
                "status": run.get("status"),
                "tool": tool_name,
            }
        result = self.check_tool(phase, tool_name)
        if not result.allowed:
            return {"error": result.reason, "phase": phase, "tool": tool_name}
        if path is not None:
            result = self.check_file_access(path, write=write)
            if not result.allowed:
                return {"error": result.reason, "path": path, "tool": tool_name}
        return None

    def get_phase_permissions(self, phase: str) -> dict[str, list[str]]:
        """Return allowed and denied tools for the specified pipeline phase."""
        if phase not in self.VALID_PHASES:
            raise ValueError(f"Unknown phase '{phase}'. Valid phases: {self.VALID_PHASES}")

        allowed = sorted(
            tool for tool, phases in self.TOOL_PERMISSIONS.items() if phase in phases
        )
        denied = sorted(
            tool for tool, phases in self.TOOL_PERMISSIONS.items() if phase not in phases
        )
        return {
            "phase": [phase],
            "allowed_tools": allowed,
            "denied_tools": denied,
            "blocked_patterns": list(self.BLOCKED_FILE_PATTERNS),
            "blocked_directories": list(self.BLOCKED_DIRECTORIES),
        }


