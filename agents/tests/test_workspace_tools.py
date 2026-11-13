"""WorkspaceTools: the only file access the coding agents get. Real temporary
workspaces, no mocks."""

import pytest

from app.repository.tools import WorkspaceTools


@pytest.fixture
def ws(tmp_path):
    (tmp_path / "app.py").write_text("def handler():\n    return 'ok'\n")
    (tmp_path / "util.py").write_text("RATE_LIMIT = 10\n")
    return WorkspaceTools(str(tmp_path))


def test_paths_inside_git_are_refused(ws, tmp_path):
    (tmp_path / ".git").mkdir()
    with pytest.raises(ValueError, match="inside .git"):
        ws._safe(".git/config")


def test_paths_outside_the_workspace_are_refused(ws):
    with pytest.raises(ValueError, match="escapes the workspace"):
        ws._safe("../outside.py")


def test_read_file_reports_a_missing_file(ws):
    assert ws.read_file("nope.py") == "<not found: nope.py>"


def test_read_file_refuses_secret_files(ws, tmp_path):
    (tmp_path / ".env").write_text("TOKEN=abc\n")
    assert ws.read_file(".env") == "<refused: sensitive file>"


def test_search_code_finds_lines_case_insensitively(ws):
    hits = ws.search_code("RATE_limit")
    assert hits == [{"path": "util.py", "line": 1, "text": "RATE_LIMIT = 10"}]


def test_search_code_skips_secret_files(ws, tmp_path):
    (tmp_path / "secrets.py").write_text("RATE_LIMIT_KEY = 'hidden'\n")
    assert [h["path"] for h in ws.search_code("rate_limit")] == ["util.py"]


def test_search_code_stops_at_the_limit(ws, tmp_path):
    (tmp_path / "many.py").write_text("\n".join(f"hit_{i} = {i}" for i in range(20)))
    assert len(ws.search_code("hit_", limit=5)) == 5


def test_search_code_skips_unreadable_files(ws, tmp_path, monkeypatch):
    real_read_text = type(tmp_path).read_text

    def flaky(self, *args, **kwargs):
        if self.name == "app.py":
            raise OSError("permission denied")
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(type(tmp_path), "read_text", flaky)
    assert [h["path"] for h in ws.search_code("e")] == ["util.py"]


def test_apply_patch_on_a_missing_file_is_not_applied(ws):
    assert ws.apply_patch("nope.py", "a", "b") == {"path": "nope.py", "applied": False, "reason": "file not found"}


def test_apply_patch_tolerates_trailing_whitespace_in_the_anchor(ws, tmp_path):
    (tmp_path / "ws.py").write_text("def f():   \n    return 1  \n\nx = 2\n")
    out = ws.apply_patch("ws.py", "def f():\n    return 1", "def f():\n    return 2")
    assert out == {"path": "ws.py", "applied": True, "resilient": True}
    assert (tmp_path / "ws.py").read_text() == "def f():\n    return 2\n\nx = 2\n"


def test_apply_patch_reports_a_missing_anchor(ws, tmp_path):
    out = ws.apply_patch("app.py", "def other():", "def renamed():")
    assert out == {"path": "app.py", "applied": False, "reason": "anchor not found"}
    assert "def handler" in (tmp_path / "app.py").read_text()


def test_writes_to_secret_files_are_refused(ws):
    with pytest.raises(ValueError, match="sensitive"):
        ws.write_file("config/prod.env", "X=1")
