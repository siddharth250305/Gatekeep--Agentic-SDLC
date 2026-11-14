import pytest

from app.repository import scanner
from app.repository.manifest import build_manifest
from app.repository.retriever import retrieve, keywords
from app.repository.security import is_sensitive_path, redact_secrets, scan_secrets
from app.repository.tools import WorkspaceTools


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "services").mkdir()
    (tmp_path / "src" / "components").mkdir()
    (tmp_path / "tests").mkdir()
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "__pycache__").mkdir()

    (tmp_path / "src" / "auth.py").write_text(
        "from services.user_service import get_user\n\n"
        "def login(username, password):\n    return get_user(username)\n")
    (tmp_path / "src" / "services" / "user_service.py").write_text(
        "def get_user(name):\n    return {'name': name}\n")
    (tmp_path / "tests" / "test_auth.py").write_text(
        "from auth import login\n\ndef test_login():\n    assert login('a', 'b')\n")
    (tmp_path / "src" / "components" / "Dashboard.jsx").write_text(
        "export default function Dashboard() { return null }\n")
    (tmp_path / "requirements.txt").write_text("flask\n")
    (tmp_path / "README.md").write_text("# Sample\nA login app.\n")
    # ignored / excluded:
    (tmp_path / ".env").write_text('API_KEY="supersecretvalue123"\n')
    (tmp_path / "node_modules" / "junk.js").write_text("module.exports = 1\n")
    (tmp_path / "__pycache__" / "x.pyc").write_text("junk\n")
    (tmp_path / "logo.png").write_bytes(b"\x89PNG\x00\x00binary")
    return str(tmp_path)


# --- scanner --------------------------------------------------------------
def test_scanner_detects_languages_and_types(repo):
    by_path = {f["path"]: f for f in scanner.scan(repo)}
    assert by_path["src/auth.py"]["language"] == "python"
    assert by_path["src/auth.py"]["type"] == "source"
    assert by_path["src/components/Dashboard.jsx"]["language"] == "jsx"
    assert by_path["tests/test_auth.py"]["type"] == "test"
    assert by_path["requirements.txt"]["type"] == "dependency"
    assert by_path["README.md"]["type"] == "doc"


def test_scanner_ignores_junk_binary_and_secrets(repo):
    paths = {f["path"] for f in scanner.scan(repo)}
    assert ".env" not in paths                     # sensitive
    assert "logo.png" not in paths                 # binary
    assert not any(p.startswith("node_modules") for p in paths)
    assert not any("__pycache__" in p for p in paths)


# --- manifest -------------------------------------------------------------
def test_manifest(repo):
    m = build_manifest("https://x/y", "abc123", scanner.scan(repo))
    assert m["dependency_files"] == ["requirements.txt"]
    assert "tests/test_auth.py" in m["test_files"]
    assert "README.md" in m["documentation"]
    assert "python" in m["languages"] and "jsx" in m["languages"]


# --- retrieval ------------------------------------------------------------
def test_retrieval_login(repo):
    m = build_manifest("https://x/y", "abc", scanner.scan(repo))
    res = retrieve("Add login authentication", repo, m)
    paths = [r["path"] for r in res]
    assert "src/auth.py" in paths
    assert "tests/test_auth.py" in paths           # related test
    assert "src/services/user_service.py" in paths  # imported by auth
    # import relationship is explained
    us = next(r for r in res if r["path"].endswith("user_service.py"))
    assert any("imported by auth.py" in why for why in us["reasons"])
    # top result is the auth file
    assert res[0]["path"] == "src/auth.py"


def test_retrieval_react(repo):
    m = build_manifest("https://x/y", "abc", scanner.scan(repo))
    res = retrieve("Improve the React dashboard", repo, m)
    assert "src/components/Dashboard.jsx" in [r["path"] for r in res]


def test_keywords_expand_synonyms():
    kw = keywords("Add login")
    assert "auth" in kw and "authentication" in kw


# --- security -------------------------------------------------------------
def test_sensitive_paths():
    assert is_sensitive_path(".env")
    assert is_sensitive_path("config/secrets.json")
    assert is_sensitive_path("deploy/prod.pem")
    assert not is_sensitive_path("src/auth.py")


def test_secret_redaction():
    text = 'token = "ghp_' + "a" * 30 + '"\napi_key = "abcdef123456"'
    found = scan_secrets(text)
    assert "github_token" in found
    out, cats = redact_secrets(text)
    assert "ghp_" not in out
    assert "github_token" in cats


# --- tools ----------------------------------------------------------------
def test_tools_are_workspace_scoped(repo):
    t = WorkspaceTools(repo)
    assert "src/auth.py" in t.list_files()
    assert "def login" in t.read_file("src/auth.py")
    assert t.read_file(".env") == "<refused: sensitive file>"
    with pytest.raises(ValueError):
        t.read_file("../../../etc/passwd")
    # write + patch
    t.write_file("health.py", "def health():\n    return 'ok'\n")
    assert "health.py" in t.list_files()
    r = t.apply_patch("health.py", "return 'ok'", "return 'healthy'")
    assert r["applied"] is True
    assert "healthy" in t.read_file("health.py")


