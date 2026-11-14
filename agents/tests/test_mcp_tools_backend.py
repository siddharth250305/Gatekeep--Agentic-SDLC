"""GateKeepTools against a fake Node backend: what each tool reads, what it
writes, and how backend or git failures are handled. No network, no Docker."""

import logging
from unittest.mock import patch

import httpx
import pytest

from app.mcp.session import McpSession, SessionManager
from app.fingerprint import tree_fingerprint
from app.mcp.tools import GateKeepTools
from app.repository.tools import WorkspaceTools

BASE = "http://test-backend"


def _run(active=None, status="running", **extra):
    keys = ["req", "g1", "design", "g2", "code", "g3", "done"]
    steps = []
    for k in keys:
        if active is None:
            state = "approved"
        elif k == active:
            state = "active"
        else:
            state = "approved" if keys.index(k) < keys.index(active) else "pending"
        steps.append({"key": k, "state": state, "status": state.title()})
    return {"id": "RUN-1", "status": status, "gate": None, "brief": "add rate limiting", "step": active or "done",
            "repo": "https://example.com/r.git", "commit": "abc123", "steps": steps, **extra}


class FakeBackend:
    """Stands in for httpx.get/post/put/patch. routes: (METHOD, path) -> (status, body)."""

    def __init__(self, routes=None):
        self.routes = routes or {}
        self.calls = []

    def respond(self, method, url, json=None, **_):
        path = url.removeprefix(BASE)
        self.calls.append((method, path, json))
        status, body = self.routes.get((method, path), (200, {}))
        return httpx.Response(status, json=body, request=httpx.Request(method, url))

    def sent(self, method, path):
        return [body for m, p, body in self.calls if (m, p) == (method, path)]


@pytest.fixture
def backend(monkeypatch):
    fake = FakeBackend()
    # The run is at Code unless a test says otherwise: every tool call reads
    # it and checks the phase policy first (G9).
    fake.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    for name in ("get", "post", "put", "patch"):
        monkeypatch.setattr(httpx, name, lambda url, _m=name.upper(), **kw: fake.respond(_m, url, **kw))
    return fake


@pytest.fixture
def gk(tmp_path):
    sm = SessionManager(base_url=BASE)
    sm._sessions["s1"] = McpSession(session_id="s1", run_id="RUN-1", provider="p",
                                    client="c", created_at="now", workspace=None)
    tools = GateKeepTools(sm, base_url=BASE)
    tools._workspace_path = lambda session: str(tmp_path)
    return tools


# ── sessions and backend helpers ─────────────────────────────────────────

def test_an_unknown_session_is_refused(gk):
    with pytest.raises(ValueError, match="Invalid session_id"):
        gk.get_run("nope")


def test_list_runs_keeps_only_the_public_fields(gk, backend):
    backend.routes[("GET", "/runs")] = (200, [{**_run(), "secret": "x"}, "junk"])
    assert gk.list_runs() == [{"id": "RUN-1", "brief": "add rate limiting", "repo": "https://example.com/r.git",
                               "status": "running", "gate": None, "awaiting": None,
                               "step": "done", "started": None}]


def test_list_runs_rejects_a_non_list_body(gk, backend):
    backend.routes[("GET", "/runs")] = (200, {"error": "weird"})
    with pytest.raises(ValueError, match="expected a list"):
        gk.list_runs()


def test_get_run_rejects_a_non_object_body(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, ["not", "a", "run"])
    with pytest.raises(ValueError, match="expected an object"):
        gk.get_run("s1")


def test_backend_http_errors_propagate(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (404, {"error": "run not found"})
    with pytest.raises(httpx.HTTPStatusError):
        gk.get_run("s1")


def test_get_audit_log_returns_the_chain(gk, backend):
    chain = [{"seq": 1, "event": "run.created"}]
    backend.routes[("GET", "/runs/RUN-1/audit")] = (200, chain)
    assert gk.get_audit_log("s1") == chain


# ── context ──────────────────────────────────────────────────────────────

def test_agent_context_lists_the_tools_allowed_in_the_active_phase(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="design"))
    ctx = gk.get_agent_context("s1")
    assert ctx["current_phase"] == "design"
    assert "submit_design" in ctx["allowed_tools"]
    assert "write_file" in ctx["denied_tools"]


