"""Phase-aware policy engine for the GateKeep MCP server.

Every MCP tool call passes through this engine before execution.
It enforces:
  1. Tool → phase restrictions (e.g., coding tools only in 'code' phase)
  2. File path restrictions (same globs as repository/security.py)
  3. Sequential phase transition rules

The engine is stateless — it receives the current phase and tool name, and
returns a PolicyResult with allowed/denied + reason.
"""

from __future__ import annotations

import fnmatch
import os
from dataclasses import dataclass


@dataclass
class PolicyResult:
    """Outcome of a policy check."""
    allowed: bool
    reason: str


class PolicyEngine:
    """GateKeep MCP policy enforcement."""

    # Canonical phase order (same as DEFAULT_PHASES in backend runs/service.js).
    VALID_PHASES = ["req", "g1", "design", "g2", "code", "out"]

    # Sensitive file globs — must stay in sync with repository/security.py.
    BLOCKED_FILE_PATTERNS = [
        ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx",
        "credentials.*", "secrets.*", "secret.*", "id_rsa", "id_dsa",
        "*.keystore", "*.jks", ".npmrc", ".pypirc", ".netrc",
    ]

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
        "request_approval":       _ALL,
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
    }

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

    def check_file_access(self, path: str, write: bool = False) -> PolicyResult:
        """Check whether accessing *path* is permitted by policy."""
        # Path traversal guard
        if ".." in path.split(os.sep):
            return PolicyResult(False, "Path traversal (..) is not allowed")

        filename = os.path.basename(path).lower()
        for pattern in self.BLOCKED_FILE_PATTERNS:
            if fnmatch.fnmatch(filename, pattern):
                action = "write to" if write else "read"
                return PolicyResult(False, f"Cannot {action} '{filename}' — blocked by security policy")

        return PolicyResult(True, "OK")

    def check_phase_transition(self, current_phase: str, target_phase: str) -> PolicyResult:
        """Check whether transitioning from *current_phase* → *target_phase* is valid.

        Only forward transitions by exactly one step are allowed.
        """
        if current_phase not in self.VALID_PHASES:
            return PolicyResult(False, f"Unknown current phase '{current_phase}'")
        if target_phase not in self.VALID_PHASES:
            return PolicyResult(False, f"Unknown target phase '{target_phase}'")

        cur_idx = self.VALID_PHASES.index(current_phase)
        tgt_idx = self.VALID_PHASES.index(target_phase)

        if tgt_idx == cur_idx + 1:
            return PolicyResult(True, "OK")

        if tgt_idx <= cur_idx:
            return PolicyResult(False, f"Cannot go backward from '{current_phase}' to '{target_phase}'")

        return PolicyResult(
            False,
            f"Cannot skip phases: '{current_phase}' → '{target_phase}'. "
            f"Next phase must be '{self.VALID_PHASES[cur_idx + 1]}'",
        )

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
        }