# ── D1: the workspace tools refuse .git ──────────────────────────────────

@pytest.mark.parametrize("path", [".git/config", "pkg/.git/HEAD", ".GIT/config"])
def test_workspace_tools_refuse_git_metadata(tmp_path, path):
    tools = WorkspaceTools(str(tmp_path))
    with pytest.raises(ValueError):
        tools.write_file(path, "[core]\n\tfsmonitor = /tmp/evil.sh\n")
    assert tools.read_file(path) == "<refused: sensitive file>"


@pytest.mark.parametrize("path", [".env", "config/prod.env", ".aws/credentials"])
def test_workspace_tools_refuse_writing_secret_files(tmp_path, path):
    """Covers the built-in pipeline agent too, which does not go through the MCP policy."""
    tools = WorkspaceTools(str(tmp_path))
    with pytest.raises(ValueError, match="sensitive"):
        tools.write_file(path, "X=1\n")
    with pytest.raises(ValueError, match="sensitive"):
        tools.apply_patch(path, "X", "Y")
    assert not (tmp_path / path).exists()


# ── D5: one block list, with the common secret files that were missing ──

@pytest.mark.parametrize("path", [
    ".aws/credentials", "home/.ssh/config", ".ssh/id_ed25519", "id_ecdsa", ".envrc", "prod.env",
    "infra/terraform.tfstate", "infra/terraform.tfstate.backup", "vars.tfvars", ".git-credentials",
    ".htpasswd", "AuthKey_ABC.p8", ".kube/config", ".docker/config.json", ".PGPASS", "Prod.ENV",
    "sub\\.aws\\credentials", ".git/config",
])
def test_previously_missed_secret_files_are_sensitive(path):
    assert is_sensitive_path(path)


@pytest.mark.parametrize("path", [
    "src/env.py", "keys/README.md", "id_rsa.pub", "src/identity.py", ".github/workflows/ci.yml",
    "docs/aws-setup.md", "environment.yml",
])
def test_normal_files_are_not_sensitive(path):
    assert not is_sensitive_path(path)


def test_policy_engine_uses_the_same_list():
    from app.mcp.policy import PolicyEngine
    from app.repository import security

    assert PolicyEngine.BLOCKED_FILE_PATTERNS is security.SENSITIVE_GLOBS
    engine = PolicyEngine()
    for path in [".aws/credentials", "id_ed25519", "prod.env", ".ssh/known_hosts"]:
        assert engine.check_file_access(path).allowed is False, path
    assert engine.check_file_access("src/app.py").allowed is True


# --- D2: shortcuts (symlinks) are checked by the real file behind them ----
import os

from app.diffing import workspace_diff
from app.repository.context import build_context


@pytest.fixture
def linked(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "id_rsa_copy.txt").write_text("OUTSIDE-SECRET-login\n")
    (ws / ".env").write_text("API_KEY=envsecret123456\n")
    (ws / "app.py").write_text("def login():\n    return 1\n")
    os.symlink(".env", ws / "config.py")                         # shortcut to a secret file
    os.symlink(str(outside / "id_rsa_copy.txt"), ws / "notes.py")  # shortcut out of the workspace
    os.symlink(str(outside), ws / "vendor_dir")                  # directory shortcut out of the workspace
    os.symlink("app.py", ws / "alias.py")                        # harmless shortcut inside
    return ws


@pytest.mark.parametrize("path", ["config.py", "notes.py", "vendor_dir/id_rsa_copy.txt"])
def test_reading_through_a_bad_shortcut_is_refused(linked, path):
    with pytest.raises(ValueError):
        WorkspaceTools(str(linked)).read_file(path)


@pytest.mark.parametrize("path", ["config.py", "notes.py", "vendor_dir/new.py"])
def test_writing_through_a_bad_shortcut_is_refused(linked, path):
    tools = WorkspaceTools(str(linked))
    with pytest.raises(ValueError):
        tools.write_file(path, "pwned\n")
    with pytest.raises(ValueError):
        tools.apply_patch(path, "API_KEY", "X")
    assert (linked / ".env").read_text() == "API_KEY=envsecret123456\n"
    assert not (linked.parent / "outside" / "new.py").exists()


def test_a_harmless_shortcut_inside_the_workspace_still_works(linked):
    assert "def login" in WorkspaceTools(str(linked)).read_file("alias.py")


def test_search_list_and_context_never_follow_bad_shortcuts(linked):
    tools = WorkspaceTools(str(linked))
    listed = set(tools.list_files())
    assert {"config.py", "notes.py"}.isdisjoint(listed)
    assert not any(p.startswith("vendor_dir") for p in listed)
    for query in ("envsecret", "OUTSIDE-SECRET"):
        assert tools.search_code(query) == []
    ctx = build_context(str(linked), "login notes config", "u", "c")
    text = repr(ctx)
    assert "OUTSIDE-SECRET" not in text and "envsecret" not in text