def test_agent_context_allows_nothing_on_a_finished_run(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active=None, status="approved"))
    ctx = gk.get_agent_context("s1")
    assert ctx["current_phase"] is None
    assert ctx["allowed_tools"] == []
    assert "write_file" in ctx["denied_tools"]


def test_repository_context_needs_a_cloned_workspace(gk, backend, tmp_path):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="req"))
    gk._workspace_path = lambda session: str(tmp_path / "missing")
    assert "Workspace not found" in gk.get_repository_context("s1")["error"]


def test_repository_context_is_built_from_the_run(gk, backend, tmp_path):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="req"))
    with patch("app.mcp.tools.build_context", return_value={"files": []}) as build:
        assert gk.get_repository_context("s1") == {"files": []}
    assert build.call_args.kwargs == {"workspace": str(tmp_path), "feature_request": "add rate limiting",
                                      "repository_url": "https://example.com/r.git", "commit_sha": "abc123"}


def test_repository_tools_work_in_the_session_workspace(gk, backend, tmp_path):
    (tmp_path / "app.py").write_text("LIMIT = 5\n")
    assert gk.list_files("s1") == ["app.py"]
    assert gk.read_file("s1", "app.py") == "LIMIT = 5\n"
    assert gk.search_code("s1", "limit")[0]["path"] == "app.py"


# ── requirements and design ──────────────────────────────────────────────

def test_requirements_context_reports_the_active_phase(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="req", requirements="R1"))
    assert gk.get_requirements_context("s1") == {"requirements": "R1", "status": "running", "phase": "req"}


def _no_state_writes(backend):
    """B1: the tools never write phase state or run status directly."""
    assert not [c for c in backend.calls if c[0] == "PUT" and "/phases/" in c[1]]
    assert not [c for c in backend.calls if c[0] == "PATCH" and c[1].startswith("/runs/")]


def test_submit_requirements_stores_them_and_asks_the_backend_to_open_gate_1(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="req"))
    backend.routes[("POST", "/runs/RUN-1/actions/submit_requirements")] = (200, _run(active="g1", status="awaiting_gate"))
    out = gk.submit_requirements("s1", "must rate limit")
    assert out["submitted"] is True
    assert out["step"] == "g1"
    # The requirements ride on the move, so they are stored only if it is allowed.
    assert backend.sent("POST", "/runs/RUN-1/actions/submit_requirements") == [
        {"artifacts": {"requirements": "must rate limit"}}]
    assert backend.sent("PUT", "/runs/RUN-1/artifacts") == []
    _no_state_writes(backend)
    # The backend writes the step-change audit entry itself (E2).
    assert backend.sent("POST", "/runs/RUN-1/audit") == []


def test_a_refused_submission_is_reported_not_hidden(gk, backend):
    # The run looked like Requirements, but the backend has moved on (a race).
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="req"))
    backend.routes[("POST", "/runs/RUN-1/actions/submit_requirements")] = (
        409, {"error": "that move is not allowed while the run is at 'design'", "reason": "not_allowed", "step": "design"})
    out = gk.submit_requirements("s1", "again")
    assert out["submitted"] is False
    assert out["step"] == "design"
    assert "not allowed" in out["error"]
    # Nothing else is written for a move the backend refused.
    assert backend.sent("PUT", "/runs/RUN-1/artifacts") == []
    _no_state_writes(backend)


def test_design_context_includes_the_requirements(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="design", design="D", requirements="R"))
    assert gk.get_design_context("s1") == {"design": "D", "requirements": "R", "status": "running"}


def test_submit_design_stores_it_and_asks_the_backend_to_open_gate_2(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="design"))
    backend.routes[("POST", "/runs/RUN-1/actions/submit_design")] = (200, _run(active="g2", status="awaiting_gate"))
    out = gk.submit_design("s1", "use a token bucket")
    assert out["submitted"] is True
    assert backend.sent("POST", "/runs/RUN-1/actions/submit_design") == [{"artifacts": {"design": "use a token bucket"}}]
    assert backend.sent("PUT", "/runs/RUN-1/artifacts") == []
    _no_state_writes(backend)


