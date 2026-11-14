import subprocess

from app.fingerprint import tree_fingerprint
from app.graph import build_pipeline
from app.llm import FakeLLM
from app.mcp.session import SessionManager
from app.mcp.tools import GateKeepTools
from app.reporter import HttpReporter
from app.repository.tools import WorkspaceTools
from app.sandbox import FakeRunner
from tests.conftest import BASE


def _make_git_repo(tmp_path):
    repo = tmp_path / "sample_repo"
    (repo / "src").mkdir(parents=True)
    (repo / "tests").mkdir()
    (repo / "src" / "app.py").write_text("def create_app():\n    return {'routes': ['/']}\n")
    (repo / "tests" / "test_app.py").write_text(
        "from app import create_app\n\ndef test_app():\n    assert create_app()\n")
    (repo / "requirements.txt").write_text("flask\n")
    (repo / "README.md").write_text("# Sample app\n")
    for cmd in (["git", "init", "-q"], ["git", "config", "user.email", "t@t"],
                ["git", "config", "user.name", "t"], ["git", "add", "-A"],
                ["git", "commit", "-q", "-m", "init"]):
        subprocess.run(cmd, cwd=repo, check=True)
    return str(repo)


def _pipeline(workspaces):
    core = GateKeepTools(SessionManager(base_url=BASE), base_url=BASE, runner=FakeRunner(), workspaces=workspaces)
    return build_pipeline(FakeLLM(), core, HttpReporter(base=BASE))


def test_repository_context_flows_through_the_pipeline(node, tmp_path):
    repo = _make_git_repo(tmp_path)
    ws_root = tmp_path / "workspaces"
    node.add_run("RUN-CTXTEST", brief="Add a /health endpoint", repo=repo)

    assert _pipeline(ws_root).work("RUN-CTXTEST")["did"] == "requirements"
    events = node.events("RUN-CTXTEST")
    assert "repo.fetched" in events            # real clone happened
    assert "repo.context.generated" in events  # engine ran
    [ctx] = [body for m, p, body in node.calls if (m, p) == ("PUT", "/runs/RUN-CTXTEST/context")]
    assert ctx["relevant_files"], "relevant files were found in the real repo"
    assert ctx["languages"], "languages detected"

    node.decide("RUN-CTXTEST", "approve")
    _pipeline(ws_root).work("RUN-CTXTEST")
    node.decide("RUN-CTXTEST", "approve")
    assert _pipeline(ws_root).work("RUN-CTXTEST")["did"] == "code"

    # The coding agent changed the real clone, through GateKeepTools.
    wsdir = ws_root / "RUN-CTXTEST"
    assert (wsdir / "src" / "app.py").exists()
    assert (wsdir / "throttle.py").exists() and (wsdir / "test_throttle.py").exists()
    assert node.events("RUN-CTXTEST").count("mcp.file.written") == 2
    assert node.test_runs, "sandbox result reported"
    assert node.runs["RUN-CTXTEST"]["step"] == "g3"


def test_pipeline_hands_over_the_tested_fingerprint_and_freezes_the_workspace(node, tmp_path):
    # B6 + B7 in pipeline mode: the test run and "request review" carry the
    # same code fingerprint, and the workspace is frozen until Gate 3 decides.
    repo = _make_git_repo(tmp_path)
    ws_root = tmp_path / "workspaces"
    node.add_run("RUN-FPTEST", step="code", brief="Add a /health endpoint", repo=repo)
    _pipeline(ws_root).work("RUN-FPTEST")

    wsdir = ws_root / "RUN-FPTEST"
    [test_run] = node.test_runs
    review = next(e for e in node.runs["RUN-FPTEST"]["auditChain"] if e["event"] == "code.review_requested")
    assert test_run["fingerprint"] == review["payload"]["fingerprint"] == tree_fingerprint(str(wsdir))
    assert test_run["status"] == "Passed"

    tools = WorkspaceTools(str(wsdir))
    try:
        tools.write_file("late.py", "x = 1\n")
        raise AssertionError("write after request_review was allowed")
    except ValueError as err:
        assert "frozen" in str(err)

    # Back to Code: the freeze lifts, the agent writes again, re-tests and
    # hands over again.
    node.decide("RUN-FPTEST", "reject", target="code", feedback="more tests")
    assert _pipeline(ws_root).work("RUN-FPTEST")["did"] == "code"
    assert len(node.test_runs) == 2
    assert node.runs["RUN-FPTEST"]["step"] == "g3"
    assert tools.is_frozen()
