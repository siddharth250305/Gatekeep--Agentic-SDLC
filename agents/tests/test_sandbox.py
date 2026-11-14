import pytest
from app.sandbox import SandboxRunner, docker_available

needs_docker = pytest.mark.skipif(
    not docker_available(), reason="Docker or the gatekeep-sandbox image is not available"
)

PASSING = {
    "throttle.py": "def is_allowed(count, limit=60):\n    return count <= limit\n",
    "test_throttle.py": (
        "from throttle import is_allowed\n\n"
        "def test_a():\n    assert is_allowed(1)\n\n"
        "def test_b():\n    assert not is_allowed(61)\n"
    ),
}

FAILING = {
    "throttle.py": "def is_allowed(count, limit=60):\n    return True  # bug\n",
    "test_throttle.py": (
        "from throttle import is_allowed\n\n"
        "def test_over_limit():\n    assert not is_allowed(61)\n"
    ),
}


@needs_docker
def test_sandbox_runs_a_passing_suite():
    res = SandboxRunner().run(PASSING)
    assert res["passed"] == 2
    assert res["failed"] == 0
    assert res["exit_code"] == 0
    assert res["timed_out"] is False


@needs_docker
def test_sandbox_detects_a_failing_suite():
    res = SandboxRunner().run(FAILING)
    assert res["failed"] >= 1
    assert res["exit_code"] != 0


# ── Milestone 3 helpers: a fake `docker run` that writes a JUnit report ──

import os
import subprocess as _sp
from pathlib import Path

_REAL_RUN = _sp.run  # git calls in the code under test still run for real


def _mount(args, target):
    """The host directory mounted at *target* in a docker run argument list."""
    for i, a in enumerate(args):
        if a == "-v" and args[i + 1].split(":")[1] == target:
            return args[i + 1].split(":")[0]
    raise AssertionError(f"no {target} mount in {args}")


def _junit(cases):
    rows = []
    for name, file, outcome in cases:
        body = {"failed": '<failure message="boom"/>', "error": '<error message="err"/>',
                "skipped": '<skipped message="skip"/>'}.get(outcome, "")
        rows.append(f'<testcase classname="x" name="{name}" file="{file}" time="0.01">{body}</testcase>')
    return f'<?xml version="1.0"?><testsuites><testsuite name="pytest">{"".join(rows)}</testsuite></testsuites>'


def fake_docker(cases=None, code=0, stdout="", seen=None):
    """A subprocess.run stand-in: writes *cases* as JUnit XML (unless None)."""
    def run(args, **kwargs):
        if args[:2] == ["docker", "run"]:
            if seen is not None:
                seen["args"] = args
                seen["work"] = sorted(
                    str(p.relative_to(_mount(args, "/work"))) for p in Path(_mount(args, "/work")).rglob("*"))
            if cases is not None:
                Path(_mount(args, "/results"), "junit.xml").write_text(_junit(cases))
        elif args[0] == "git":
            return _REAL_RUN(args, **kwargs)
        return CompletedProcess(args, code, stdout=stdout, stderr="")
    return run


# ── C1: pass/fail comes from the exit code, never from printed counts ────

from subprocess import CompletedProcess, TimeoutExpired
from unittest.mock import patch

from app.sandbox import verdict


def _result(exit_code, passed=0, failed=0, timed_out=False, sandbox_error=False):
    return {"exit_code": exit_code, "passed": passed, "failed": failed,
            "timed_out": timed_out, "sandbox_error": sandbox_error}


@pytest.mark.parametrize("result, expected", [
    (_result(0, passed=3), "Passed"),
    (_result(1, passed=2, failed=1), "Failed"),
    (_result(0, failed=1), "Failed"),                  # printed "1 failed" overrides exit 0
    (_result(5), "No tests ran"),                      # pytest: nothing collected
    (_result(0), "No tests ran"),                      # e.g. --collect-only
    (_result(124, timed_out=True), "Timed out"),
    (_result(125), "Sandbox unavailable"),             # docker daemon not running
    (_result(127, sandbox_error=True), "Sandbox unavailable"),
    (_result(2, passed=5), "Failed"),                  # interrupted run is never a pass
])
def test_verdict(result, expected):
    assert verdict(result) == expected


def test_docker_daemon_down_is_not_a_pass(tmp_path):
    proc = CompletedProcess([], 125, stdout="", stderr="Cannot connect to the Docker daemon")
    with patch("app.sandbox.subprocess.run", return_value=proc):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["status"] == "Sandbox unavailable"


