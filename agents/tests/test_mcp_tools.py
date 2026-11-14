"""GateKeepTools / MCP server behaviour that needs no backend or Docker."""

from unittest.mock import patch

import httpx
import pytest

from app.mcp import server
from app.mcp.session import McpSession
from app.mcp.tools import GateKeepTools


def _session(run_id="RUN-1"):
    return McpSession(session_id="s1", run_id=run_id, provider="p", client="c",
                      created_at="now", workspace=None)


@pytest.fixture
def gk_tools(tmp_path):
    t = GateKeepTools(session_manager=None, base_url="http://test-backend")
    t._get_session = lambda sid: _session()
    t._workspace_path = lambda session: str(tmp_path)
    t._fetch_run = lambda session: {"id": "RUN-1", "step": "code", "status": "running"}
    return t


# ── E7: no file change without an audit record ───────────────────────────

def test_write_is_undone_when_audit_fails(gk_tools, tmp_path):
    (tmp_path / "a.py").write_text("original\n")
    with patch.object(gk_tools, "_backend_post", side_effect=httpx.ConnectError("backend down")):
        with pytest.raises(RuntimeError, match="audit log unavailable"):
            gk_tools.write_file("s1", "a.py", "changed\n")
    assert (tmp_path / "a.py").read_text() == "original\n"


def test_new_file_is_removed_when_audit_fails(gk_tools, tmp_path):
    with patch.object(gk_tools, "_backend_post", side_effect=httpx.ConnectError("backend down")):
        with pytest.raises(RuntimeError):
            gk_tools.write_file("s1", "new.py", "x = 1\n")
    assert not (tmp_path / "new.py").exists()


def test_patch_is_undone_when_audit_fails(gk_tools, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n")
    with patch.object(gk_tools, "_backend_post", side_effect=httpx.ConnectError("backend down")):
        with pytest.raises(RuntimeError):
            gk_tools.apply_patch("s1", "a.py", "x = 1", "x = 2")
    assert (tmp_path / "a.py").read_text() == "x = 1\n"


def test_write_succeeds_and_is_audited_when_backend_is_up(gk_tools, tmp_path):
    with patch.object(gk_tools, "_backend_post", return_value={}) as post:
        gk_tools.write_file("s1", "a.py", "x = 1\n")
    assert (tmp_path / "a.py").read_text() == "x = 1\n"
    assert post.call_args.args[1]["event"] == "mcp.file.written"


# ── B0 + E7: policy gate fails closed and audits denials ─────────────────

def _run(*states):
    keys = ["req", "g1", "design", "g2", "code", "out"]
    return {"id": "RUN-1", "status": "rejected",
            "steps": [{"key": k, "state": s} for k, s in zip(keys, states)]}


# The policy check lives in GateKeepTools.call, shared by MCP and the pipeline (G9).

def test_policy_denies_everything_on_a_rejected_run(gk_tools):
    gk_tools._fetch_run = lambda session: _run("approved", "approved", "approved", "rejected", "pending", "pending")
    with patch.object(gk_tools, "_audit") as audit:
        denial = gk_tools.submit_requirements("s1", "R")
    assert "no active phase" in denial["error"]
    audit.assert_called_once()
    assert audit.call_args.args[1] == "mcp.policy.denied"


def test_policy_denies_and_audits_git_writes_in_code_phase(gk_tools, tmp_path):
    gk_tools._fetch_run = lambda session: _run("approved", "approved", "approved", "approved", "active", "pending")
    with patch.object(gk_tools, "_audit") as audit:
        denial = gk_tools.write_file("s1", ".git/config", "[core]")
    assert ".git" in denial["error"]
    assert audit.call_args.args[1] == "mcp.policy.denied"
    assert not (tmp_path / ".git").exists()


def test_policy_allows_a_normal_write_in_code_phase(gk_tools):
    run = _run("approved", "approved", "approved", "approved", "active", "pending")
    assert gk_tools.policy.evaluate(run, "write_file", path="src/app.py", write=True) is None


def test_server_listens_on_localhost_by_default(monkeypatch):
    """D7: the MCP server is not exposed to the network unless asked."""
    monkeypatch.delenv("GATEKEEP_MCP_HOST", raising=False)
    monkeypatch.setenv("GATEKEEP_MCP_TOKEN", "t0ken")
    monkeypatch.setattr("sys.argv", ["server", "--transport", "sse"])
    with patch("uvicorn.run") as run:
        server.main()
    assert run.call_args.kwargs["host"] == "127.0.0.1"


def test_network_transport_refuses_to_start_without_a_token(monkeypatch):
    """D7: there is no unauthenticated network mode."""
    monkeypatch.delenv("GATEKEEP_MCP_TOKEN", raising=False)
    monkeypatch.setattr("sys.argv", ["server", "--transport", "sse"])
    with patch("uvicorn.run") as run, pytest.raises(SystemExit, match="GATEKEEP_MCP_TOKEN"):
        server.main()
    run.assert_not_called()


@pytest.mark.parametrize("transport, path", [("sse", "/sse"), ("streamable-http", "/mcp")])
def test_network_app_rejects_requests_without_the_token(transport, path):
    from starlette.testclient import TestClient

    client = TestClient(server.build_network_app(transport, "127.0.0.1", "t0ken"))
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/messages/", headers={"Authorization": "t0ken"}).status_code == 401


def test_network_app_lets_the_right_token_through():
    from starlette.testclient import TestClient

    app = server.build_network_app("streamable-http", "127.0.0.1", "t0ken")
    with TestClient(app) as client:  # runs the MCP session manager lifespan
        r = client.post("/mcp", headers={"Authorization": "Bearer t0ken",
                                         "Accept": "application/json, text/event-stream"},
                        json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    # Past the token check, the MCP layer answers (not our 401).
    assert r.status_code != 401
