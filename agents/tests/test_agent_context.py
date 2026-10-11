import shutil
import subprocess
from pathlib import Path

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
