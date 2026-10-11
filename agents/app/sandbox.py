"""Run generated code + tests inside a locked-down Docker container.

Isolation: no network, capped memory/cpu/pids, non-root, read-only code mount,
writable tmpfs only, wall-clock timeout. pytest is baked into the image so the
run needs no network.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time

IMAGE = os.getenv("SANDBOX_IMAGE", "gatekeep-sandbox")


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
            pytest_args.append(target)
        args = [
            "docker", "run", "--rm",
            "--network", "none",
            "--memory", "512m", "--cpus", "1", "--pids-limit", "128",
            "--read-only", "--tmpfs", "/tmp",
            "--security-opt", "no-new-privileges",
            "--user", "65534:65534",
            "-e", "PYTHONDONTWRITEBYTECODE=1",
            "-v", f"{host_dir}:/work:ro", "-w", "/work",
            self.image,
            *pytest_args,
        ]
        started = time.perf_counter()
        try:
            proc = subprocess.run(args, capture_output=True, text=True, timeout=self.timeout + 10)
            output = proc.stdout + proc.stderr
            code = proc.returncode
            timed_out = False
        except subprocess.TimeoutExpired as e:
            output = (e.stdout or "") + (e.stderr or "")
            code = 124
            timed_out = True

        passed, failed = _parse(output)
        return {
            "passed": passed,
            "failed": failed,
            "total": passed + failed,
            "exit_code": code,
            "timed_out": timed_out,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "output": output,
        }


class FakeRunner:
    """No-Docker stand-in for graph tests: reports a fixed passing suite."""

    def run(self, files: dict[str, str]) -> dict:
        return {"passed": len(files), "failed": 0, "total": len(files),
                "exit_code": 0, "timed_out": False, "duration_ms": 5, "output": "fake"}

    def run_path(self, path: str, target: str | None = None) -> dict:
        return {"passed": 1, "failed": 0, "total": 1,
                "exit_code": 0, "timed_out": False, "duration_ms": 5, "output": "fake"}


def docker_available(image: str = IMAGE) -> bool:
    if not shutil.which("docker"):
        return False
    try:
        out = subprocess.run(["docker", "images", "-q", image], capture_output=True, text=True, timeout=10)
        return bool(out.stdout.strip())
    except Exception:
        return False