def test_an_optional_audit_failure_is_logged_not_raised(gk, backend, caplog):
    backend.routes[("POST", "/runs/RUN-1/audit")] = (503, {"error": "down"})
    with patch.object(gk, "runner") as runner, \
         caplog.at_level(logging.WARNING, logger="gatekeep.mcp"):
        runner.run_path.return_value = SANDBOX_RESULT
        assert gk.run_tests("s1")["status"] == "Passed"
    assert "audit warning" in caplog.text


def test_audit_entries_never_carry_a_client_chosen_actor(gk, backend):
    # E2: the backend stamps the actor from the agent token.
    with patch.object(gk, "runner") as runner:
        runner.run_path.return_value = SANDBOX_RESULT
        gk.run_tests("s1")
    body = backend.sent("POST", "/runs/RUN-1/audit")[0]
    assert "actor" not in body and "createdAt" not in body


# ── coding, diff and tests ───────────────────────────────────────────────

def test_get_diff_returns_empty_when_git_fails(gk, backend, caplog):
    with patch("app.mcp.tools.workspace_diff", side_effect=OSError("git not found")), \
         caplog.at_level(logging.WARNING, logger="gatekeep.mcp"):
        assert gk.get_diff("s1") == ""
    assert "git not found" in caplog.text


def test_get_diff_returns_the_workspace_diff(gk, backend):
    with patch("app.mcp.tools.workspace_diff", return_value="diff --git a/x b/x\n"):
        assert gk.get_diff("s1") == "diff --git a/x b/x\n"


SANDBOX_RESULT = {"status": "Passed", "passed": 3, "failed": 0, "total": 3, "exit_code": 0,
                  "duration_ms": 120, "output": "3 passed"}


def test_run_tests_records_a_test_run_bound_to_the_code_fingerprint(gk, backend, tmp_path):
    # C2 + B7: each test run is stored with the exact code fingerprint it ran on.
    (tmp_path / "app.py").write_text("x = 1\n")
    backend.routes[("POST", "/runs/RUN-1/test-runs")] = (201, {"id": "tr-1"})
    result = {**SANDBOX_RESULT, "cases": [{"name": "test_a", "file": "t.py", "outcome": "passed", "new": True}],
              "skipped": 0, "missing_existing": []}
    with patch.object(gk, "runner") as runner:
        runner.run_path.return_value = result
        out = gk.run_tests("s1")
    assert out["test_run_id"] == "tr-1"
    [sent] = backend.sent("POST", "/runs/RUN-1/test-runs")
    assert sent["fingerprint"] == tree_fingerprint(str(tmp_path))
    assert (sent["status"], sent["passed"], sent["total"]) == ("Passed", 3, 3)
    assert sent["cases"] == result["cases"]
    assert backend.sent("PUT", "/runs/RUN-1/tests") == []
    audit = backend.sent("POST", "/runs/RUN-1/audit")[0]
    assert audit["event"] == "mcp.tests.run"
    assert audit["payload"]["test_run"] == "tr-1"
    assert audit["payload"]["fingerprint"] == sent["fingerprint"]


def test_run_tests_always_runs_the_whole_suite(gk, backend, tmp_path):
    # C3: a target cannot narrow the run to the robot's own test file.
    with patch.object(gk, "runner") as runner:
        runner.run_path.return_value = SANDBOX_RESULT
        out = gk.run_tests("s1", "tests/test_mine.py")
    runner.run_path.assert_called_once_with(str(tmp_path))
    assert "whole test suite" in out["note"]


def test_run_tests_still_returns_results_when_reporting_fails(gk, backend, caplog):
    backend.routes[("POST", "/runs/RUN-1/test-runs")] = (500, {"error": "boom"})
    with patch.object(gk, "runner") as runner, \
         caplog.at_level(logging.WARNING, logger="gatekeep.mcp"):
        runner.run_path.return_value = SANDBOX_RESULT
        assert gk.run_tests("s1")["status"] == "Passed"
    assert "test report warning" in caplog.text