def test_missing_docker_binary_is_reported_not_raised(tmp_path):
    with patch("app.sandbox.subprocess.run", side_effect=FileNotFoundError("docker")):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["status"] == "Sandbox unavailable"
    assert res["sandbox_error"] is True


def test_printed_fake_counts_cannot_fake_a_pass(tmp_path):
    proc = CompletedProcess([], 1, stdout="999 passed", stderr="")
    with patch("app.sandbox.subprocess.run", return_value=proc):
        assert SandboxRunner().run_path(str(tmp_path))["status"] == "Failed"


# ── C4: an overrunning container is force-removed ────────────────────────

def test_timeout_removes_the_container(tmp_path):
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[:2] == ["docker", "run"]:
            raise TimeoutExpired(args, 40, output=b"partial", stderr=b"")
        return CompletedProcess(args, 0)

    with patch("app.sandbox.subprocess.run", side_effect=fake_run):
        res = SandboxRunner().run_path(str(tmp_path))

    name = calls[0][calls[0].index("--name") + 1]
    assert calls[1] == ["docker", "rm", "-f", name]
    assert res["status"] == "Timed out"
    assert res["output"] == "partial"  # bytes from TimeoutExpired are decoded


def test_container_is_locked_down_and_writes_only_the_report(tmp_path):
    seen = {}
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([], seen=seen)):
        SandboxRunner().run_path(str(tmp_path))

    args = seen["args"]
    for flag in ("--network", "--cap-drop", "--memory-swap", "--read-only"):
        assert flag in args
    assert args[args.index("--cap-drop") + 1] == "ALL"
    mounts = [args[i + 1].split(":", 1)[1] for i, a in enumerate(args) if a == "-v"]
    assert mounts == ["/work:ro", "/results:rw"]
    assert "--junitxml=/results/junit.xml" in args


# ── C2: results come from the JUnit XML file, never from printed text ────

def test_printing_999_passed_does_not_change_the_count(tmp_path):
    (tmp_path / "test_a.py").write_text("def test_a():\n    print('999 passed')\n")
    with patch("app.sandbox.subprocess.run",
               side_effect=fake_docker([("test_a", "test_a.py", "passed")], stdout="999 passed, 999 passed")):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["passed"] == 1
    assert res["total"] == 1
    assert res["status"] == "Passed"


def test_a_missing_junit_report_is_never_a_pass(tmp_path):
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker(None, code=0, stdout="5 passed")):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["passed"] == 0
    assert res["status"] == "Failed"


def test_each_test_name_and_result_is_saved(tmp_path):
    cases = [("test_ok", "t/test_a.py", "passed"), ("test_bad", "t/test_a.py", "failed"),
             ("test_skip", "t/test_a.py", "skipped"), ("test_err", "t/test_b.py", "error")]
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker(cases, code=1)):
        res = SandboxRunner().run_path(str(tmp_path))
    assert [(c["name"], c["file"], c["outcome"]) for c in res["cases"]] == [
        ("test_ok", "t/test_a.py", "passed"), ("test_bad", "t/test_a.py", "failed"),
        ("test_skip", "t/test_a.py", "skipped"), ("test_err", "t/test_b.py", "error")]
    assert (res["passed"], res["failed"], res["skipped"]) == (1, 2, 1)
    assert res["status"] == "Failed"


def test_a_huge_or_broken_junit_report_is_not_trusted(tmp_path):
    def run(args, **kwargs):
        if args[:2] == ["docker", "run"]:
            Path(_mount(args, "/results"), "junit.xml").write_text("<testsuites><testcase name=")
        return CompletedProcess(args, 0, stdout="1 passed", stderr="")
    with patch("app.sandbox.subprocess.run", side_effect=run):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["status"] == "Failed" and res["passed"] == 0


# ── C3: the whole suite always runs; new and existing tests are marked ───

