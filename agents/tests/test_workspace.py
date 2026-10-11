from app.workspace import is_git_url, _clone_url


def test_is_git_url_distinguishes_real_repos_from_labels():
    assert is_git_url("octocat/Hello-World") is True
    assert is_git_url("https://github.com/octocat/Hello-World.git") is True
    assert is_git_url("git@github.com:octocat/Hello-World.git") is True
    # plain labels used by the demo runs are NOT fetched
    assert is_git_url("commerce-core") is False
    assert is_git_url("") is False
    assert is_git_url(None) is False


def test_clone_url_normalizes_and_injects_token():
    assert _clone_url("octocat/Hello-World", None) == "https://github.com/octocat/Hello-World.git"
    assert _clone_url("https://github.com/x/y.git", None) == "https://github.com/x/y.git"
    assert _clone_url("https://github.com/x/y.git", "TOK") == "https://TOK@github.com/x/y.git"
