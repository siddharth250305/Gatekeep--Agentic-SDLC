"""The MCP tool entry points in server.py: every gatekeep_* tool resolves a
session and calls GateKeepTools, which checks the phase policy on every call
(G9). The forwarding is tested with a mocked tools layer; the policy is tested
on a real GateKeepTools whose run and tool bodies are stubbed, so no backend
is needed."""

from unittest.mock import MagicMock

import pytest

from app.mcp import server
from app.mcp.session import McpSession
from app.mcp.tools import GateKeepTools

KEYS = ["req", "g1", "design", "g2", "code", "g3", "done"]


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
    sessions.session_for_run.return_value = session
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
    # B3: asking for review is only possible from Code (and a no-op at Gate 3).
    (server.gatekeep_request_approval, ("summary",), "request_approval", "code", "design"),
]


@pytest.mark.parametrize("fn, args, method, allowed, _denied", GATED, ids=[g[2] for g in GATED])
def test_a_tool_runs_in_a_phase_that_allows_it(fake, fn, args, method, allowed, _denied):
    tools, _ = fake
    tools.get_run.return_value = _run_at(allowed)
    getattr(tools, method).return_value = {"ok": method}
    assert fn("RUN-1", *args) == {"ok": method}
    getattr(tools, method).assert_called_once_with("s1", *args)


DENIABLE = [g for g in GATED if g[4] is not None]
ARG_NAMES = {"read_file": ["path"], "search_code": ["query"], "submit_requirements": ["requirements"],
             "submit_design": ["design"], "apply_patch": ["path", "find", "replace"],
             "write_file": ["path", "content"], "run_tests": ["target"], "request_approval": ["summary"]}


@pytest.fixture
def real(monkeypatch):
    """server.tools is a real GateKeepTools; the run and every tool body are stubbed."""
    sessions = MagicMock()
    session = McpSession(session_id="s1", run_id="RUN-1", provider="p", client="c",
                         created_at="now", workspace=None)
    sessions.session_for_run.return_value = session
    sessions.get_session.return_value = session
    tools = GateKeepTools(sessions, base_url="http://test-backend", runner=MagicMock())
    tools._audit = MagicMock()
    monkeypatch.setattr(server, "tools", tools)
    monkeypatch.setattr(server, "session_manager", sessions)
    return tools


@pytest.mark.parametrize("fn, args, method, _allowed, denied", DENIABLE, ids=[g[2] for g in DENIABLE])
def test_a_tool_is_refused_and_audited_in_a_phase_that_forbids_it(real, monkeypatch, fn, args, method, _allowed, denied):
    real._fetch_run = lambda session: _run_at(denied)
    body = MagicMock()
    monkeypatch.setattr(real, f"_tool_{method}", body)
    out = fn("RUN-1", *args)
    assert "not allowed in phase" in out["error"]
    body.assert_not_called()
    assert real._audit.call_args.args[1] == "mcp.policy.denied"


@pytest.mark.parametrize("fn, args, method, allowed, _denied", GATED, ids=[g[2] for g in GATED])
def test_the_real_core_runs_a_tool_in_a_phase_that_allows_it(real, monkeypatch, fn, args, method, allowed, _denied):
    real._fetch_run = lambda session: _run_at(allowed)
    body = MagicMock(return_value={"ok": method})
    monkeypatch.setattr(real, f"_tool_{method}", body)
    assert fn("RUN-1", *args) == {"ok": method}
    assert body.call_args.args[1] == _run_at(allowed)  # the run the policy checked
    expected = dict(zip(ARG_NAMES.get(method, []), args))
    assert {k: v for k, v in body.call_args.kwargs.items() if k in expected} == expected


def test_writes_to_secret_files_are_refused_even_in_the_code_phase(real, monkeypatch):
    real._fetch_run = lambda session: _run_at("code")
    body = MagicMock()
    monkeypatch.setattr(real, "_tool_write_file", body)
    out = server.gatekeep_write_file("RUN-1", ".env", "TOKEN=x")
    assert "error" in out
    body.assert_not_called()


UNGATED = [
    (server.gatekeep_get_run, (), "get_run"),
    (server.gatekeep_get_agent_context, (), "get_agent_context"),
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
    sessions.session_for_run.assert_not_called()


def test_the_session_comes_from_the_manager_and_the_call_is_counted(fake):
    # session_for_run finds or creates the run's one session (G8; see test_m5_sessions).
    tools, sessions = fake
    sessions.session_for_run.return_value = McpSession(session_id="s9", run_id="RUN-1", provider="p",
                                                       client="c", created_at="now", workspace=None)
    server.gatekeep_get_approval_status("RUN-1")
    sessions.session_for_run.assert_called_once_with("RUN-1")
    sessions.record_tool_call.assert_called_once_with("s9", "gatekeep_get_approval_status")
    tools.get_approval_status.assert_called_once_with("s9")


def test_stdio_transport_needs_no_token(monkeypatch):
    """D7: local Claude Desktop (stdio) runs without GATEKEEP_MCP_TOKEN."""
    monkeypatch.delenv("GATEKEEP_MCP_TOKEN", raising=False)
    monkeypatch.setattr("sys.argv", ["server", "--transport", "stdio"])
    run = MagicMock()
    monkeypatch.setattr(server.mcp, "run", run)
    server.main()
    run.assert_called_once_with(transport="stdio")
