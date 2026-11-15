"""Phase-aware policy engine for the GateKeep MCP server.

Every tool call, from an MCP client or from the built-in pipeline, passes
through this engine (GateKeepTools.call) before execution.
It enforces:
  1. Tool → phase restrictions (e.g., coding tools only in 'code' phase)
  2. File path restrictions (same globs as repository/security.py)
  3. The project's own rules from gatekeep.yaml (I5), as recorded with the
     backend: forbidden paths, denied tools, and design enforcement (I2)

Moving a run between steps is not decided here: only the backend state
machine (backend/src/runs/machine.js) does that.

The engine is stateless — it receives the current phase and tool name, and
returns a PolicyResult with allowed/denied + reason.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ..project_policy import glob_match, has_control_chars, is_governance_path, plan_covers
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

    # Tools that act on the workspace or hand it over: the project policy
    # (gatekeep.yaml) must be recorded before they run (I5). The first five
    # are those a project may deny (backend/src/policy/policy.js ROBOT_TOOLS).
    POLICY_TOOLS = frozenset({
        "list_files", "read_file", "search_code", "get_repository_context", "get_diff",
        "write_file", "apply_patch", "run_tests", "request_approval",
    })

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
        if has_control_chars(path):
            return PolicyResult(False, "Paths may not contain control characters (newlines, tabs, ...)")

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

        # The project's rules and GateKeep's evidence belong to the people
        # reviewing the work, never to the agent being reviewed (I5, I6).
        if write and is_governance_path(path):
            return PolicyResult(False, "gatekeep.yaml, .gatekeep/ and folders the review cannot see "
                                       "(__pycache__/, .pytest_cache/) cannot be written by the agent")

        return PolicyResult(True, "OK")

    def project_denial(self, run: dict[str, Any], tool_name: str, path: str | None = None,
                       write: bool = False) -> dict[str, Any] | None:
        """The project's own rules (gatekeep.yaml, as the backend recorded and
        validated them in ``run["policy"]``). None when the call may go ahead.

        An invalid policy stops every tool except the status tools (fail
        closed). With ``design.enforce: block`` only files in the approved
        design plan (``run["trace"]["plan"]``) can be written; with no plan,
        none can."""
        policy = run.get("policy")
        if not isinstance(policy, dict) or tool_name in self.ANYTIME_TOOLS:
            return None
        if policy.get("status") == "invalid":
            errors = "; ".join(str(e) for e in policy.get("errors") or []) or "unknown error"
            return {"error": f"gatekeep.yaml is invalid ({errors}), so no tool can act on this run until "
                             f"the project fixes it and a new run starts.", "tool": tool_name}
        rules = policy.get("rules") if policy.get("status") == "loaded" else None
        if not isinstance(rules, dict):
            return None
        if tool_name in ((rules.get("tools") or {}).get("deny") or []):
            return {"error": f"Tool '{tool_name}' is denied by gatekeep.yaml for this project", "tool": tool_name}
        if path is None or not write:
            return None
        for pattern in rules.get("forbidden_paths") or []:
            # In any letter case: on macOS and Windows INFRA/ is infra/.
            if glob_match(pattern.lower(), path.lower()):
                return {"error": f"'{path}' is forbidden by gatekeep.yaml (forbidden_paths: {pattern})",
                        "path": path, "tool": tool_name}
        if (rules.get("design") or {}).get("enforce") == "block":
            plan = (run.get("trace") or {}).get("plan") or {}
            planned = [f.get("path") for f in plan.get("files") or [] if isinstance(f, dict)]
            if not any(isinstance(p, str) and plan_covers(p, path) for p in planned):
                return {"error": f"'{path}' is not in the approved design, and gatekeep.yaml enforces the "
                                 f"design (design.enforce: block). Planned files: {planned or 'none'}",
                        "path": path, "tool": tool_name}
        return None

    @staticmethod
    def project_restrictions(run: dict[str, Any]) -> list[str]:
        """The project's rules in words, for the agent's context."""
        policy = run.get("policy") or {}
        if policy.get("status") == "invalid":
            return ["gatekeep.yaml is invalid: no tool can act on this run"]
        rules = policy.get("rules") or {}
        out = []
        if rules.get("forbidden_paths"):
            out.append(f"gatekeep.yaml forbids writing: {', '.join(rules['forbidden_paths'])}")
        if (rules.get("tools") or {}).get("deny"):
            out.append(f"gatekeep.yaml denies the tools: {', '.join(rules['tools']['deny'])}")
        if (rules.get("design") or {}).get("enforce") == "block":
            out.append("gatekeep.yaml enforces the design: only files listed in the approved design can be written")
        scope = rules.get("scope") or {}
        if scope.get("max_files_changed"):
            out.append(f"Change at most {scope['max_files_changed']} files")
        if scope.get("max_lines_changed"):
            out.append(f"Change at most {scope['max_lines_changed']} lines")
        for rule in rules.get("protected_paths") or []:
            out.append(f"Changes to {rule.get('path')} need {rule.get('approvals', 1)} Gate 3 approval(s)")
        return out

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