def test_get_test_results_reads_the_run(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code", tests={"total": 3}, sandbox={"image": "x"}))
    assert gk.get_test_results("s1") == {"tests": {"total": 3}, "sandbox": {"image": "x"}}


# ── approval ─────────────────────────────────────────────────────────────

def test_request_approval_is_a_no_op_while_a_gate_is_open(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, {**_run(active="g3"), "status": "awaiting_gate", "gate": "Engineer"})
    assert gk.request_approval("s1", "done") == {"already_awaiting": True, "gate": "Engineer"}
    assert backend.sent("POST", "/runs/RUN-1/actions/request_review") == []


def test_request_approval_stores_the_diff_and_moves_code_to_gate_3(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code", tests={"total": 3, "passed": 3}))
    backend.routes[("POST", "/runs/RUN-1/actions/request_review")] = (
        200, {**_run(active="g3"), "status": "awaiting_gate", "gate": "Engineer"})
    diff = "diff --git a/app.py b/app.py\n--- a/app.py\n+++ b/app.py\n@@ -1 +1,2 @@\n x = 1\n+y = 2\n"
    with patch("app.mcp.tools.workspace_diff", return_value=diff):
        out = gk.request_approval("s1", "Added y.\n\nMore detail.")
    assert out["requested"] is True
    assert out["step"] == "g3"
    assert out["gate"] == "Engineer"
    [action] = backend.sent("POST", "/runs/RUN-1/actions/request_review")
    stored = action["artifacts"]
    assert stored["summary"]["sub"] == "Added y."
    assert "3/3 tests passed in the sandbox" in stored["summary"]["checks"]
    assert [f["path"] for f in stored["files"]] == ["app.py"]
    # One step change, one audit entry: the file list rides on the move itself.
    assert action["details"] == {"summary": "Added y.\n\nMore detail.", "files": ["app.py"]}
    assert backend.sent("POST", "/runs/RUN-1/audit") == []
    assert backend.sent("PUT", "/runs/RUN-1/artifacts") == []
    _no_state_writes(backend)


def test_request_approval_without_a_diff_still_stores_the_summary(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    backend.routes[("POST", "/runs/RUN-1/actions/request_review")] = (200, _run(active="g3", status="awaiting_gate"))
    with patch("app.mcp.tools.workspace_diff", side_effect=OSError("no git")):
        gk.request_approval("s1", "summary")
    stored = backend.sent("POST", "/runs/RUN-1/actions/request_review")[0]["artifacts"]
    assert "files" not in stored and stored["summary"]["checks"][0].startswith("0 file(s)")


def test_a_refused_review_request_is_reported(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    backend.routes[("POST", "/runs/RUN-1/actions/request_review")] = (
        409, {"error": "the run is cancelled and cannot change", "reason": "finished", "step": "cancelled"})
    with patch("app.mcp.tools.workspace_diff", return_value=""):
        out = gk.request_approval("s1", "summary")
    assert out["requested"] is False
    assert out["step"] == "cancelled"


def test_get_approval_status_lists_the_steps(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="g1"))
    status = gk.get_approval_status("s1")
    assert status["steps"][1] == {"key": "g1", "state": "active", "status": "Active"}


def test_report_model_survives_a_backend_error(gk, backend, caplog):
    backend.routes[("PATCH", "/mcp/sessions/s1")] = (500, {"error": "boom"})
    with caplog.at_level(logging.WARNING, logger="gatekeep.mcp"):
        assert gk.report_model("s1", "Opus 5.5") == {"updated": True, "model": "Opus 5.5"}
    assert gk.session_manager.get_session("s1").model == "Opus 5.5"
    assert "report_model warning" in caplog.text


# ── B7: "request review" hands over the exact code fingerprint ───────────

def test_request_approval_sends_the_code_fingerprint(gk, backend, tmp_path):
    (tmp_path / "app.py").write_text("y = 2\n")
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    backend.routes[("POST", "/runs/RUN-1/actions/request_review")] = (200, _run(active="g3", status="awaiting_gate"))
    with patch("app.mcp.tools.workspace_diff", return_value=""):
        gk.request_approval("s1", "summary")
    [action] = backend.sent("POST", "/runs/RUN-1/actions/request_review")
    assert action["fingerprint"] == tree_fingerprint(str(tmp_path))


def test_the_fingerprint_changes_when_any_file_changes(tmp_path):
    (tmp_path / "a.py").write_text("1\n")
    before = tree_fingerprint(str(tmp_path))
    assert tree_fingerprint(str(tmp_path)) == before
    (tmp_path / "a.py").write_text("2\n")
    after = tree_fingerprint(str(tmp_path))
    (tmp_path / "b.py").write_text("")
    assert len({before, after, tree_fingerprint(str(tmp_path))}) == 3
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "__pycache__" / "a.pyc").write_bytes(b"x")  # build noise is not code
    assert tree_fingerprint(str(tmp_path)) == tree_fingerprint(str(tmp_path))


# ── B6: the workspace is frozen once review is requested ─────────────────

def _to_gate_3(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    backend.routes[("POST", "/runs/RUN-1/actions/request_review")] = (200, _run(active="g3", status="awaiting_gate"))
    with patch("app.mcp.tools.workspace_diff", return_value=""):
        assert gk.request_approval("s1", "summary")["requested"] is True
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="g3", status="awaiting_gate"))


def test_writes_after_request_review_are_refused(gk, backend, tmp_path):
    (tmp_path / "app.py").write_text("reviewed\n")
    _to_gate_3(gk, backend)
    # At Gate 3 the phase policy refuses first; the freeze is the second
    # layer (see the stale-answer test below, where only the freeze holds).
    out = gk.write_file("s1", "app.py", "changed after review\n")
    assert "not allowed in phase 'g3'" in out["error"]
    out = gk.apply_patch("s1", "app.py", "reviewed", "sneaky")
    assert "not allowed in phase 'g3'" in out["error"]
    assert (tmp_path / "app.py").read_text() == "reviewed\n"
    denials = [b for b in backend.sent("POST", "/runs/RUN-1/audit") if b["event"] == "mcp.policy.denied"]
    assert len(denials) == 2


def test_the_freeze_holds_even_if_the_backend_answer_is_stale(gk, backend, tmp_path):
    # A write that raced the move to Gate 3 must not get through.
    (tmp_path / "app.py").write_text("reviewed\n")
    _to_gate_3(gk, backend)
    backend.routes[("GET", "/runs/RUN-1")] = (503, {"error": "down"})
    with pytest.raises(httpx.HTTPStatusError):
        gk.write_file("s1", "app.py", "x\n")
    assert (tmp_path / "app.py").read_text() == "reviewed\n"


def test_the_freeze_lifts_when_gate_3_sends_the_work_back_to_code(gk, backend, tmp_path):
    (tmp_path / "app.py").write_text("reviewed\n")
    _to_gate_3(gk, backend)
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))  # Gate 3 rejected to Code
    assert gk.write_file("s1", "app.py", "rework\n")["bytes"] == 7
    assert (tmp_path / "app.py").read_text() == "rework\n"


