"""GateKeepTools / MCP server behaviour that needs no backend or Docker."""

from unittest.mock import patch

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
    return t


# ── E7: no file change without an audit record ───────────────────────────

def test_write_is_undone_when_audit_fails(gk_tools, tmp_path):
    (tmp_path / "a.py").write_text("original\n")
    with patch.object(gk_tools, "_backend_post", side_effect=ConnectionError("backend down")):
        with pytest.raises(RuntimeError, match="audit log unavailable"):
            gk_tools.write_file("s1", "a.py", "changed\n")
    assert (tmp_path / "a.py").read_text() == "original\n"


def test_new_file_is_removed_when_audit_fails(gk_tools, tmp_path):
    with patch.object(gk_tools, "_backend_post", side_effect=ConnectionError("backend down")):
        with pytest.raises(RuntimeError):
            gk_tools.write_file("s1", "new.py", "x = 1\n")
    assert not (tmp_path / "new.py").exists()


def test_patch_is_undone_when_audit_fails(gk_tools, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n")
    with patch.object(gk_tools, "_backend_post", side_effect=ConnectionError("backend down")):
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


def test_policy_gate_denies_everything_on_a_rejected_run():
    run = _run("approved", "approved", "approved", "rejected", "pending", "pending")
    with patch.object(server.tools, "_audit") as audit:
        denial = server._policy_gate(run, "submit_requirements")
    assert denial is not None and "no active phase" in denial["error"]
    audit.assert_called_once()
    assert audit.call_args.args[1] == "mcp.policy.denied"


def test_policy_gate_denies_and_audits_git_writes_in_code_phase():
    run = _run("approved", "approved", "approved", "approved", "active", "pending")
    with patch.object(server.tools, "_audit") as audit:
        denial = server._policy_gate(run, "write_file", path=".git/config", write=True)
    assert denial is not None and ".git" in denial["error"]
    assert audit.call_args.args[1] == "mcp.policy.denied"


def test_policy_gate_allows_a_normal_write_in_code_phase():
    run = _run("approved", "approved", "approved", "approved", "active", "pending")
    with patch.object(server.tools, "_audit") as audit:
        assert server._policy_gate(run, "write_file", path="src/app.py", write=True) is None
    audit.assert_not_called()


def test_server_listens_on_localhost_by_default(monkeypatch):
    """D7: the MCP server is not exposed to the network unless asked."""
    monkeypatch.delenv("GATEKEEP_MCP_HOST", raising=False)
    monkeypatch.setattr("sys.argv", ["server", "--transport", "sse"])
    with patch.object(server.session_manager, "auto_register_startup"), \
         patch.object(server.mcp, "run") as run:
        server.main()
    assert run.call_args.kwargs["host"] == "127.0.0.1"
