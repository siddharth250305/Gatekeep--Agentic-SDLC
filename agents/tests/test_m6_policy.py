"""Milestone 6 on the agent side.

I5: gatekeep.yaml is read from the base commit, recorded once with the backend
(which validates it), and enforced by GateKeepTools on every tool call:
forbidden paths, denied tools, and, with design enforcement on, writes outside
the approved design (I2). The shared definitions (path patterns, the code
fingerprint, the deniable tools) agree with the Node backend."""

from __future__ import annotations

import hashlib
import importlib
import json
import re
import subprocess
from pathlib import Path

import httpx
import pytest

from app import fingerprint, project_policy
from app.mcp.policy import PolicyEngine
from app.mcp.session import SessionManager
from app.mcp.tools import GateKeepTools
from app.sandbox import FakeRunner
from tests.conftest import BASE

REPO = Path(__file__).resolve().parents[2]
GLOBS = json.loads((REPO / "backend/test/fixtures/glob-cases.json").read_text())["cases"]


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout


def git_repo(path: Path, files: dict[str, str]) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    git(path, "init", "-q", "-b", "main")
    for rel, text in files.items():
        (path / rel).parent.mkdir(parents=True, exist_ok=True)
        (path / rel).write_text(text)
    git(path, "add", "-A")
    git(path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base")
    return path


# ── shared definitions ───────────────────────────────────────────────────

@pytest.mark.parametrize("pattern,path,expected", GLOBS)
def test_path_patterns_match_the_backend_definition(pattern, path, expected):
    assert project_policy.glob_match(pattern, path) is expected


def test_the_fingerprint_skips_gatekeep_evidence_like_the_backend(tmp_path):
    files = {"a.py": "print(1)\n", "pkg/b.txt": "hé\n", "pkg/sub/c.md": "# c\n",
             "__pycache__/x.pyc": "junk", ".gatekeep/evidence/r.json": "{}", ".git/HEAD": "ref: x\n"}
    for rel, text in files.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(text.encode())
    # Same constant as backend/test/m6-evidence.test.js (computed independently).
    assert fingerprint.tree_fingerprint(str(tmp_path)) == \
        "c3564b6308bf05e4b1af33e023d0176703d87939c77b406ae2f6da2298ed8f87"


def test_every_tool_the_backend_lets_a_policy_deny_exists_here():
    src = (REPO / "backend/src/policy/policy.js").read_text()
    block = re.search(r"ROBOT_TOOLS\s*=\s*\[(.*?)\]", src, re.S)
    assert block, "ROBOT_TOOLS not found in policy.js"
    names = re.findall(r"'([a-z_]+)'", block.group(1))
    assert names
    for name in names:
        assert name in PolicyEngine.TOOL_PERMISSIONS, name


def test_the_workspace_root_can_be_set_per_deployment(monkeypatch, tmp_path):
    from app import workspace
    monkeypatch.setenv("GATEKEEP_WORKSPACE_ROOT", str(tmp_path / "ws"))
    try:
        assert importlib.reload(workspace).WORKSPACES == tmp_path / "ws"
    finally:
        monkeypatch.delenv("GATEKEEP_WORKSPACE_ROOT")
        importlib.reload(workspace)
    assert workspace.WORKSPACES.name == "workspaces"


# ── reading gatekeep.yaml ────────────────────────────────────────────────

def test_the_policy_is_read_from_the_base_commit_not_the_working_tree(tmp_path):
    text = "forbidden_paths:\n  - infra/**\n"
    ws = git_repo(tmp_path / "ws", {"gatekeep.yaml": text})
    (ws / "gatekeep.yaml").write_text("forbidden_paths: []\n")  # an uncommitted edit changes nothing
    out = project_policy.load_policy_file(str(ws))
    assert out == {"found": True, "sha256": hashlib.sha256(text.encode()).hexdigest(),
                   "content": {"forbidden_paths": ["infra/**"]}}


def test_no_policy_file_means_found_false(tmp_path):
    assert project_policy.load_policy_file(str(git_repo(tmp_path / "ws", {"a.py": "x"}))) == {"found": False}


def test_a_yaml_error_is_reported_not_ignored(tmp_path):
    ws = git_repo(tmp_path / "ws", {"gatekeep.yaml": "forbidden_paths: [a\n  b: c"})
    out = project_policy.load_policy_file(str(ws))
    assert out["found"] is True and "error" in out and "content" not in out


def test_yaml_is_parsed_safely(tmp_path):
    ws = git_repo(tmp_path / "ws", {"gatekeep.yaml": "x: !!python/object/apply:os.system ['echo pwned']\n"})
    out = project_policy.load_policy_file(str(ws))
    assert "error" in out


def test_a_workspace_without_git_reads_the_file_on_disk(tmp_path):
    (tmp_path / "gatekeep.yaml").write_text("tools:\n  deny: [search_code]\n")
    assert project_policy.load_policy_file(str(tmp_path))["content"] == {"tools": {"deny": ["search_code"]}}


# ── enforcement in GateKeepTools ─────────────────────────────────────────

@pytest.fixture
def core(node, tmp_path):
    return GateKeepTools(SessionManager(base_url=BASE), base_url=BASE, runner=FakeRunner(), workspaces=tmp_path)


def code_run(node, core, policy_yaml: str | None, run_id="RUN-P"):
    node.add_run(run_id, step="code")
    files = {"app.py": "x = 1\n"}
    if policy_yaml is not None:
        files["gatekeep.yaml"] = policy_yaml
    git_repo(core.workspaces / run_id, files)
    return core.session_manager.create_session(run_id).session_id


def policy_puts(node, run_id="RUN-P"):
    return [c for c in node.calls if c[:2] == ("PUT", f"/runs/{run_id}/policy")]


def test_the_first_workspace_tool_records_the_policy_once(node, core):
    sid = code_run(node, core, "forbidden_paths: ['infra/**']\n")
    assert "error" not in core.write_file(sid, "app.py", "x = 2\n")
    assert "error" not in core.write_file(sid, "lib.py", "y = 1\n")
    puts = policy_puts(node)
    assert len(puts) == 1
    assert puts[0][2]["content"] == {"forbidden_paths": ["infra/**"]}
    assert node.runs["RUN-P"]["policy"]["status"] == "loaded"


def test_a_forbidden_path_is_refused_and_audited(node, core):
    sid = code_run(node, core, "forbidden_paths: ['infra/**', 'migrations/*.sql']\n")
    for path in ("infra/main.tf", "migrations/001_drop_users.sql"):
        out = core.write_file(sid, path, "x")
        assert "gatekeep.yaml" in out["error"], out
        assert not (core.workspaces / "RUN-P" / path).exists()
    out = core.apply_patch(sid, "infra/main.tf", "a", "b")
    assert "forbidden" in out["error"]
    assert node.events("RUN-P").count("mcp.policy.denied") == 3


def test_the_policy_file_itself_and_gatekeep_evidence_are_never_writable(node, core):
    sid = code_run(node, core, None)
    for path in ("gatekeep.yaml", "sub/../gatekeep.yaml", ".gatekeep/evidence/RUN-P.json", "GATEKEEP.YAML"):
        out = core.write_file(sid, path, "forbidden_paths: []\n")
        assert "error" in out, path
    assert (core.workspaces / "RUN-P" / "gatekeep.yaml").exists() is False


def test_a_tool_the_policy_denies_is_refused(node, core):
    sid = code_run(node, core, "tools:\n  deny: [search_code]\n")
    out = core.search_code(sid, "x")
    assert "denied by gatekeep.yaml" in out["error"]
    assert "mcp.policy.denied" in node.events("RUN-P")


def test_with_design_enforcement_only_planned_files_can_be_written(node, core):
    sid = code_run(node, core, "design:\n  enforce: block\n")
    node.runs["RUN-P"]["trace"] = {"plan": {"files": [
        {"path": "app.py", "change": "modify", "reqs": ["REQ-1"]},
        {"path": "tests/**", "change": "create", "reqs": ["REQ-1"]},
    ]}}
    assert "error" not in core.write_file(sid, "app.py", "x = 2\n")
    assert "error" not in core.write_file(sid, "tests/test_app.py", "def test_req_1(): pass\n")
    out = core.write_file(sid, "payments.py", "steal = True\n")
    assert "not in the approved design" in out["error"]
    assert not (core.workspaces / "RUN-P" / "payments.py").exists()


def test_design_enforcement_without_a_plan_refuses_every_write(node, core):
    sid = code_run(node, core, "design:\n  enforce: block\n")
    assert "approved design" in core.write_file(sid, "app.py", "x = 2\n")["error"]


def test_an_invalid_policy_stops_every_tool_but_status(node, core):
    sid = code_run(node, core, "protect: [x]\n")
    out = core.write_file(sid, "app.py", "x = 2\n")
    assert "gatekeep.yaml is invalid" in out["error"]
    assert "error" in core.read_file(sid, "app.py")
    assert "error" not in core.get_run(sid)


def test_if_the_policy_cannot_be_recorded_nothing_is_written(node, core, monkeypatch):
    sid = code_run(node, core, "forbidden_paths: []\n")
    real = node.respond

    def down_for_policy(method, url, json=None, **kw):
        if method == "PUT" and url.endswith("/policy"):
            raise httpx.ConnectError("down", request=httpx.Request(method, url))
        return real(method, url, json=json, **kw)

    monkeypatch.setattr(httpx, "put", lambda url, **kw: down_for_policy("PUT", url, **kw))
    out = core.write_file(sid, "app.py", "x = 2\n")
    assert "policy" in out["error"]
    assert (core.workspaces / "RUN-P" / "app.py").read_text() == "x = 1\n"


def test_request_approval_records_the_policy_before_handing_over(node, core):
    sid = code_run(node, core, None)
    out = core.request_approval(sid, "done")
    assert out["requested"] is True
    paths = [c[1] for c in node.calls if c[0] in ("PUT", "POST")]
    assert paths.index("/runs/RUN-P/policy") < paths.index("/runs/RUN-P/actions/request_review")


def test_phase_refusals_come_first_and_do_not_read_the_policy(node, core):
    node.add_run("RUN-Q", step="design")
    git_repo(core.workspaces / "RUN-Q", {"gatekeep.yaml": "forbidden_paths: []\n"})
    sid = core.session_manager.create_session("RUN-Q").session_id
    assert "not allowed in phase" in core.write_file(sid, "app.py", "x")["error"]
    assert not policy_puts(node, "RUN-Q")


def test_the_agent_context_tells_the_robot_the_project_rules(node, core):
    sid = code_run(node, core, "forbidden_paths: ['infra/**']\n")
    core.write_file(sid, "app.py", "x = 2\n")
    ctx = core.get_agent_context(sid)
    assert any("infra/**" in r for r in ctx["restrictions"])
    assert any("REQ-" in r for r in ctx["restrictions"])


# ── ECC review findings ──────────────────────────────────────────────────

def test_only_the_top_level_gatekeep_folder_is_left_out_of_the_fingerprint(tmp_path):
    files = {"a.py": "print(1)\n", "pkg/b.txt": "hé\n", "pkg/sub/c.md": "# c\n",
             "__pycache__/x.pyc": "junk", ".gatekeep/evidence/r.json": "{}", ".git/HEAD": "ref: x\n",
             "pkg/.gatekeep/payload.py": "evil = 1\n", "\U0001F600.txt": "a\n", "\uFFFD.txt": "b\n"}
    for rel, text in files.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(text.encode())
    # Same constant as backend/test/m6-evidence.test.js (computed independently).
    assert fingerprint.tree_fingerprint(str(tmp_path)) == \
        "c55a8d8579bfe7a56d6d3ecebc2f76f27c9adcb5e8c806f8f96ed73c3d7ba56a"


@pytest.mark.parametrize("path", ["pkg/.gatekeep/payload.py", "a/__pycache__/x.py", ".pytest_cache/v/x",
                                  "PKG/.GateKeep/x.py", "src/__PYCACHE__/m.py"])
def test_hidden_folders_can_never_be_written_by_the_robot(node, core, path):
    sid = code_run(node, core, None)
    out = core.write_file(sid, path, "evil = 1\n")
    assert "error" in out, path
    assert not (core.workspaces / "RUN-P" / path).exists()


def test_a_shortcut_into_gatekeep_is_refused(node, core):
    sid = code_run(node, core, None)
    ws = core.workspaces / "RUN-P"
    (ws / ".gatekeep").mkdir()
    (ws / "alias").symlink_to(".gatekeep")
    out = core.write_file(sid, "alias/payload.py", "evil = 1\n")
    assert "error" in out
    assert not (ws / ".gatekeep" / "payload.py").exists()


@pytest.mark.parametrize("path", ["app\nx.py", "a\rb.py", "a\x00b.py", "app/\x1b[31m.py"])
def test_control_characters_in_paths_are_refused(node, core, path):
    sid = code_run(node, core, None)
    assert "error" in core.write_file(sid, path, "x")


def test_forbidden_paths_also_match_other_letter_cases(node, core):
    # macOS and Windows file systems ignore case: INFRA/ is infra/.
    sid = code_run(node, core, "forbidden_paths: ['infra/**']\n")
    out = core.write_file(sid, "INFRA/deploy.sh", "x")
    assert "forbidden" in out["error"]


def test_a_git_error_is_not_mistaken_for_no_policy_file(tmp_path, monkeypatch):
    ws = git_repo(tmp_path / "ws", {"gatekeep.yaml": "forbidden_paths: ['infra/**']\n"})
    real = subprocess.run

    def broken_git(args, *a, **kw):
        if "show" in args or "cat-file" in args:
            return subprocess.CompletedProcess(args, 128, b"", b"fatal: detected dubious ownership")
        return real(args, *a, **kw)

    monkeypatch.setattr(project_policy.subprocess, "run", broken_git)
    with pytest.raises(subprocess.SubprocessError):
        project_policy.load_policy_file(str(ws))


def test_a_git_error_while_reading_the_policy_stops_the_write(node, core, monkeypatch):
    sid = code_run(node, core, "forbidden_paths: ['infra/**']\n")

    def fail(_ws):
        raise subprocess.CalledProcessError(128, "git")

    monkeypatch.setattr("app.mcp.tools.load_policy_file", fail)
    out = core.write_file(sid, "infra/x.sh", "x")
    assert "policy" in out["error"]
    assert node.runs["RUN-P"]["policy"] is None


@pytest.mark.parametrize("text", ["since: 2024-01-01\n", "a: &x [1, 2]\nb: *x\n",
                                  "a: &a [*a]\n"])
def test_yaml_that_is_not_plain_data_is_an_error_not_a_crash(tmp_path, text):
    ws = git_repo(tmp_path / "ws", {"gatekeep.yaml": text})
    out = project_policy.load_policy_file(str(ws))
    assert out["found"] is True and "error" in out, out
