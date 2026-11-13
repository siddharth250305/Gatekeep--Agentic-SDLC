"""GateKeepTools against a fake Node backend: what each tool reads, what it
writes, and how backend or git failures are handled. No network, no Docker."""

import logging
from unittest.mock import patch

import httpx
import pytest

from app.mcp.session import McpSession, SessionManager
from app.mcp.tools import GateKeepTools

BASE = "http://test-backend"


def _run(active=None, status="running", **extra):
    keys = ["req", "g1", "design", "g2", "code", "out"]
    steps = []
    for k in keys:
        if active is None:
            state = "approved"
        elif k == active:
            state = "active"
        else:
            state = "approved" if keys.index(k) < keys.index(active) else "pending"
        steps.append({"key": k, "state": state, "status": state.title()})
    return {"id": "RUN-1", "status": status, "gate": None, "brief": "add rate limiting",
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
                               "status": "running", "gate": None, "awaiting": None}]


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


def test_repository_tools_work_in_the_session_workspace(gk, tmp_path):
    (tmp_path / "app.py").write_text("LIMIT = 5\n")
    assert gk.list_files("s1") == ["app.py"]
    assert gk.read_file("s1", "app.py") == "LIMIT = 5\n"
    assert gk.search_code("s1", "limit")[0]["path"] == "app.py"


# ── requirements and design ──────────────────────────────────────────────

def test_requirements_context_reports_the_active_phase(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="req", requirements="R1"))
    assert gk.get_requirements_context("s1") == {"requirements": "R1", "status": "running", "phase": "req"}


def test_submit_requirements_stores_them_and_opens_gate_1(gk, backend):
    out = gk.submit_requirements("s1", "must rate limit")
    assert out["submitted"] is True
    assert backend.sent("PUT", "/runs/RUN-1/artifacts") == [{"requirements": "must rate limit"}]
    assert backend.sent("PUT", "/runs/RUN-1/phases/g1")[0]["state"] == "active"
    assert backend.sent("PATCH", "/runs/RUN-1") == [{"status": "awaiting_gate", "gate": "Planner"}]
    assert backend.sent("POST", "/runs/RUN-1/audit")[0]["event"] == "mcp.requirements.submitted"


def test_design_context_includes_the_requirements(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="design", design="D", requirements="R"))
    assert gk.get_design_context("s1") == {"design": "D", "requirements": "R", "status": "running"}


def test_submit_design_stores_it_and_opens_gate_2(gk, backend):
    gk.submit_design("s1", "use a token bucket")
    assert backend.sent("PUT", "/runs/RUN-1/artifacts") == [{"design": "use a token bucket"}]
    assert backend.sent("PATCH", "/runs/RUN-1") == [{"status": "awaiting_gate", "gate": "Engineer"}]
    assert backend.sent("POST", "/runs/RUN-1/audit")[0]["event"] == "mcp.design.submitted"


def test_an_optional_audit_failure_is_logged_not_raised(gk, backend, caplog):
    backend.routes[("POST", "/runs/RUN-1/audit")] = (503, {"error": "down"})
    with caplog.at_level(logging.WARNING, logger="gatekeep.mcp"):
        assert gk.submit_design("s1", "d")["submitted"] is True
    assert "audit warning" in caplog.text


# ── coding, diff and tests ───────────────────────────────────────────────

def test_get_diff_returns_empty_when_git_fails(gk, caplog):
    with patch("app.mcp.tools.workspace_diff", side_effect=OSError("git not found")), \
         caplog.at_level(logging.WARNING, logger="gatekeep.mcp"):
        assert gk.get_diff("s1") == ""
    assert "git not found" in caplog.text


def test_get_diff_returns_the_workspace_diff(gk):
    with patch("app.mcp.tools.workspace_diff", return_value="diff --git a/x b/x\n"):
        assert gk.get_diff("s1") == "diff --git a/x b/x\n"


SANDBOX_RESULT = {"status": "Passed", "passed": 3, "failed": 0, "total": 3, "exit_code": 0,
                  "duration_ms": 120, "output": "3 passed"}


def test_run_tests_reports_results_and_audits(gk, backend):
    with patch("app.mcp.tools.SandboxRunner") as runner:
        runner.return_value.run_path.return_value = SANDBOX_RESULT
        assert gk.run_tests("s1", "tests/test_x.py") == SANDBOX_RESULT
    assert backend.sent("PUT", "/runs/RUN-1/tests")[0]["passed"] == 3
    audit = backend.sent("POST", "/runs/RUN-1/audit")[0]
    assert audit["event"] == "mcp.tests.run" and audit["payload"]["target"] == "tests/test_x.py"


def test_run_tests_still_returns_results_when_reporting_fails(gk, backend, caplog):
    backend.routes[("PUT", "/runs/RUN-1/tests")] = (500, {"error": "boom"})
    with patch("app.mcp.tools.SandboxRunner") as runner, \
         caplog.at_level(logging.WARNING, logger="gatekeep.mcp"):
        runner.return_value.run_path.return_value = SANDBOX_RESULT
        assert gk.run_tests("s1")["status"] == "Passed"
    assert "test report warning" in caplog.text


def test_get_test_results_reads_the_run(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code", tests={"total": 3}, sandbox={"image": "x"}))
    assert gk.get_test_results("s1") == {"tests": {"total": 3}, "sandbox": {"image": "x"}}


# ── approval ─────────────────────────────────────────────────────────────

def test_request_approval_is_a_no_op_while_a_gate_is_open(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, {**_run(active="g2"), "status": "awaiting_gate", "gate": "Engineer"})
    assert gk.request_approval("s1", "done") == {"already_awaiting": True, "gate": "Engineer"}
    assert backend.sent("PUT", "/runs/RUN-1/artifacts") == []


def test_request_approval_stores_the_summary_and_the_diff(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code", tests={"total": 3, "passed": 3}))
    diff = "diff --git a/app.py b/app.py\n--- a/app.py\n+++ b/app.py\n@@ -1 +1,2 @@\n x = 1\n+y = 2\n"
    with patch("app.mcp.tools.workspace_diff", return_value=diff):
        out = gk.request_approval("s1", "Added y.\n\nMore detail.")
    assert out["requested"] is True
    stored = backend.sent("PUT", "/runs/RUN-1/artifacts")[0]
    assert stored["summary"]["sub"] == "Added y."
    assert "3/3 tests passed in the sandbox" in stored["summary"]["checks"]
    assert [f["path"] for f in stored["files"]] == ["app.py"]
    assert backend.sent("POST", "/runs/RUN-1/audit")[0]["payload"]["files"] == ["app.py"]


def test_request_approval_without_a_diff_still_stores_the_summary(gk, backend):
    backend.routes[("GET", "/runs/RUN-1")] = (200, _run(active="code"))
    with patch("app.mcp.tools.workspace_diff", side_effect=OSError("no git")):
        gk.request_approval("s1", "summary")
    stored = backend.sent("PUT", "/runs/RUN-1/artifacts")[0]
    assert "files" not in stored and stored["summary"]["checks"][0].startswith("0 file(s)")


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
