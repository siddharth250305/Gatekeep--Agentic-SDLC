"""GateKeep MCP Server — provider-agnostic governance layer for external AI agents.

Exposes 18 governed tools over MCP (SSE transport on port 8078).  Every tool
call goes through the PolicyEngine before reaching the GateKeepTools layer.

Usage:
    python -m agents.app.mcp.server          # direct
    mcp run agents/app/mcp/server.py         # via mcp CLI
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

# Guarantee the 'agents' directory is in sys.path regardless of execution cwd or runner
_AGENTS_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _AGENTS_ROOT not in sys.path:
    sys.path.insert(0, _AGENTS_ROOT)

from mcp.server import MCPServer

try:
    from .policy import PolicyEngine
    from .session import McpSession, SessionManager
    from .tools import GateKeepTools
except ImportError:
    from app.mcp.policy import PolicyEngine
    from app.mcp.session import McpSession, SessionManager
    from app.mcp.tools import GateKeepTools

# ── singletons ───────────────────────────────────────────────────────────

mcp = MCPServer("GateKeep")

session_manager = SessionManager()
policy = PolicyEngine()
tools = GateKeepTools(session_manager)


# ── helpers ──────────────────────────────────────────────────────────────

def _ensure_session(run_id: str) -> McpSession:
    """Look up an existing session for the run or create a new one."""
    session = session_manager.get_session_by_run(run_id)
    if session is None:
        session = session_manager.create_session(run_id)
    try:
        caller = sys._getframe(1).f_code.co_name
        if caller.startswith("gatekeep_"):
            session_manager.record_tool_call(session.session_id, caller)
    except Exception:
        pass
    return session


def _current_phase(run: dict[str, Any]) -> str:
    """Determine the currently active phase key from the backend run object.

    The backend returns ``steps`` as ``[{key, state, status, ...}, ...]``.
    We scan for the first step whose ``state`` is ``'active'``.
    Falls back to ``'req'`` if no step is active (fresh run).
    """
    for step in run.get("steps", []):
        if step.get("state") == "active":
            return step.get("key", "req")
    return "req"


def _policy_gate(run: dict[str, Any], tool_name: str, path: str | None = None, write: bool = False) -> dict | None:
    """Run policy checks; return an error dict if denied, else None."""
    phase = _current_phase(run)

    result = policy.check_tool(phase, tool_name)
    if not result.allowed:
        return {"error": result.reason, "phase": phase, "tool": tool_name}

    if path is not None:
        result = policy.check_file_access(path, write=write)
        if not result.allowed:
            return {"error": result.reason, "path": path}

    return None


# ── tools ────────────────────────────────────────────────────────────────

@mcp.tool()
def gatekeep_list_runs() -> list[dict[str, Any]]:
    """List all available runs in GateKeep with their ID, brief, repository, and status.
    Call this first to discover existing run_ids when no run_id has been specified."""
    return tools.list_runs()


@mcp.tool()
def gatekeep_get_run(run_id: str) -> dict[str, Any]:
    """Get the current state of a GateKeep run including all phases, artifacts,
    test results, and cryptographic audit chain verification."""
    session = _ensure_session(run_id)
    return tools.get_run(session.session_id)


@mcp.tool()
def gatekeep_get_agent_context(run_id: str) -> dict[str, Any]:
    """Get structured context for this run: current phase, repository info,
    approved requirements and design, active restrictions, and test results.
    Call this first when starting work on a run."""
    session = _ensure_session(run_id)
    return tools.get_agent_context(session.session_id)


@mcp.tool()
def gatekeep_get_repository_context(run_id: str) -> dict[str, Any]:
    """Get deep repository intelligence: language breakdown, entry points,
    dependency files, and the most relevant source files for the feature request.
    The workspace must already be cloned (run must be started)."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "get_repository_context")
    if deny:
        return deny
    return tools.get_repository_context(session.session_id)


@mcp.tool()
def gatekeep_list_files(run_id: str) -> list[str] | dict[str, str]:
    """List all tracked source and configuration files in the run's workspace repository."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "list_files")
    if deny:
        return deny
    return tools.list_files(session.session_id)


@mcp.tool()
def gatekeep_read_file(run_id: str, path: str) -> str | dict[str, str]:
    """Read the contents of a file from the workspace. Sensitive files (.env, keys)
    are blocked. Secrets in content are automatically redacted. Max 40KB."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "read_file", path=path, write=False)
    if deny:
        return deny
    return tools.read_file(session.session_id, path)


@mcp.tool()
def gatekeep_search_code(run_id: str, query: str) -> list[dict[str, Any]] | dict[str, str]:
    """Search the workspace codebase for a text query, class name, or function name.
    Returns matching lines with file paths and line numbers (max 50 results)."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "search_code")
    if deny:
        return deny
    return tools.search_code(session.session_id, query)


@mcp.tool()
def gatekeep_get_requirements_context(run_id: str) -> dict[str, Any]:
    """Get the current requirements artifact and phase status. Only available
    during the requirements phase."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "get_requirements_context")
    if deny:
        return deny
    return tools.get_requirements_context(session.session_id)