def test_a_refused_review_request_does_not_freeze_the_workspace(gk, backend, tmp_path):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    backend.routes[("POST", "/runs/RUN-1/actions/request_review")] = (409, {"error": "no", "reason": "not_allowed"})
    with patch("app.mcp.tools.workspace_diff", return_value=""):
        assert gk.request_approval("s1", "summary")["requested"] is False
    assert gk.write_file("s1", "app.py", "still coding\n")["bytes"] == 13


# ── D3: diffs and search results leaving through the MCP tools are redacted

def test_get_diff_hides_secrets(gk, backend, tmp_path):
    import subprocess
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "settings.py").write_text('API_KEY = "sk_live_abcdef123456"\n')
    assert "sk_live_abcdef123456" not in gk.get_diff("s1")


def test_an_ambiguous_review_failure_keeps_the_freeze_if_the_run_reached_gate_3(gk, backend, tmp_path):
    # Security review #11: the move may have committed even though the answer was lost.
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    def lost_answer(*a, **kw):
        backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="g3", status="awaiting_gate"))
        raise httpx.ReadTimeout("no answer")
    with patch.object(gk, "_robot_action", side_effect=lost_answer), \
         patch("app.mcp.tools.workspace_diff", return_value=""):
        with pytest.raises(httpx.ReadTimeout):
            gk.request_approval("s1", "summary")
    assert WorkspaceTools(str(tmp_path)).is_frozen()
    assert "error" in gk.write_file("s1", "app.py", "x\n")
