import base64

import pytest

from app.workspace import _clone_url, _git_env, is_git_url, validate_run_id


def test_is_git_url_distinguishes_real_repos_from_labels():
    assert is_git_url("octocat/Hello-World") is True
    assert is_git_url("https://github.com/octocat/Hello-World.git") is True
    assert is_git_url("git@github.com:octocat/Hello-World.git") is True
    # plain labels used by the demo runs are NOT fetched
    assert is_git_url("commerce-core") is False
    assert is_git_url("") is False
    assert is_git_url(None) is False


def test_clone_url_normalizes_without_embedding_a_token():
    assert _clone_url("octocat/Hello-World") == "https://github.com/octocat/Hello-World.git"
    assert _clone_url("https://github.com/x/y.git") == "https://github.com/x/y.git"


def test_token_goes_to_git_via_env_not_the_url():
    # D4: a token in the URL ends up in .git/config, which the agent can read.
    env = _git_env("https://github.com/x/y.git", "TOK")
    assert env["GIT_CONFIG_KEY_0"] == "http.extraHeader"
    expected = base64.b64encode(b"x-access-token:TOK").decode()
    assert env["GIT_CONFIG_VALUE_0"] == f"Authorization: Basic {expected}"


def test_token_is_never_sent_to_other_hosts():
    env = _git_env("https://evil.example.com/x/y.git", "TOK")
    assert "http.extraHeader" not in env.values()


@pytest.mark.parametrize("run_id", ["RUN-1004", "run_1", "A" * 64])
def test_validate_run_id_accepts_normal_ids(run_id):
    assert validate_run_id(run_id) == run_id


@pytest.mark.parametrize("run_id", ["..", ".", "../agents", "a/b", "a\\b", "", "A" * 65, "RUN 1", None])
def test_validate_run_id_rejects_path_tricks(run_id):
    # D6: run ids become folder names, so ".." would escape workspaces/.
    with pytest.raises(ValueError):
        validate_run_id(run_id)
