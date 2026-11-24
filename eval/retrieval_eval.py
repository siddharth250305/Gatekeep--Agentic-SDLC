"""Offline retrieval-quality eval for the Repository Context Engine.

For each sampled commit C (seed 0, up to 40 per repo):
  feature request = C's message (conventional prefix and trailers removed)
  repository      = C's parent, checked out in a temporary detached worktree
  relevant files  = source files C modified (status M) that existed at the parent
and compares retrieve(max_files=10) against them, alongside two comparisons on
the same commits: retrieve() with the import-graph signal disabled, and a
plain content keyword-count baseline.

Production code is imported, never modified; the import-graph ablation is a
monkeypatch that lives only inside this process.

Run from the gatekeeper repo root:
  PYTHONDONTWRITEBYTECODE=1 agents/.venv/bin/python eval/retrieval_eval.py
Replay the exact saved commit list instead of re-sampling:
  PYTHONDONTWRITEBYTECODE=1 agents/.venv/bin/python eval/retrieval_eval.py --commits eval/results/sampled_commits.json
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True  # never drop .pyc files into agents/

import argparse
import json
import random
import re
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
GATEKEEPER = HERE.parent
sys.path.insert(0, str(GATEKEEPER / "agents"))

from app.repository import retriever, scanner  # noqa: E402
from app.repository.manifest import build_manifest  # noqa: E402
from app.repository.retriever import keywords, retrieve  # noqa: E402

K = 10
SEED = 0
MAX_PER_REPO = 40
N_BOOT = 1000
MIN_WORDS = 5
MAX_SOURCE_FILES = 10
DEFAULT_REPOS = [GATEKEEPER, Path.home() / "carbon-lens", Path.home() / "Downloads" / "machine_learning"]
RESULTS = HERE / "results"

SOURCE_EXT = {".py", ".js", ".jsx", ".ts", ".tsx"}
IGNORED_DIRS = scanner.IGNORE_DIRS | {"vendored", "third_party", "generated", "__generated__"}
GENERATED_SUFFIXES = (".min.js", ".bundle.js", "_pb2.py", "_pb2_grpc.py")

_PREFIX = re.compile(r"^\s*[A-Za-z]+(\([^)]*\))?!?:\s*")
_TRAILER = re.compile(r"^\s*(co-authored-by|signed-off-by|reviewed-by|change-id):", re.I)
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'_-]*")
_FILE_NAME = re.compile(
    r"(?<![\w.])[\w./-]*\w\.(?:py|jsx?|tsx?|json|md|ya?ml|toml|css|html|sh|txt|cfg|ini|sql)\b", re.I)


# --- pure helpers (unit-tested in test_retrieval_eval.py) --------------------

def clean_message(message: str) -> str:
    """Commit message as a feature request: trailers dropped, prefix removed."""
    lines = [ln for ln in message.strip().splitlines() if not _TRAILER.match(ln)]
    text = "\n".join(lines).strip()
    return _PREFIX.sub("", text, count=1).strip()


def word_count(text: str) -> int:
    return len(_WORD.findall(text))


def names_a_file(text: str) -> bool:
    """Leakage flag: the message names a file such as `retriever.py`."""
    return bool(_FILE_NAME.search(text))


def is_scored_source(path: str) -> bool:
    p = PurePosixPath(path)
    if p.suffix.lower() not in SOURCE_EXT or p.name.lower().endswith(GENERATED_SUFFIXES):
        return False
    return not ({d.lower() for d in p.parts[:-1]} & IGNORED_DIRS)


def split_changes(name_status: str) -> dict:
    """Parse `git diff-tree --name-status --no-renames` (tab-separated) lines."""
    relevant, added, deleted, n_source = [], [], [], 0
    for row in name_status.splitlines():
        if not row.strip():
            continue
        code, path = row.split("\t", 1)
        if not is_scored_source(path):
            continue
        n_source += 1
        {"M": relevant, "A": added, "D": deleted}.get(code[0], []).append(path)
    return {"relevant": sorted(relevant), "added": sorted(added), "deleted": sorted(deleted), "n_source": n_source}


def metrics(ranked: list[str], relevant: list[str], k: int = K) -> dict:
    top = ranked[:k]
    rel = set(relevant)
    hits = [p for p in top if p in rel]
    first = next((i + 1 for i, p in enumerate(top) if p in rel), None)
    return {
        "recall": len(hits) / len(rel),
        "hit": 1.0 if hits else 0.0,
        "precision": len(hits) / k,
        "rr": 1.0 / first if first else 0.0,
    }


def bootstrap_ci(values: list[float], n: int = N_BOOT, seed: int = SEED, alpha: float = 0.05):
    """Percentile bootstrap CI of the mean, resampling commits with replacement."""
    if not values:
        return (None, None)
    rng = random.Random(seed)
    m = len(values)
    means = sorted(sum(values[rng.randrange(m)] for _ in range(m)) / m for _ in range(n))
    return (means[int(alpha / 2 * n)], means[int((1 - alpha / 2) * n) - 1])


# --- git (read-only apart from temporary worktrees) --------------------------

def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True,
                          text=True, errors="replace").stdout


def name_status(repo: Path, parent: str, sha: str) -> str:
    raw = git(repo, "diff-tree", "--no-commit-id", "-r", "--name-status", "--no-renames", "-z", parent, sha)
    tok = raw.split("\0")
    return "\n".join(f"{tok[i]}\t{tok[i + 1]}" for i in range(0, len(tok) - 1, 2))


@contextmanager
def worktree(repo: Path, rev: str, tmp_root: Path):
    path = tmp_root / f"{repo.name}-{rev[:12]}"
    git(repo, "worktree", "add", "--detach", str(path), rev)
    try:
        yield path
    finally:
        git(repo, "worktree", "remove", str(path))


def sample_commits(repo: Path) -> tuple[list[dict], dict]:
    log = git(repo, "log", "--no-merges", "--format=%H%x00%P%x00%B%x1e", "HEAD")
    funnel = {"non_merge": 0, "root_commit": 0, "short_message": 0, "no_source_change": 0,
              "too_many_source_files": 0, "only_added_sources": 0, "eligible": 0}
    eligible = []
    for entry in log.split("\x1e"):
        if not entry.strip():
            continue
        sha, parents, message = entry.strip("\n").split("\x00", 2)
        funnel["non_merge"] += 1
        if not parents.strip():
            funnel["root_commit"] += 1
            continue
        request = clean_message(message)
        if word_count(request) < MIN_WORDS:
            funnel["short_message"] += 1
            continue
        parent = parents.split()[0]
        ch = split_changes(name_status(repo, parent, sha))
        if ch["n_source"] == 0:
            funnel["no_source_change"] += 1
            continue
        if ch["n_source"] > MAX_SOURCE_FILES:
            funnel["too_many_source_files"] += 1
            continue
        if not ch["relevant"]:
            funnel["only_added_sources"] += 1
            continue
        funnel["eligible"] += 1
        eligible.append({"repo": repo.name, "sha": sha, "parent": parent, "message": message.strip()})
    picked = random.Random(SEED).sample(eligible, min(MAX_PER_REPO, len(eligible)))
    order = {c["sha"]: i for i, c in enumerate(eligible)}
    picked.sort(key=lambda c: order[c["sha"]])
    funnel["sampled"] = len(picked)
    return picked, funnel


# --- the three rankers --------------------------------------------------------

@contextmanager
def no_import_graph():
    original = retriever._import_edges
    retriever._import_edges = lambda files, root: {}
    try:
        yield
    finally:
        retriever._import_edges = original


def keyword_baseline(request: str, root: Path, files: list[dict], k: int = K,
                     code_only: bool = False) -> list[dict]:
    """Rank scanned files by raw keyword count. code_only restricts candidates to
    .py/.js/.jsx/.ts/.tsx, the same pool the relevant files come from."""
    kw = keywords(request)
    counts = []
    for f in files:
        if code_only and not is_scored_source(f["path"]):
            continue
        text = retriever._read(root, f["path"]).lower()
        c = sum(text.count(w) for w in kw)
        if c:
            counts.append((f["path"], c))
    counts.sort(key=lambda pc: (-pc[1], pc[0]))
    return [{"path": p, "count": c} for p, c in counts[:k]]


def miss_reason(rel: str, full_ranked: list[dict], indexed: set[str]) -> str:
    if rel not in indexed:
        return "not indexed by the scanner"
    rank = next((i + 1 for i, r in enumerate(full_ranked) if r["path"] == rel), None)
    if rank is None:
        return "score 0: no request keyword in its filename or content (vocabulary mismatch)"
    r = full_ranked[rank - 1]
    return f"ranked #{rank} of {len(full_ranked)} scored files (score {r['score']}, signals: {'; '.join(r['reasons'])})"


def evaluate_commit(repo: Path, c: dict, tmp_root: Path) -> dict:
    request = clean_message(c["message"])
    ch = split_changes(name_status(repo, c["parent"], c["sha"]))
    with worktree(repo, c["parent"], tmp_root) as wt:
        files = scanner.scan(str(wt))
        manifest = build_manifest(str(repo), c["parent"], files)
        full_ranked = retrieve(request, str(wt), manifest, max_files=10**9)  # same order; sliced below
        with no_import_graph():
            ablated = retrieve(request, str(wt), manifest, max_files=K)
        baseline = keyword_baseline(request, wt, files, K)
        baseline_code = keyword_baseline(request, wt, files, K, code_only=True)
    indexed = {f["path"] for f in files}
    full = full_ranked[:K]
    rel = ch["relevant"]
    return {
        "repo": c["repo"], "sha": c["sha"], "parent": c["parent"],
        "message": c["message"], "request": request, "keywords": sorted(keywords(request)),
        "names_a_file": names_a_file(request),
        "n_indexed_files": len(files),
        "relevant": rel, "added_excluded": ch["added"], "deleted_not_scored": ch["deleted"],
        "relevant_not_indexed": [p for p in rel if p not in indexed],
        "full_top10": full,
        "no_graph_top10": ablated,
        "baseline_top10": baseline,
        "baseline_code_top10": baseline_code,
        "metrics": {
            "full": metrics([r["path"] for r in full], rel),
            "no_graph": metrics([r["path"] for r in ablated], rel),
            "baseline": metrics([r["path"] for r in baseline], rel),
            "baseline_code": metrics([r["path"] for r in baseline_code], rel),
        },
        "relevant_diagnostics": {p: miss_reason(p, full_ranked, indexed) for p in rel},
    }


# --- aggregation and report ---------------------------------------------------

METHODS = ("full", "no_graph", "baseline", "baseline_code")
METHOD_LABEL = {"full": "full retrieve()", "no_graph": "no import graph", "baseline": "keyword-count baseline",
                "baseline_code": "keyword baseline, code files only*"}
METRIC_KEYS = ("recall", "hit", "precision", "rr")


def aggregate(rows: list[dict]) -> dict:
    n = len(rows)
    out = {"n": n}
    for m in METHODS:
        out[m] = {k: (sum(r["metrics"][m][k] for r in rows) / n if n else None) for k in METRIC_KEYS}
    full = [r["metrics"]["full"]["recall"] for r in rows]
    diff = [r["metrics"]["full"]["recall"] - r["metrics"]["no_graph"]["recall"] for r in rows]
    out["recall_ci_full"] = bootstrap_ci(full)
    out["recall_diff_full_minus_no_graph"] = sum(diff) / n if n else None
    out["recall_diff_ci"] = bootstrap_ci(diff)
    out["added_excluded"] = sum(len(r["added_excluded"]) for r in rows)
    out["relevant_files"] = sum(len(r["relevant"]) for r in rows)
    out["relevant_not_indexed"] = sum(len(r["relevant_not_indexed"]) for r in rows)
    out["names_a_file"] = sum(r["names_a_file"] for r in rows)
    return out


def summarize(rows: list[dict], repos: list[str]) -> dict:
    clean = [r for r in rows if not r["names_a_file"]]
    return {
        "per_repo": {name: aggregate([r for r in rows if r["repo"] == name]) for name in repos},
        "overall": aggregate(rows),
        "no_file_name_subset": {
            "per_repo": {name: aggregate([r for r in clean if r["repo"] == name]) for name in repos},
            "overall": aggregate(clean),
        },
    }


def _f(x) -> str:
    return "n/a" if x is None else f"{x:.3f}"


def _ci(ci) -> str:
    return "n/a" if ci[0] is None else f"[{ci[0]:.3f}, {ci[1]:.3f}]"


def _table(groups: dict[str, dict]) -> list[str]:
    lines = ["| Scope | N | Method | Recall@10 | Hit@10 | Precision@10 | MRR |",
             "|---|---|---|---|---|---|---|"]
    for scope, agg in groups.items():
        if not agg["n"]:
            lines.append(f"| {scope} | 0 | (no eligible commits) | | | | |")
            continue
        for m in METHODS:
            a = agg[m]
            lines.append(f"| {scope} | {agg['n']} | {METHOD_LABEL[m]} | {_f(a['recall'])} | {_f(a['hit'])} "
                         f"| {_f(a['precision'])} | {_f(a['rr'])} |")
    return lines


def pick_misses(rows: list[dict], n: int = 3) -> list[dict]:
    misses = [r for r in rows if r["metrics"]["full"]["hit"] == 0.0]
    picked, seen = [], set()
    for r in misses:  # one per repo first, then fill in sample order
        if r["repo"] not in seen:
            picked.append(r)
            seen.add(r["repo"])
    picked += [r for r in misses if r not in picked]
    return picked[:n]


def render_markdown(meta: dict, funnels: dict, rows: list[dict], summary: dict) -> str:
    repos = list(funnels)
    ov = summary["overall"]
    sub = summary["no_file_name_subset"]
    L = ["# Retrieval eval: Repository Context Engine", "",
         f"Generated by `eval/retrieval_eval.py`. Repo HEADs: "
         + ", ".join(f"{k} `{v[:10]}`" for k, v in meta["heads"].items()) + ".", "",
         "Each sampled commit's message (prefix and trailers removed) is the feature request; `retrieve(max_files=10)` "
         "runs on the parent commit in a temporary worktree; relevant files are the `.py/.js/.jsx/.ts/.tsx` files the "
         "commit modified that existed at the parent. Nothing was tuned on these commits.", "",
         "## Results (all sampled commits)", ""]
    L += _table({**{r: summary["per_repo"][r] for r in repos}, "**overall**": ov})
    L += ["", "## Confidence intervals (95%, percentile bootstrap, 1,000 resamples over commits, seed 0)", "",
          "| Scope | N | Recall@10 full | 95% CI | Full − no-graph | 95% CI |", "|---|---|---|---|---|---|"]
    for scope, agg in [*((r, summary["per_repo"][r]) for r in repos), ("**overall**", ov),
                       ("no-file-name subset", sub["overall"])]:
        if agg["n"]:
            L.append(f"| {scope} | {agg['n']} | {_f(agg['full']['recall'])} | {_ci(agg['recall_ci_full'])} "
                     f"| {agg['recall_diff_full_minus_no_graph']:+.3f} | {_ci(agg['recall_diff_ci'])} |")
    L += ["", "## Leakage: commits whose message names a file", "",
          f"{ov['names_a_file']} of {ov['n']} sampled commits name a file (e.g. `retriever.py`) in the message. "
          f"Same metrics on the remaining {sub['overall']['n']} commits:", ""]
    L += _table({**{r: sub["per_repo"][r] for r in repos}, "**overall**": sub["overall"]})
    L += ["", "## Sample and exclusions", "",
          "| Repo | non-merge | root | <5 words | no source change | >10 source files | only added sources "
          "| eligible | sampled | relevant files | added files excluded | relevant not indexed |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in repos:
        f, a = funnels[r], summary["per_repo"][r]
        L.append(f"| {r} | {f['non_merge']} | {f['root_commit']} | {f['short_message']} | {f['no_source_change']} "
                 f"| {f['too_many_source_files']} | {f['only_added_sources']} | {f['eligible']} | {f['sampled']} "
                 f"| {a['relevant_files']} | {a['added_excluded']} | {a['relevant_not_indexed']} |")
    for name, why in meta["skipped_repos"].items():
        L.append(f"| {name} | skipped: {why} | | | | | | | | | | |")
    L += ["", f"Added source files excluded from recall (cannot be retrieved): **{ov['added_excluded']}** "
          f"across {ov['n']} commits. The exact commit list is in `eval/results/sampled_commits.json`.", "",
          "## Example misses (Hit@10 = 0 for full retrieve())", ""]
    for i, r in enumerate(pick_misses(rows), 1):
        L += [f"### {i}. {r['repo']} `{r['sha'][:10]}`", "",
              f"> {r['request'].splitlines()[0][:200]}", "",
              f"- keywords after expansion: {', '.join(r['keywords']) or '(none)'}",
              *[f"- relevant `{p}`: {why}" for p, why in r["relevant_diagnostics"].items()],
              "- retrieved instead: " + ", ".join(f"`{x['path']}`" for x in r["full_top10"][:5])
              + (" …" if len(r["full_top10"]) > 5 else ""), ""]
    L += ["## Method notes and limits", "",
          "- *The code-files-only keyword baseline was added after a code review of this script found the "
          "specified baseline spends top-10 slots on `.md`/`.json` files that can never be relevant (113 of 350 "
          "slots were `.md`). The specified baseline is reported unchanged; this row is supplementary.",
          "- Precision@10 divides by 10 even when fewer files are returned; with ~1–3 relevant files per commit "
          "its ceiling is low by construction.",
          "- Ground truth is every modified source file, including incidental edits a reviewer might not call "
          "\"relevant\"; that biases recall down. Deleted files are not scored.",
          "- The leakage flag is a regex for `name.ext` tokens; it also flags names like `Node.js` (conservative).",
          "- Commits are sampled from `git log HEAD` of each repo; replay the exact list with `--commits`.",
          "- The no-import-graph ablation monkeypatches `retriever._import_edges` to return `{}` inside the eval "
          "process only; `retriever.py` is unchanged.", ""]
    return "\n".join(L)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repos", nargs="*", type=Path, default=DEFAULT_REPOS)
    ap.add_argument("--commits", type=Path, help="replay a saved sampled_commits.json instead of sampling")
    args = ap.parse_args()

    repos, skipped = [], {}
    for p in args.repos:
        p = p.expanduser().resolve()
        try:
            git(p, "rev-parse", "HEAD")
            repos.append(p)
        except (subprocess.CalledProcessError, FileNotFoundError, NotADirectoryError):
            skipped[p.name] = "missing or has no git history"

    saved = json.loads(args.commits.read_text()) if args.commits else None
    funnels, sampled = {}, {}
    for repo in repos:
        if saved:
            sampled[repo.name] = [c for c in saved["commits"] if c["repo"] == repo.name]
            funnels[repo.name] = saved["funnels"].get(repo.name, {"sampled": len(sampled[repo.name])})
        else:
            sampled[repo.name], funnels[repo.name] = sample_commits(repo)
        print(f"{repo.name}: {funnels[repo.name]}", flush=True)

    rows = []
    tmp_root = Path(tempfile.mkdtemp(prefix="gk-retrieval-eval-")).resolve()
    try:
        for repo in repos:
            for c in sampled[repo.name]:
                row = evaluate_commit(repo, c, tmp_root)
                rows.append(row)
                m = row["metrics"]
                print(f"  {repo.name} {c['sha'][:10]} R@10 full={m['full']['recall']:.2f} "
                      f"no-graph={m['no_graph']['recall']:.2f} base={m['baseline']['recall']:.2f}  "
                      f"{row['request'].splitlines()[0][:60]}", flush=True)
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    names = [r.name for r in repos]
    meta = {"k": K, "seed": SEED, "max_per_repo": MAX_PER_REPO, "bootstrap_resamples": N_BOOT,
            "min_words": MIN_WORDS, "max_source_files": MAX_SOURCE_FILES,
            "heads": {r.name: git(r, "rev-parse", "HEAD").strip() for r in repos}, "skipped_repos": skipped}
    summary = summarize(rows, names)
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "sampled_commits.json").write_text(json.dumps(
        {"meta": meta, "funnels": funnels,
         "commits": [c for n in names for c in sampled[n]]}, indent=1))
    (RESULTS / "retrieval_eval.json").write_text(json.dumps(
        {"meta": meta, "funnels": funnels, "summary": summary, "commits": rows}, indent=1))
    (RESULTS / "retrieval_eval.md").write_text(render_markdown(meta, funnels, rows, summary))
    print(json.dumps({"overall": summary["overall"], "no_file_name": summary["no_file_name_subset"]["overall"]},
                     indent=1))


if __name__ == "__main__":
    main()
