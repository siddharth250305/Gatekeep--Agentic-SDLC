import shutil
import subprocess

from app.graph import build_graph, start_run, resume_run, _feature_slug
from app.llm import FakeLLM
from app.reporter import NullReporter
from app.sandbox import FakeRunner
from app.workspace import WORKSPACES


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


def test_repository_context_flows_through_the_pipeline(tmp_path):
    repo = _make_git_repo(tmp_path)
    run_id = "RUN-CTXTEST"
    wsdir = WORKSPACES / run_id
    shutil.rmtree(wsdir, ignore_errors=True)
    try:
        r = NullReporter()
        app = build_graph(FakeLLM(), r, runner=FakeRunner())

        out = start_run(app, run_id, "Add a /health endpoint", repo=repo)
        assert out["paused"] is True and out["gate"]["gate"] == "g1"

        events = [e for e, _ in r.audits]
        assert "repo.fetched" in events            # real clone happened
        assert "repo.context.generated" in events  # engine ran

        assert r.repo_contexts, "UI context reported"
        ctx = r.repo_contexts[0]
        assert ctx["relevant_files"], "relevant files were found in the real repo"
        assert ctx["languages"], "languages detected"

        ws_events = [t for t, _ in r.events]
        assert "repo.context.scanning" in ws_events
        assert "repo.context.generated" in ws_events

        # drive gates: g1 -> design -> g2 -> coding
        resume_run(app, run_id, "approve")
        resume_run(app, run_id, "approve")

        # coding agent MODIFIED the real workspace
        slug = _feature_slug("Add a /health endpoint")
        assert (wsdir / f"{slug}.py").exists()
        assert (wsdir / f"test_{slug}.py").exists()
        assert "workspace.modified" in [e for e, _ in r.audits]
        assert r.tests_reported, "sandbox result reported"

        final = resume_run(app, run_id, "approve")
        assert final["status"] == "approved"
    finally:
        shutil.rmtree(wsdir, ignore_errors=True)
        (WORKSPACES / ".frozen" / run_id).unlink(missing_ok=True)


def test_pipeline_hands_over_the_tested_fingerprint_and_freezes_the_workspace(tmp_path):
    # B6 + B7 in pipeline mode: the test run and "request review" carry the
    # same code fingerprint, and the workspace is frozen until Gate 3 decides.
    from app.fingerprint import tree_fingerprint
    from app.repository.tools import WorkspaceTools

    repo = _make_git_repo(tmp_path)
    run_id = "RUN-FPTEST"
    wsdir = WORKSPACES / run_id
    shutil.rmtree(wsdir, ignore_errors=True)
    try:
        r = NullReporter()
        app = build_graph(FakeLLM(), r, runner=FakeRunner())
        start_run(app, run_id, "Add a /health endpoint", repo=repo)
        resume_run(app, run_id, "approve")
        resume_run(app, run_id, "approve")   # coding -> request review -> Gate 3

        [test_run] = r.tests_reported
        review = dict(r.action_bodies)["request_review"]
        assert test_run["fingerprint"] == review["fingerprint"] == tree_fingerprint(str(wsdir))
        assert test_run["image"] and test_run["status"] == "Passed"

        tools = WorkspaceTools(str(wsdir))
        try:
            tools.write_file("late.py", "x = 1\n")
            raise AssertionError("write after request_review was allowed")
        except ValueError as err:
            assert "frozen" in str(err)

        # Back to Code: the freeze lifts, the agent can write again (the coding
        # node would raise on a frozen workspace), re-tests, and hands over again.
        resume_run(app, run_id, "reject", "more tests", gate="g3", target="code")
        assert r.actions[-2:] == ["request_review", "request_review"]
        assert len(r.tests_reported) == 2
        assert tools.is_frozen()
    finally:
        shutil.rmtree(wsdir, ignore_errors=True)
        (WORKSPACES / ".frozen" / run_id).unlink(missing_ok=True)  # the freeze marker is a file
