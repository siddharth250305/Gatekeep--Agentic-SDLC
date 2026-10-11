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
