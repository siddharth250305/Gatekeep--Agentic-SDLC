"""Run generated code + tests inside a locked-down Docker container.

Isolation: no network, capped memory/swap/cpu/pids, no Linux capabilities,
non-root, read-only code mount, size-capped tmpfs only, wall-clock timeout
(the container is force-removed if it overruns). pytest is baked into the image so the
run needs no network.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid

IMAGE = os.getenv("SANDBOX_IMAGE", "gatekeep-sandbox")

# pytest exit code for "no tests were collected".
_PYTEST_NO_TESTS = 5
# docker run exit codes for "the container never started" (daemon error,
# command not invokable, command not found).
_DOCKER_FAILURES = (125, 126, 127)


def _text(value: str | bytes | None) -> str:
    # TimeoutExpired carries bytes even when the process ran with text=True.
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value or ""


def verdict(result: dict) -> str:
    """The one place that decides whether a sandbox run passed.

    Pass/fail comes from the process exit code, never from the printed counts
    alone, so a run where nothing executed can never be reported as Passed."""
    code = result["exit_code"]
    if result.get("sandbox_error") or code in _DOCKER_FAILURES:
        return "Sandbox unavailable"
    if result["timed_out"]:
        return "Timed out"
    if result["failed"] > 0:
        return "Failed"
    if code == _PYTEST_NO_TESTS or (code == 0 and result["passed"] == 0):
        return "No tests ran"
    if code == 0:
        return "Passed"
    return "Failed"


def _parse(output: str) -> tuple[int, int]:
    passed = re.search(r"(\d+) passed", output)
    failed = re.search(r"(\d+) failed", output)
    errors = re.search(r"(\d+) error", output)
    p = int(passed.group(1)) if passed else 0
    f = (int(failed.group(1)) if failed else 0) + (int(errors.group(1)) if errors else 0)
    return p, f


class SandboxRunner:
    def __init__(self, image: str = IMAGE, timeout: int = 30):
        self.image = image
        self.timeout = timeout

    def run(self, files: dict[str, str]) -> dict:
        d = tempfile.mkdtemp(prefix="gk-sandbox-")
        try:
            for path, content in files.items():
                full = os.path.join(d, path)
                os.makedirs(os.path.dirname(full) or d, exist_ok=True)
                with open(full, "w") as fh:
                    fh.write(content)
                os.chmod(full, 0o644)
            os.chmod(d, 0o755)  # readable by the non-root container user
            return self._run_dir(d)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def run_path(self, path: str, target: str | None = None) -> dict:
        """Run pytest against an already-populated directory (a cloned repo).
        `target` scopes the run to a specific test file so the agent's change is
        validated without depending on the repo's own (dep-heavy) suite."""
        return self._run_dir(path, target)

    def _run_dir(self, host_dir: str, target: str | None = None) -> dict:
        pytest_args = ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider",
                       "-o", "addopts=", "-o", "testpaths="]
        if target:
            # "--" stops a target like "--collect-only" being read as an option.
            pytest_args += ["--", target]
        name = f"gk-sandbox-{uuid.uuid4().hex[:12]}"
        args = [
            "docker", "run", "--rm", "--name", name,
            "--network", "none",
            "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--pids-limit", "128",
            "--read-only", "--tmpfs", "/tmp:rw,size=64m",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--user", "65534:65534",
            "-e", "PYTHONDONTWRITEBYTECODE=1",
            "-v", f"{host_dir}:/work:ro", "-w", "/work",
            self.image,
            *pytest_args,
        ]
        started = time.perf_counter()
        timed_out = sandbox_error = False
        try:
            proc = subprocess.run(args, capture_output=True, text=True, timeout=self.timeout + 10)
            output = proc.stdout + proc.stderr
            code = proc.returncode
        except subprocess.TimeoutExpired as e:
            output = _text(e.stdout) + _text(e.stderr)
            code = 124
            timed_out = True
            # Killing the docker client does not stop the container itself.
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=15)
        except FileNotFoundError:
            output = "docker executable not found"
            code = 127
            sandbox_error = True

        passed, failed = _parse(output)
        result = {
            "passed": passed,
            "failed": failed,
            "total": passed + failed,
            "exit_code": code,
            "timed_out": timed_out,
            "sandbox_error": sandbox_error,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "output": output,
        }
        result["status"] = verdict(result)
        return result


class FakeRunner:
    """No-Docker stand-in for graph tests: reports a fixed passing suite."""

    def run(self, files: dict[str, str]) -> dict:
        return {"passed": len(files), "failed": 0, "total": len(files), "exit_code": 0,
                "timed_out": False, "status": "Passed", "duration_ms": 5, "output": "fake"}

    def run_path(self, path: str, target: str | None = None) -> dict:
        return {"passed": 1, "failed": 0, "total": 1, "exit_code": 0,
                "timed_out": False, "status": "Passed", "duration_ms": 5, "output": "fake"}


def docker_available(image: str = IMAGE) -> bool:
    if not shutil.which("docker"):
        return False
    try:
        out = subprocess.run(["docker", "images", "-q", image], capture_output=True, text=True, timeout=10)
        return bool(out.stdout.strip())
    except Exception:
        return False