def test_the_retriever_does_not_read_through_bad_shortcuts(linked):
    manifest = {"files": [{"path": p, "type": "source", "language": "python"}
                          for p in ("config.py", "notes.py", "app.py")]}
    ranked = {r["path"]: r for r in retrieve("outside secret envsecret", str(linked), manifest)}
    for path in ("config.py", "notes.py"):
        assert not any("references" in reason for reason in ranked.get(path, {}).get("reasons", []))


# --- D3: secrets are hidden in every text that leaves GateKeep ------------

def test_a_whole_private_key_block_is_hidden():
    key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\nAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----"
    out, cats = redact_secrets(f"before\n{key}\nafter\n")
    assert "b3BlbnNzaC1rZXktdjEAAAA" not in out and "AAAABG5vbmUAAAAEbm9uZQ" not in out
    assert out.startswith("before\n") and out.endswith("after\n")
    assert "private_key_block" in cats


def test_a_private_key_with_no_end_line_is_hidden_to_the_end():
    out, _ = redact_secrets("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nmore\n")
    assert "MIIEowIBAAKCAQEA" not in out and "more" not in out


@pytest.mark.parametrize("text, secret", [
    ("password: hello1234\n", "hello1234"),                 # unquoted YAML
    ("  db_password: s3cr3tvalue\n", "s3cr3tvalue"),
    ("DB_PASSWORD=hunter2hunter2\n", "hunter2hunter2"),     # .env
    ("export AWS_SECRET_ACCESS_KEY=abcdEFGH1234\n", "abcdEFGH1234"),
    ('{"api_key": "abcd1234efgh"}', "abcd1234efgh"),        # JSON
    ("+SECRET_KEY=diffsecret999\n", "diffsecret999"),       # a line in a diff
])
def test_unquoted_and_json_secrets_are_hidden(text, secret):
    out, _ = redact_secrets(text)
    assert secret not in out
    assert "***" in out


@pytest.mark.parametrize("code", [
    "password = get_password()\n",
    "def check(password: str) -> bool:\n",
    "    password=password,\n",
    "if password == expected:\n",
])
def test_ordinary_code_about_passwords_is_left_alone(code):
    assert redact_secrets(code)[0] == code


def test_search_results_are_redacted_and_cannot_find_secret_values(tmp_path):
    (tmp_path / "settings.py").write_text('API_KEY = "sk_live_abcdef123456"\n')
    tools = WorkspaceTools(str(tmp_path))
    [hit] = tools.search_code("API_KEY")
    assert "sk_live_abcdef123456" not in hit["text"]
    # Searching for the value itself must not reveal that it exists.
    assert tools.search_code("sk_live_abc") == []


def test_workspace_diff_is_redacted(tmp_path):
    import subprocess
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "config.yml").write_text("password: plain-old-value\n")
    diff = workspace_diff(str(tmp_path))
    assert "config.yml" in diff
    assert "plain-old-value" not in diff


def test_redaction_stays_fast_on_huge_lines():
    # Review finding #1: a 100k-character line (minified code, a blob) must not hang redaction.
    import time
    started = time.perf_counter()
    redact_secrets("a" * 100_000)
    redact_secrets("x_" * 50_000 + "password: hunter2hunter2\n")
    assert time.perf_counter() - started < 1.0


@pytest.mark.parametrize("text, secret", [
    ("STRIPE = 'sk_live_51HabcdefGHIJKL0123'", "sk_live_51HabcdefGHIJKL0123"),
    ("key = sk-ant-api03-abcdefghijklmnop", "sk-ant-api03-abcdefghijklmnop"),
    ("DATABASE_URL=postgres://app:s3cretpw@db:5432/x", "s3cretpw"),
    ("url = 'https://bob:hunter22@example.com/repo.git'", "hunter22"),
    ("Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="),
])
def test_vendor_keys_and_url_credentials_are_hidden(text, secret):
    assert secret not in redact_secrets(text)[0]


def test_the_review_diff_shows_files_hidden_by_gitignore(tmp_path):
    # Security review #3: what runs in the sandbox must be visible to the reviewer.
    import subprocess
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / ".gitignore").write_text("conftest.py\n")
    (tmp_path / "conftest.py").write_text("print('rewrites the report')\n")
    (tmp_path / "evil__pycache__").mkdir()
    (tmp_path / "evil__pycache__" / "x.py").write_text("y = 1\n")
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "__pycache__" / "a.pyc").write_bytes(b"\x00")
    diff = workspace_diff(str(tmp_path))
    assert "b/conftest.py" in diff
    assert "b/evil__pycache__/x.py" in diff
    assert "__pycache__/a.pyc" not in diff
