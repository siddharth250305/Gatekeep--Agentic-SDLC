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
