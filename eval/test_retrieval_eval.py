"""Unit tests for the retrieval-eval helpers (not for retrieve() itself).

Run: PYTHONDONTWRITEBYTECODE=1 agents/.venv/bin/python -m pytest -p no:cacheprovider eval/test_retrieval_eval.py
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))

import retrieval_eval as ev  # noqa: E402


def test_metrics_counts_hits_against_relevant():
    m = ev.metrics(["a.py", "b.py", "c.py"], ["b.py", "z.py"], k=10)
    assert m == {"recall": 0.5, "hit": 1.0, "precision": 0.1, "rr": 0.5}


def test_metrics_miss_is_zero_everywhere():
    assert ev.metrics(["a.py"], ["b.py"], k=10) == {"recall": 0.0, "hit": 0.0, "precision": 0.0, "rr": 0.0}


def test_metrics_only_counts_top_k():
    ranked = [f"f{i}.py" for i in range(20)]
    assert ev.metrics(ranked, ["f15.py"], k=10)["recall"] == 0.0


def test_clean_message_strips_conventional_prefix_and_trailers():
    msg = "feat(retriever): rank files by import graph\n\nlonger body here\n\nCo-Authored-By: X <x@y>\nSigned-off-by: Y"
    assert ev.clean_message(msg) == "rank files by import graph\n\nlonger body here"


def test_word_count():
    assert ev.word_count(ev.clean_message("fix(x): add the rate limiter")) == 4
    assert ev.word_count(ev.clean_message("fix(x): add the rate limiter now")) == 5


def test_source_filter_ignores_vendored_generated_and_non_source():
    assert ev.is_scored_source("agents/app/repository/retriever.py")
    assert ev.is_scored_source("src/App.jsx")
    assert not ev.is_scored_source("README.md")
    assert not ev.is_scored_source("package-lock.json")
    assert not ev.is_scored_source("node_modules/x/index.js")
    assert not ev.is_scored_source("vendor/lib.js")
    assert not ev.is_scored_source("dist/bundle.js")
    assert not ev.is_scored_source("public/app.min.js")
    assert not ev.is_scored_source("proto/api_pb2.py")
    assert not ev.is_scored_source("src/__generated__/types.ts")


def test_split_changes_relevant_is_modified_sources_only():
    status = "M\tsrc/a.py\nA\tsrc/new.py\nD\tsrc/old.py\nM\tREADME.md\nM\tnode_modules/x.js\n"
    ch = ev.split_changes(status)
    assert ch == {"relevant": ["src/a.py"], "added": ["src/new.py"], "deleted": ["src/old.py"], "n_source": 3}


def test_names_a_file():
    assert ev.names_a_file("speed up retriever.py scoring")
    assert ev.names_a_file("update src/App.jsx layout")
    assert not ev.names_a_file("speed up the retriever scoring")
    assert not ev.names_a_file("bump to v1.2.3 release")


def test_bootstrap_ci_is_deterministic_and_brackets_mean():
    vals = [0.0, 1.0] * 20
    lo, hi = ev.bootstrap_ci(vals, n=1000, seed=0)
    assert (lo, hi) == ev.bootstrap_ci(vals, n=1000, seed=0)
    assert lo < 0.5 < hi


def test_bootstrap_ci_of_constant_is_point():
    assert ev.bootstrap_ci([0.25] * 10, n=200, seed=0) == (0.25, 0.25)


def test_ignored_dirs_cover_everything_the_scanner_skips():
    assert ev.scanner.IGNORE_DIRS <= ev.IGNORED_DIRS
    assert not ev.is_scored_source(".venv/lib/site.py")