def _git(cwd, *args):
    _REAL_RUN(["git", "-c", "user.email=t@t", "-c", "user.name=t", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def repo_with_tests(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_old.py").write_text("def test_old():\n    assert True\n")
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "base")
    return tmp_path


def test_the_robot_cannot_narrow_the_run_to_one_target(repo_with_tests):
    seen = {}
    with patch("app.sandbox.subprocess.run",
               side_effect=fake_docker([("test_old", "tests/test_old.py", "passed")], seen=seen)):
        SandboxRunner().run_path(str(repo_with_tests))
    pytest_args = seen["args"][seen["args"].index("pytest"):]
    assert "--" not in pytest_args
    assert not any(a.endswith(".py") for a in pytest_args)


def test_new_and_existing_tests_are_marked(repo_with_tests):
    (repo_with_tests / "tests" / "test_old.py").write_text(
        "def test_old():\n    assert True\n\ndef test_added():\n    assert True\n")
    (repo_with_tests / "tests" / "test_new.py").write_text("def test_new():\n    assert True\n")
    cases = [("test_old", "tests/test_old.py", "passed"), ("test_added", "tests/test_old.py", "passed"),
             ("test_new[1]", "tests/test_new.py", "passed")]
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker(cases)):
        res = SandboxRunner().run_path(str(repo_with_tests))
    assert {c["name"]: c["new"] for c in res["cases"]} == {"test_old": False, "test_added": True, "test_new[1]": True}
    assert res["missing_existing"] == []
    assert res["status"] == "Passed"


def test_deleting_an_existing_test_fails_the_run(repo_with_tests):
    (repo_with_tests / "tests" / "test_old.py").unlink()
    (repo_with_tests / "tests" / "test_new.py").write_text("def test_new():\n    assert True\n")
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([("test_new", "tests/test_new.py", "passed")])):
        res = SandboxRunner().run_path(str(repo_with_tests))
    assert res["missing_existing"] == ["tests/test_old.py::test_old"]
    assert res["status"] == "Failed"


# ── D8: secret files are not in the sandbox copy ─────────────────────────

def test_secret_files_are_stripped_from_the_sandbox_copy(tmp_path):
    (tmp_path / "app.py").write_text("x = 1\n")
    (tmp_path / ".env").write_text("SECRET_KEY=abc123456\n")
    (tmp_path / "deploy").mkdir()
    (tmp_path / "deploy" / "id_rsa").write_text("key\n")
    (tmp_path / ".ssh").mkdir()
    (tmp_path / ".ssh" / "config").write_text("Host x\n")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("[core]\n")
    os.symlink(".env", tmp_path / "settings.py")          # a shortcut to a secret
    os.symlink("app.py", tmp_path / "alias.py")            # a harmless shortcut
    seen = {}
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([], seen=seen)):
        SandboxRunner().run_path(str(tmp_path))
    assert seen["work"] == ["alias.py", "app.py", "deploy"]
    assert seen["args"][seen["args"].index("-v") + 1].endswith(":/work:ro")
    assert (tmp_path / ".env").exists()  # the real workspace is untouched


# ── D3: secrets in test output are hidden ────────────────────────────────

def test_secrets_in_test_output_are_redacted(tmp_path):
    out = ("SECRET_KEY=sk_live_abcdef123456\n"
           "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nzzzzzzzz\n-----END RSA PRIVATE KEY-----\n")
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([], code=1, stdout=out)):
        res = SandboxRunner().run_path(str(tmp_path))
    assert "sk_live_abcdef123456" not in res["output"]
    assert "MIIEowIBAAKCAQEA" not in res["output"] and "zzzzzzzz" not in res["output"]
    assert "SECRET_KEY=***" in res["output"]


# ── Real Docker: the Milestone 3 "done when" checks end to end ───────────

@needs_docker
def test_real_sandbox_ignores_printed_counts_and_hides_secrets(tmp_path):
    (tmp_path / ".env").write_text("API_KEY=sk_live_realsecret999\n")
    (tmp_path / "test_evil.py").write_text(
        "import os\n\n"
        "def test_env_is_not_in_the_sandbox():\n"
        "    print('999 passed')\n"
        "    assert not os.path.exists('.env')\n\n"
        "def test_prints_a_secret():\n"
        "    print('API_KEY=sk_live_printed123456')\n"
        "    print('999 passed')\n"
        "    assert False\n"
    )
    res = SandboxRunner().run_path(str(tmp_path))
    by_name = {c["name"]: c["outcome"] for c in res["cases"]}
    assert by_name == {"test_env_is_not_in_the_sandbox": "passed", "test_prints_a_secret": "failed"}
    assert (res["passed"], res["failed"]) == (1, 1)
    assert "sk_live_printed123456" not in res["output"]
    assert "API_KEY=***" in res["output"]
    assert res["status"] == "Failed"


# ── Review findings #3 and #4 ────────────────────────────────────────────

