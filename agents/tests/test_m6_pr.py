"""I6 on the agent side: a finished run becomes a GitHub Pull Request.

The agent service holds the workspace and the GitHub token, so it pushes the
approved code on a gatekeep/<run> branch with the signed evidence bundle in
.gatekeep/evidence/<run>.json, and opens the PR with the description the
backend wrote. It refuses unless the workspace is still exactly the approved
code (fail closed)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main, pr
from app.fingerprint import tree_fingerprint
from app.llm import CANNED, CODE_FILES
from app.workspace import fetch_repo


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
def origin(tmp_path):
    """A bare 'GitHub' remote with one commit on main."""
    seed = tmp_path / "seed"
    seed.mkdir()
    git(seed, "init", "-q", "-b", "main")
    (seed / "app.py").write_text("x = 1\n")
    (seed / ".gitignore").write_text("*.log\n")
    git(seed, "add", "-A")
    git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base")
    bare = tmp_path / "origin.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(seed), str(bare)], check=True)
    return bare


@pytest.fixture
def workspace(origin, tmp_path):
    out = fetch_repo("RUN-PR", f"file://{origin}", branch="main", root=tmp_path / "ws")
    ws = Path(out["path"])
    (ws / "app.py").write_text("x = 2\n")
    (ws / "test_app.py").write_text("def test_req_1_x():\n    assert True\n")
    return ws


class FakeGitHub:
    def __init__(self, status=201):
        self.requests: list[httpx.Request] = []
        self.status = status

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not 200 <= self.status < 300:
            return httpx.Response(self.status, json={"message": "Validation Failed"})
        return httpx.Response(self.status, json={"html_url": "https://github.com/acme/shop/pull/7", "number": 7})


def evidence_for(ws: Path, run_id="RUN-PR") -> dict:
    return {"format": "gatekeep-evidence/1", "run": {"id": run_id}, "code": {"fingerprint": tree_fingerprint(str(ws))}}


def create(ws, gh, **overrides):
    args = dict(workspace=str(ws), run_id="RUN-PR", repo="acme/shop", base="main", title="GateKeep RUN-PR: x",
                body="## Approval history\n...", evidence=evidence_for(ws), token="ghp_test",
                transport=httpx.MockTransport(gh.handler))
    args.update(overrides)
    return pr.create_pull_request(**args)


def test_the_approved_code_and_its_evidence_are_pushed_and_the_pr_is_opened(workspace, origin):
    gh = FakeGitHub()
    out = create(workspace, gh)
    assert out == {"url": "https://github.com/acme/shop/pull/7", "number": 7, "branch": "gatekeep/RUN-PR"}

    files = git(origin, "ls-tree", "-r", "--name-only", "gatekeep/RUN-PR").splitlines()
    assert ".gatekeep/evidence/RUN-PR.json" in files
    assert git(origin, "show", "gatekeep/RUN-PR:app.py") == "x = 2"
    stored = json.loads(git(origin, "show", "gatekeep/RUN-PR:.gatekeep/evidence/RUN-PR.json"))
    assert stored["code"]["fingerprint"] == tree_fingerprint(str(workspace))

    (req,) = gh.requests
    assert req.url == "https://api.github.com/repos/acme/shop/pulls"
    assert req.headers["authorization"] == "Bearer ghp_test"
    sent = json.loads(req.content)
    assert sent == {"title": "GateKeep RUN-PR: x", "head": "gatekeep/RUN-PR", "base": "main",
                    "body": "## Approval history\n..."}


def test_code_changed_after_approval_is_refused_and_nothing_is_pushed(workspace, origin):
    evidence = evidence_for(workspace)
    (workspace / "app.py").write_text("x = 3  # slipped in after approval\n")
    gh = FakeGitHub()
    with pytest.raises(pr.PullRequestError) as err:
        create(workspace, gh, evidence=evidence)
    assert err.value.code == "code_changed"
    assert "gatekeep/RUN-PR" not in git(origin, "branch", "--list")
    assert gh.requests == []


def test_an_ignored_file_that_the_commit_would_drop_is_refused(workspace, origin):
    (workspace / "debug.log").write_text("ignored by .gitignore but part of the reviewed code\n")
    gh = FakeGitHub()
    with pytest.raises(pr.PullRequestError) as err:
        create(workspace, gh)
    assert err.value.code == "commit_mismatch"
    assert gh.requests == []


def test_a_file_hidden_from_review_cannot_ship_in_the_pr(workspace, origin):
    # Review: anything the fingerprint leaves out (except the evidence file) must not be committed.
    (workspace / "__pycache__").mkdir()
    (workspace / "__pycache__" / "evil.py").write_text("evil = 1\n")
    gh = FakeGitHub()
    with pytest.raises(pr.PullRequestError) as err:
        create(workspace, gh)
    assert err.value.code == "hidden_files"
    assert gh.requests == []
    assert "gatekeep/RUN-PR" not in git(origin, "branch", "--list")


def test_a_shortcut_on_the_evidence_path_is_refused(workspace, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (workspace / ".gatekeep").symlink_to(outside)
    with pytest.raises(pr.PullRequestError) as err:
        create(workspace, FakeGitHub())
    assert err.value.code == "unsafe_evidence_path"
    assert list(outside.iterdir()) == []


def test_an_existing_pr_for_the_branch_is_returned_instead_of_failing(workspace):
    # Review: the PR may exist already (an earlier answer was lost); a retry returns it.
    def handler(request):
        if request.method == "POST":
            return httpx.Response(422, json={"message": "Validation Failed",
                                             "errors": [{"message": "A pull request already exists for acme:gatekeep/RUN-PR."}]})
        assert request.url.params["head"] == "acme:gatekeep/RUN-PR"
        return httpx.Response(200, json=[{"html_url": "https://github.com/acme/shop/pull/7", "number": 7}])

    out = create(workspace, FakeGitHub(), transport=httpx.MockTransport(handler))
    assert out["number"] == 7


@pytest.mark.parametrize("repo", ["", "my-local-label", "/tmp/somewhere", "https://gitlab.com/a/b"])
def test_only_github_repositories_get_a_pull_request(workspace, repo):
    with pytest.raises(pr.PullRequestError) as err:
        create(workspace, FakeGitHub(), repo=repo)
    assert err.value.code == "no_github_repo"


def test_a_token_is_needed(workspace):
    with pytest.raises(pr.PullRequestError) as err:
        create(workspace, FakeGitHub(), token="")
    assert err.value.code == "no_token"


def test_github_urls_are_understood():
    assert pr.github_slug("acme/shop") == "acme/shop"
    assert pr.github_slug("https://github.com/acme/shop.git") == "acme/shop"
    assert pr.github_slug("https://github.com/acme/shop") == "acme/shop"
    assert pr.github_slug("git@github.com:acme/shop.git") == "acme/shop"
    assert pr.github_slug("https://evil.com/github.com/acme/shop") is None


def test_any_success_status_from_github_counts(workspace):
    # Found in the live check: a 200 answer was reported as a refusal.
    assert create(workspace, FakeGitHub(status=200))["number"] == 7


def test_after_a_github_failure_the_pr_can_be_created_again(workspace, origin):
    # Found in the live check: the branch is pushed before the GitHub call,
    # so a retry must work on a workspace that already has the PR commit.
    with pytest.raises(pr.PullRequestError):
        create(workspace, FakeGitHub(status=503))
    out = create(workspace, FakeGitHub())
    assert out["number"] == 7
    assert git(origin, "show", "gatekeep/RUN-PR:app.py") == "x = 2"


def test_a_github_error_is_reported_without_the_token(workspace):
    with pytest.raises(pr.PullRequestError) as err:
        create(workspace, FakeGitHub(status=422))
    assert err.value.code == "github_refused"
    assert "ghp_test" not in str(err.value)


# ── the service endpoint ─────────────────────────────────────────────────

client = TestClient(main.app)


def test_the_endpoint_needs_the_backend_secret(monkeypatch):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    r = client.post("/pipeline/RUN-PR/pull-request", json={}, headers={"x-gatekeep-pipeline-secret": "wrong"})
    assert r.status_code == 401


def test_the_endpoint_maps_a_refusal_to_409(monkeypatch, tmp_path):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    monkeypatch.setattr(main, "WORKSPACES", tmp_path)

    def refuse(**_):
        raise pr.PullRequestError("code_changed", "the code changed since approval")

    monkeypatch.setattr(pr, "create_pull_request", refuse)
    r = client.post("/pipeline/RUN-PR/pull-request", headers={"x-gatekeep-pipeline-secret": "s3cret-value"},
                    json={"title": "t", "body": "b", "evidence": {}, "repo": "acme/shop", "base": "main"})
    assert r.status_code == 409
    assert r.json()["reason"] == "code_changed"


def test_the_endpoint_returns_the_pr(monkeypatch, tmp_path):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    monkeypatch.setenv("GIT_TOKEN", "ghp_env")
    monkeypatch.setattr(main, "WORKSPACES", tmp_path)
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return {"url": "https://github.com/acme/shop/pull/7", "number": 7, "branch": "gatekeep/RUN-PR"}

    monkeypatch.setattr(pr, "create_pull_request", fake)
    r = client.post("/pipeline/RUN-PR/pull-request", headers={"x-gatekeep-pipeline-secret": "s3cret-value"},
                    json={"title": "t", "body": "b", "evidence": {"x": 1}, "repo": "acme/shop", "base": "main"})
    assert r.status_code == 200
    assert r.json()["number"] == 7
    assert seen["workspace"] == str(tmp_path / "RUN-PR")
    assert seen["token"] == "ghp_env"


# ── what the built-in pipeline writes is structured (I2, I3) ─────────────

def test_the_offline_model_writes_requirements_with_ids_a_file_plan_and_linked_tests():
    assert "REQ-1:" in CANNED["requirements"]
    assert "## Files" in CANNED["design"]
    for path in CODE_FILES:
        assert f"`{path}`" in CANNED["design"], path
    assert "def test_req_1_" in CODE_FILES["test_throttle.py"]


def test_the_prompts_ask_real_models_for_the_same_structure():
    from app.graph import SYSTEM_PROMPTS
    assert "REQ-1" in SYSTEM_PROMPTS["requirements"]
    assert "## Files" in SYSTEM_PROMPTS["design"]
    assert "test_req_" in SYSTEM_PROMPTS["coding"]
