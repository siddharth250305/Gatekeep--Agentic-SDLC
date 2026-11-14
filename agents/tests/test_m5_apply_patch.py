"""G7: apply_patch keeps encoding and line endings, refuses what it cannot
edit safely, and refuses an empty search text (which matched everywhere)."""

from __future__ import annotations

import pytest

from app.repository.tools import WorkspaceTools


@pytest.fixture
def wt(tmp_path):
    return WorkspaceTools(str(tmp_path))


def test_windows_line_endings_are_kept(wt, tmp_path):
    (tmp_path / "a.py").write_bytes(b"one\r\ntwo\r\nthree\r\n")
    out = wt.apply_patch("a.py", "two\n", "TWO\nextra\n")
    assert out["applied"] is True
    assert (tmp_path / "a.py").read_bytes() == b"one\r\nTWO\r\nextra\r\nthree\r\n"


def test_a_search_text_with_windows_endings_matches_a_unix_file(wt, tmp_path):
    (tmp_path / "a.py").write_bytes(b"one\ntwo\nthree\n")
    assert wt.apply_patch("a.py", "one\r\ntwo", "ONE\r\nTWO")["applied"] is True
    assert (tmp_path / "a.py").read_bytes() == b"ONE\nTWO\nthree\n"


def test_the_whitespace_tolerant_fallback_keeps_windows_endings(wt, tmp_path):
    (tmp_path / "a.py").write_bytes(b"def f():   \r\n    return 1\r\n")
    out = wt.apply_patch("a.py", "def f():\n    return 1", "def f():\n    return 2")
    assert out["applied"] is True and out.get("resilient") is True
    assert (tmp_path / "a.py").read_bytes() == b"def f():\r\n    return 2\r\n"


def test_a_missing_final_newline_stays_missing(wt, tmp_path):
    (tmp_path / "a.py").write_bytes(b"x = 1\r\ny = 2")
    wt.apply_patch("a.py", "y = 2", "y = 3")
    assert (tmp_path / "a.py").read_bytes() == b"x = 1\r\ny = 3"


def test_a_utf8_byte_order_mark_is_kept(wt, tmp_path):
    (tmp_path / "a.py").write_bytes("﻿name = 'café'\n".encode("utf-8"))
    assert wt.apply_patch("a.py", "café", "crème")["applied"] is True
    assert (tmp_path / "a.py").read_bytes() == "﻿name = 'crème'\n".encode("utf-8")


def test_utf8_text_is_written_as_utf8(wt, tmp_path):
    (tmp_path / "a.py").write_bytes("greeting = 'hello'\n".encode("utf-8"))
    wt.apply_patch("a.py", "hello", "नमस्ते")
    assert (tmp_path / "a.py").read_bytes() == "greeting = 'नमस्ते'\n".encode("utf-8")


@pytest.mark.parametrize("raw", [
    "name = 'café'\n".encode("latin-1"),        # another text encoding
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00",  # a binary file
])
def test_a_file_that_is_not_utf8_is_refused_and_left_untouched(wt, tmp_path, raw):
    (tmp_path / "f.bin").write_bytes(raw)
    out = wt.apply_patch("f.bin", "name", "title")
    assert out["applied"] is False and "UTF-8" in out["reason"]
    assert (tmp_path / "f.bin").read_bytes() == raw


@pytest.mark.parametrize("find", ["", "   ", "\n\n", "\r\n"])
def test_an_empty_search_text_is_refused(wt, tmp_path, find):
    (tmp_path / "a.py").write_bytes(b"x = 1\n")
    out = wt.apply_patch("a.py", find, "INJECTED")
    assert out["applied"] is False and "empty" in out["reason"]
    assert (tmp_path / "a.py").read_bytes() == b"x = 1\n"


def test_write_file_writes_exact_utf8_bytes(wt, tmp_path):
    wt.write_file("w.py", "a\r\nb = 'é'\n")
    assert (tmp_path / "w.py").read_bytes() == "a\r\nb = 'é'\n".encode("utf-8")


def test_read_file_decodes_utf8_whatever_the_locale(wt, tmp_path, monkeypatch):
    monkeypatch.setenv("LC_ALL", "C")
    (tmp_path / "r.py").write_bytes("s = 'naïve'\n".encode("utf-8"))
    assert wt.read_file("r.py") == "s = 'naïve'\n"
