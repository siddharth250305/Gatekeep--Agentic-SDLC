import subprocess

from app.mcp.tools import diff_artifacts, workspace_diff


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def test_workspace_diff_includes_new_files_and_skips_noise(tmp_path):
    """New untracked files are reviewable; caches and sensitive files are not sent."""
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "m.py").write_text("a\nb\nc\n")
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")

    (tmp_path / "pkg" / "m.py").write_text("a\nB\nc\n")
    (tmp_path / "pkg" / "new.py").write_text("x = 1\ny = 2\n")
    (tmp_path / "pkg" / "__pycache__").mkdir()
    (tmp_path / "pkg" / "__pycache__" / "m.pyc").write_text("junk")
    (tmp_path / ".env").write_text("SECRET=1\n")

    files, diff = diff_artifacts(workspace_diff(str(tmp_path)))

    assert files == [
        {"path": "pkg/m.py", "status": "M", "add": 1, "rem": 1},
        {"path": "pkg/new.py", "status": "A", "add": 2, "rem": 0},
    ]
    assert diff["file"] == "pkg/m.py"
    assert [ln["type"] for ln in diff["by_file"]["pkg/m.py"]["lines"]] == ["ctx", "rem", "add", "ctx"]
    assert diff["by_file"]["pkg/new.py"]["lines"][1] == {"n1": None, "n2": 2, "type": "add", "text": "y = 2"}


def test_diff_artifacts_empty():
    assert diff_artifacts("") == ([], None)


def test_workspace_diff_without_git(tmp_path):
    assert workspace_diff(str(tmp_path)) == ""


def test_workspace_diff_never_runs_programs_from_repo_config(tmp_path):
    """D1: a planted fsmonitor / external diff command must not execute on the host."""
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "f.txt").write_text("a\n")
    _git(repo, "init", "-q")
    _git(repo, "add", ".")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")

    marker = tmp_path / "FIRED"
    hook = tmp_path / "hook.sh"
    hook.write_text(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
    hook.chmod(0o755)
    _git(repo, "config", "core.fsmonitor", str(hook))
    _git(repo, "config", "diff.external", str(hook))
    (repo / "f.txt").write_text("b\n")
    (repo / "new.txt").write_text("c\n")

    diff = workspace_diff(str(repo))

    assert not marker.exists()
    assert "+b" in diff and "+c" in diff
