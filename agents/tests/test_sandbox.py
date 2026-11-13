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


def test_docker_daemon_down_is_not_a_pass():
    proc = CompletedProcess([], 125, stdout="", stderr="Cannot connect to the Docker daemon")
    with patch("app.sandbox.subprocess.run", return_value=proc):
        res = SandboxRunner().run_path("/tmp")
    assert res["status"] == "Sandbox unavailable"


def test_missing_docker_binary_is_reported_not_raised():
    with patch("app.sandbox.subprocess.run", side_effect=FileNotFoundError("docker")):
        res = SandboxRunner().run_path("/tmp")
    assert res["status"] == "Sandbox unavailable"
    assert res["sandbox_error"] is True


def test_printed_fake_counts_cannot_fake_a_pass():
    proc = CompletedProcess([], 1, stdout="999 passed", stderr="")
    with patch("app.sandbox.subprocess.run", return_value=proc):
        assert SandboxRunner().run_path("/tmp")["status"] == "Failed"


# ── C4: an overrunning container is force-removed ────────────────────────

def test_timeout_removes_the_container():
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[:2] == ["docker", "run"]:
            raise TimeoutExpired(args, 40, output=b"partial", stderr=b"")
        return CompletedProcess(args, 0)

    with patch("app.sandbox.subprocess.run", side_effect=fake_run):
        res = SandboxRunner().run_path("/tmp")

    name = calls[0][calls[0].index("--name") + 1]
    assert calls[1] == ["docker", "rm", "-f", name]
    assert res["status"] == "Timed out"
    assert res["output"] == "partial"  # bytes from TimeoutExpired are decoded


def test_container_is_locked_down_and_target_cannot_be_an_option():
    seen = {}

    def fake_run(args, **kwargs):
        seen["args"] = args
        return CompletedProcess(args, 0, stdout="1 passed", stderr="")

    with patch("app.sandbox.subprocess.run", side_effect=fake_run):
        SandboxRunner().run_path("/tmp", target="--collect-only")

    args = seen["args"]
    for flag in ("--network", "--cap-drop", "--memory-swap", "--read-only"):
        assert flag in args
    assert args[args.index("--cap-drop") + 1] == "ALL"
    assert args[-2:] == ["--", "--collect-only"]