def test_skipping_an_existing_test_counts_as_not_running_it(repo_with_tests):
    (repo_with_tests / "tests" / "test_old.py").write_text(
        "import pytest\n\n@pytest.mark.skip\ndef test_old():\n    assert True\n")
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([("test_old", "tests/test_old.py", "skipped")])):
        res = SandboxRunner().run_path(str(repo_with_tests))
    assert res["missing_existing"] == ["tests/test_old.py::test_old"]
    assert res["status"] == "Failed"


def test_an_existing_test_that_was_already_skipped_may_stay_skipped(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_old.py").write_text(
        "import pytest\n\ndef test_ok():\n    assert True\n\n@pytest.mark.skipif(True, reason='windows')\ndef test_win():\n    pass\n")
    _git(tmp_path, "init", "-q"); _git(tmp_path, "add", "-A"); _git(tmp_path, "commit", "-qm", "base")
    cases = [("test_ok", "tests/test_old.py", "passed"), ("test_win", "tests/test_old.py", "skipped")]
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker(cases)):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["missing_existing"] == []
    assert res["status"] == "Passed"


def test_a_broken_git_history_fails_the_run_instead_of_marking_everything_new(repo_with_tests):
    (repo_with_tests / ".git" / "HEAD").write_text("ref: refs/heads/does-not-exist-but-objects-do\n")
    (repo_with_tests / ".git" / "refs" / "heads").mkdir(parents=True, exist_ok=True)
    (repo_with_tests / ".git" / "refs" / "heads" / "does-not-exist-but-objects-do").write_text("f" * 40 + "\n")
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([("test_old", "tests/test_old.py", "passed")])):
        res = SandboxRunner().run_path(str(repo_with_tests))
    assert res["status"] == "Failed"
    assert "existing tests" in res["output"]


def test_a_repo_with_no_commits_has_no_baseline(tmp_path):
    _git(tmp_path, "init", "-q")
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([("test_a", "test_a.py", "passed")])):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["status"] == "Passed" and res["cases"][0]["new"] is True


def test_the_sandbox_copy_and_the_fingerprint_cover_the_same_files(tmp_path):
    # One skip rule (fingerprint.SKIP_DIRS): whatever can run in the sandbox is fingerprinted.
    from app.fingerprint import tree_fingerprint
    (tmp_path / "app.py").write_text("x = 1\n")
    (tmp_path / "stray.pyc").write_bytes(b"\x00")
    (tmp_path / "evil__pycache__").mkdir()
    (tmp_path / "evil__pycache__" / "conftest.py").write_text("x = 2\n")
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "__pycache__" / "app.cpython-312.pyc").write_bytes(b"\x01")
    seen = {}
    with patch("app.sandbox.subprocess.run", side_effect=fake_docker([], seen=seen)):
        SandboxRunner().run_path(str(tmp_path))
    assert seen["work"] == ["app.py", "evil__pycache__", "evil__pycache__/conftest.py", "stray.pyc"]
    before = tree_fingerprint(str(tmp_path))
    (tmp_path / "stray.pyc").write_bytes(b"\x02")
    assert tree_fingerprint(str(tmp_path)) != before


# ── Security review: the report file cannot hang or fool the host ────────

@pytest.mark.parametrize("kind", ["symlink", "fifo"])
def test_a_report_that_is_not_a_regular_file_is_not_read(tmp_path, kind):
    def run(args, **kwargs):
        if args[:2] == ["docker", "run"]:
            report = Path(_mount(args, "/results"), "junit.xml")
            if kind == "symlink":
                os.symlink("/dev/zero", report)
            else:
                os.mkfifo(report)
        return CompletedProcess(args, 0, stdout="", stderr="")
    with patch("app.sandbox.subprocess.run", side_effect=run):
        res = SandboxRunner().run_path(str(tmp_path))
    assert res["status"] == "Failed" and res["report_missing"] is True


def test_a_report_with_a_doctype_is_not_trusted(tmp_path):
    bomb = ('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]>'
            '<testsuites><testcase name="t" file="t.py"/></testsuites>')
    def run(args, **kwargs):
        if args[:2] == ["docker", "run"]:
            Path(_mount(args, "/results"), "junit.xml").write_text(bomb)
        return CompletedProcess(args, 0, stdout="", stderr="")
    with patch("app.sandbox.subprocess.run", side_effect=run):
        assert SandboxRunner().run_path(str(tmp_path))["status"] == "Failed"
