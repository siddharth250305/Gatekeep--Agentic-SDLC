"""The MCP tool entry points in server.py: every gatekeep_* tool resolves a
session, checks the phase policy, and only then calls GateKeepTools. The
tools layer is replaced by a mock, so no backend is needed."""

from unittest.mock import MagicMock

import pytest

from app.mcp import server
from app.mcp.session import McpSession

KEYS = ["req", "g1", "design", "g2", "code", "out"]


def _run_at(phase):
    steps = []
    for k in KEYS:
        if k == phase:
            state = "active"
        else:
            state = "approved" if KEYS.index(k) < KEYS.index(phase) else "pending"
        steps.append({"key": k, "state": state})
    return {"id": "RUN-1", "status": "running", "steps": steps}


@pytest.fixture
def fake(monkeypatch):
    """server.tools and server.session_manager replaced by mocks."""
    tools = MagicMock()
    sessions = MagicMock()
    session = McpSession(session_id="s1", run_id="RUN-1", provider="p", client="c",
                         created_at="now", workspace=None)
    sessions.get_session_by_run.return_value = session
    monkeypatch.setattr(server, "tools", tools)
    monkeypatch.setattr(server, "session_manager", sessions)
    return tools, sessions


# (tool function, extra args, GateKeepTools method, a phase where it is allowed,
#  a phase where it is denied or None when it is allowed everywhere)
GATED = [
    (server.gatekeep_get_repository_context, (), "get_repository_context", "req", None),
    (server.gatekeep_list_files, (), "list_files", "req", None),
    (server.gatekeep_read_file, ("app.py",), "read_file", "code", None),
    (server.gatekeep_search_code, ("limit",), "search_code", "design", None),
    (server.gatekeep_get_requirements_context, (), "get_requirements_context", "req", "code"),
    (server.gatekeep_submit_requirements, ("reqs",), "submit_requirements", "req", "design"),
    (server.gatekeep_get_design_context, (), "get_design_context", "design", "req"),
    (server.gatekeep_submit_design, ("design",), "submit_design", "design", "code"),
    (server.gatekeep_apply_patch, ("app.py", "a", "b"), "apply_patch", "code", "design"),
    (server.gatekeep_write_file, ("app.py", "x"), "write_file", "code", "req"),
    (server.gatekeep_get_diff, (), "get_diff", "code", "req"),
    (server.gatekeep_run_tests, ("tests/",), "run_tests", "code", "design"),
    (server.gatekeep_get_test_results, (), "get_test_results", "code", "req"),
]


@pytest.mark.parametrize("fn, args, method, allowed, _denied", GATED, ids=[g[2] for g in GATED])
def test_a_tool_runs_in_a_phase_that_allows_it(fake, fn, args, method, allowed, _denied):
    tools, _ = fake
    tools.get_run.return_value = _run_at(allowed)
    getattr(tools, method).return_value = {"ok": method}
    assert fn("RUN-1", *args) == {"ok": method}
    getattr(tools, method).assert_called_once_with("s1", *args)


DENIABLE = [g for g in GATED if g[4] is not None]


@pytest.mark.parametrize("fn, args, method, _allowed, denied", DENIABLE, ids=[g[2] for g in DENIABLE])
def test_a_tool_is_refused_and_audited_in_a_phase_that_forbids_it(fake, fn, args, method, _allowed, denied):
    tools, _ = fake
    tools.get_run.return_value = _run_at(denied)
    out = fn("RUN-1", *args)
    assert "not allowed in phase" in out["error"]
    getattr(tools, method).assert_not_called()
    assert tools._audit.call_args.args[1] == "mcp.policy.denied"


def test_writes_to_secret_files_are_refused_even_in_the_code_phase(fake):
    tools, _ = fake
    tools.get_run.return_value = _run_at("code")
    out = server.gatekeep_write_file("RUN-1", ".env", "TOKEN=x")
    assert "error" in out
    tools.write_file.assert_not_called()


UNGATED = [
    (server.gatekeep_get_run, (), "get_run"),
    (server.gatekeep_get_agent_context, (), "get_agent_context"),
    (server.gatekeep_request_approval, ("summary",), "request_approval"),
    (server.gatekeep_get_approval_status, (), "get_approval_status"),
    (server.gatekeep_get_audit_log, (), "get_audit_log"),
    (server.gatekeep_report_model, ("Opus 5.5",), "report_model"),
]


@pytest.mark.parametrize("fn, args, method", UNGATED, ids=[u[2] for u in UNGATED])
def test_informational_tools_pass_straight_through(fake, fn, args, method):
    tools, _ = fake
    getattr(tools, method).return_value = {"ok": method}
    assert fn("RUN-1", *args) == {"ok": method}
    getattr(tools, method).assert_called_once_with("s1", *args)


def test_list_runs_needs_no_session(fake):
    tools, sessions = fake
    tools.list_runs.return_value = [{"id": "RUN-1"}]
    assert server.gatekeep_list_runs() == [{"id": "RUN-1"}]
    sessions.get_session_by_run.assert_not_called()


def test_a_session_is_created_on_first_use_and_the_call_is_counted(fake):
    tools, sessions = fake
    sessions.get_session_by_run.return_value = None
    sessions.create_session.return_value = McpSession(session_id="s9", run_id="RUN-1", provider="p",
                                                      client="c", created_at="now", workspace=None)
    server.gatekeep_get_approval_status("RUN-1")
    sessions.create_session.assert_called_once_with("RUN-1")
    sessions.record_tool_call.assert_called_once_with("s9", "gatekeep_get_approval_status")
    tools.get_approval_status.assert_called_once_with("s9")


def test_stdio_transport_needs_no_token(monkeypatch):
    """D7: local Claude Desktop (stdio) runs without GATEKEEP_MCP_TOKEN."""
    monkeypatch.delenv("GATEKEEP_MCP_TOKEN", raising=False)
    monkeypatch.setattr("sys.argv", ["server", "--transport", "stdio"])
    monkeypatch.setattr(server.session_manager, "auto_register_startup", MagicMock())
    run = MagicMock()
    monkeypatch.setattr(server.mcp, "run", run)
    server.main()
    run.assert_called_once_with(transport="stdio")