@mcp.tool()
def gatekeep_submit_requirements(run_id: str, requirements: str) -> dict[str, Any]:
    """Submit formal requirements for human review. This opens Gate 1 and
    pauses until a Planner approves or requests rework. Only allowed during
    the requirements phase."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "submit_requirements")
    if deny:
        return deny
    return tools.submit_requirements(session.session_id, requirements)


@mcp.tool()
def gatekeep_get_design_context(run_id: str) -> dict[str, Any]:
    """Get the current design artifact, approved requirements, and phase status.
    Only available during the design phase."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "get_design_context")
    if deny:
        return deny
    return tools.get_design_context(session.session_id)


@mcp.tool()
def gatekeep_submit_design(run_id: str, design: str) -> dict[str, Any]:
    """Submit a technical design for human review. This opens Gate 2 and
    pauses until an Engineer approves or requests rework. Only allowed during
    the design phase. Requirements must be approved first."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "submit_design")
    if deny:
        return deny
    return tools.submit_design(session.session_id, design)


@mcp.tool()
def gatekeep_apply_patch(run_id: str, path: str, find: str, replace: str) -> dict[str, Any]:
    """Apply a surgical code edit: replace an exact existing code block (find)
    with new code (replace) in the specified file. Has a whitespace-tolerant
    fallback. Only allowed during the coding phase. Sensitive files are blocked."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "apply_patch", path=path, write=True)
    if deny:
        return deny
    return tools.apply_patch(session.session_id, path, find, replace)


@mcp.tool()
def gatekeep_write_file(run_id: str, path: str, content: str) -> dict[str, Any]:
    """Create a new file or completely overwrite an existing file in the workspace.
    Prefer apply_patch for edits. Only allowed during the coding phase.
    Sensitive files are blocked."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "write_file", path=path, write=True)
    if deny:
        return deny
    return tools.write_file(session.session_id, path, content)


@mcp.tool()
def gatekeep_get_diff(run_id: str) -> str | dict[str, str]:
    """Get the git diff (HEAD) of all changes made in the workspace.
    Only available during the coding phase."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "get_diff")
    if deny:
        return deny
    return tools.get_diff(session.session_id)


@mcp.tool()
def gatekeep_run_tests(run_id: str, target: str | None = None) -> dict[str, Any]:
    """Run pytest in an isolated Docker sandbox (no network, capped memory/CPU).
    Optionally scope to a specific test file with the target parameter.
    Only allowed during the coding phase. Results are reported to the dashboard."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "run_tests")
    if deny:
        return deny
    return tools.run_tests(session.session_id, target)


@mcp.tool()
def gatekeep_get_test_results(run_id: str) -> dict[str, Any]:
    """Get the latest test results and Docker sandbox configuration.
    Only available during the coding phase."""
    session = _ensure_session(run_id)
    run = tools.get_run(session.session_id)
    deny = _policy_gate(run, "get_test_results")
    if deny:
        return deny
    return tools.get_test_results(session.session_id)


@mcp.tool()
def gatekeep_request_approval(run_id: str, summary: str) -> dict[str, Any]:
    """Request human approval for the current phase. Provide a summary of the
    work done so the reviewer has context. The dashboard will show a notification."""
    session = _ensure_session(run_id)
    return tools.request_approval(session.session_id, summary)


@mcp.tool()
def gatekeep_get_approval_status(run_id: str) -> dict[str, Any]:
    """Check the current approval status and which role (Planner/Engineer)
    is assigned to the active gate."""
    session = _ensure_session(run_id)
    return tools.get_approval_status(session.session_id)


@mcp.tool()
def gatekeep_get_audit_log(run_id: str) -> list[dict[str, Any]] | dict[str, str]:
    """Get the full SHA-256 cryptographic audit chain for the run.
    Each event is hash-linked to the previous one for tamper detection."""
    session = _ensure_session(run_id)
    return tools.get_audit_log(session.session_id)


@mcp.tool()
def gatekeep_report_model(run_id: str, model: str) -> dict[str, Any]:
    """Report the active model being used by the external client (e.g. 'Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5').
    Updates the GateKeep dashboard in real time."""
    session = _ensure_session(run_id)
    return tools.report_model(session.session_id, model)


# ── entrypoint ───────────────────────────────────────────────────────────

def main():
    """Start the GateKeep MCP server supporting stdio, sse, and streamable-http."""
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="GateKeep MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default="sse" if sys.stdin.isatty() else "stdio",
        help="Transport protocol (stdio for Claude Desktop local, sse or streamable-http for network)",
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host address for network transports")
    parser.add_argument("--port", type=int, default=8078, help="Port for network transports")
    args = parser.parse_args()

    # Automatically register active session on startup so dashboard indicates connection
    session_manager.auto_register_startup()

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    elif args.transport == "streamable-http":
        print(f"[GateKeep MCP] Starting on http://{args.host}:{args.port} (Streamable HTTP)")
        mcp.run(transport="streamable-http", host=args.host, port=args.port)
    else:
        print(f"[GateKeep MCP] Starting on http://{args.host}:{args.port} (SSE transport)")
        mcp.run(transport="sse", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
