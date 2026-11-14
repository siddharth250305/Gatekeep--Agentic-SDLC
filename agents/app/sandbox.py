"""Run generated code + tests inside a locked-down Docker container.

Isolation: no network, capped memory/swap/cpu/pids, no Linux capabilities,
non-root, read-only code mount, size-capped tmpfs only, wall-clock timeout
(the container is force-removed if it overruns). pytest is baked into the image so the
run needs no network.

What the reviewer can trust (Milestone 3):
  - Counts come from a JUnit XML report pytest writes to a separate mount,
    never from printed text, so a test printing "999 passed" changes nothing (C2).
  - The whole suite always runs. Each test is marked new or existing against
    the commit the workspace was cloned at, and an existing test that no
    longer runs fails the run (C3).
  - Tests run on a copy of the workspace with secret files, .git and unsafe
    shortcuts removed (D8), and their output is redacted (D3).

Known limit: test code runs inside the same pytest process that writes the
report, so a test written to attack pytest itself (a conftest.py that
rewrites the report and exits) can still lie. The exit code and the
existing-tests check catch the simple cases; the reviewer sees the test code.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

from .diffing import _GIT_SAFE_CONFIG
from .fingerprint import SKIP_DIRS
from .repository.security import is_sensitive_path, redact_secrets, resolve_inside

IMAGE = os.getenv("SANDBOX_IMAGE", "gatekeep-sandbox")

# pytest exit code for "no tests were collected".
# Container limits, used in the docker command and reported with each test run.
MEMORY_MB = 512
CPUS = "1"
_PYTEST_NO_TESTS = 5
# docker run exit codes for "the container never started" (daemon error,
# command not invokable, command not found).
_DOCKER_FAILURES = (125, 126, 127)

# Where pytest writes its report inside the container, and the size we read.
_REPORT = "junit.xml"
_MAX_REPORT_BYTES = 5_000_000
# pytest's default test file names, and test functions in them.
_TEST_FILE = re.compile(r"(?:^|/)(?:test_[^/]*|[^/]*_test)\.py$")
_TEST_DEF = re.compile(r"^[ \t]*(?:async[ \t]+)?def[ \t]+(test\w*)[ \t]*\(", re.M)


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
    if (result["failed"] > 0 or result.get("report_missing") or result.get("missing_existing")
            or result.get("baseline_error")):
        return "Failed"
    if code == _PYTEST_NO_TESTS or (code == 0 and result["passed"] == 0):
        return "No tests ran"
    if code == 0:
        return "Passed"
    return "Failed"


def _read_report(path: Path) -> list[dict] | None:
    """Each test's name, file and outcome from pytest's JUnit XML report, or
    None when the report is missing, too big, not valid XML, or anything but a
    plain file. Test code can write to the report folder, so a shortcut, a
    pipe or an XML entity trick there must not hang or fool the host."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        with os.fdopen(fd, "rb") as fh:
            fd = -1
            data = fh.read(_MAX_REPORT_BYTES + 1)
    except OSError:
        return None
    finally:
        if fd != -1:
            os.close(fd)
    if len(data) > _MAX_REPORT_BYTES or b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        return None
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return None
    cases = []
    for tc in root.iter("testcase"):
        kinds = {child.tag for child in tc}
        outcome = ("failed" if "failure" in kinds else "error" if "error" in kinds
                   else "skipped" if "skipped" in kinds else "passed")
        cases.append({"name": tc.get("name", ""), "file": tc.get("file", ""), "outcome": outcome})
    return cases


def _sandbox_copy(src: str, dest: str) -> None:
    """Copy *src* to *dest* for a test run, leaving out secret files and
    folders (.env, keys, .ssh, .git, ...) and any shortcut whose real target is
    a secret or outside the workspace, so test code cannot open them (D8)."""
    root = Path(src).resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        rel_dir = here.relative_to(root)
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS and not (here / d).is_symlink()
                       and not is_sensitive_path((rel_dir / d).as_posix())]
        out_dir = Path(dest) / rel_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(out_dir, 0o755)  # readable by the non-root container user
        for fn in filenames:
            try:
                real = resolve_inside(root, (rel_dir / fn).as_posix())
            except ValueError:
                continue
            if real.is_file():
                shutil.copyfile(real, out_dir / fn)
                os.chmod(out_dir / fn, 0o644)


class BaselineError(Exception):
    """The workspace has git history, but the existing tests could not be read from it."""


# A skip or expected failure written into a test (or its module) at the base commit.
_SKIP_HINT = re.compile(r"skip|xfail")
_MODULE_SKIP = re.compile(r"^pytestmark\b.*(?:skip|xfail)|importorskip|^pytest\.skip\(", re.M)
_BLOCK_START = re.compile(r"^[ \t]*(?:async[ \t]+)?def[ \t]|^[ \t]*class[ \t]", re.M)


def _tests_in(source: str) -> dict[str, bool]:
    """Each test function in *source*, and whether it was written to be
    skipped (a skip / xfail in its decorators or body, or a module-level skip)."""
    module_skip = bool(_MODULE_SKIP.search(source))
    found: dict[str, bool] = {}
    for m in _TEST_DEF.finditer(source):
        start = m.start()
        # Walk up over the decorator lines directly above the def.
        lines_above = source[:start].splitlines()
        while lines_above and lines_above[-1].lstrip().startswith("@"):
            start -= len(lines_above.pop()) + 1
        nxt = _BLOCK_START.search(source, m.end())
        chunk = source[max(start, 0):nxt.start() if nxt else len(source)]
        found[m.group(1)] = found.get(m.group(1), False) or module_skip or bool(_SKIP_HINT.search(chunk))
    return found


def existing_tests(workspace: str) -> dict[tuple[str, str], bool] | None:
    """{(file, test name): written to be skipped} for every test in the commit
    the workspace was cloned at. None only when there is no history at all (no
    .git, or no commit yet). If there is history but it cannot be read, raise
    BaselineError: the run must not quietly treat every test as new."""
    if not os.path.isdir(os.path.join(workspace, ".git")):
        return None

    def git(*args: str) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(["git", *_GIT_SAFE_CONFIG, *args], cwd=workspace,
                                  capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.SubprocessError) as exc:
            raise BaselineError(f"git failed: {exc}") from exc

    any_commit = git("rev-list", "-n", "1", "--all")
    if any_commit.returncode == 0 and not any_commit.stdout.strip():
        return None  # a fresh repository: nothing existed before
    listing = git("ls-tree", "-r", "--name-only", "-z", "HEAD")
    if listing.returncode != 0:
        raise BaselineError(listing.stderr.strip() or "git ls-tree failed")
    found: dict[tuple[str, str], bool] = {}
    for f in filter(None, listing.stdout.split("\0")):
        if not _TEST_FILE.search(f):
            continue
        shown = git("show", f"HEAD:{f}")
        if shown.returncode != 0:
            raise BaselineError(shown.stderr.strip() or f"git show failed for {f}")
        found.update({(f, name): may_skip for name, may_skip in _tests_in(shown.stdout).items()})
    return found


def mark_tests(cases: list[dict], existing: dict[tuple[str, str], bool] | None) -> list[str]:
    """Mark each case new or existing (in place) and return the existing tests
    that did not run. An existing test that is now skipped counts as not run,
    unless it was already written to be skipped at the base commit. With no
    git history every test counts as new."""
    existing = existing or {}
    ran = set()
    for case in cases:
        key = (case["file"], case["name"].split("[", 1)[0])
        case["new"] = key not in existing
        if case["outcome"] != "skipped" or case["new"] or existing[key]:
            ran.add(key)
    return sorted(f"{f}::{n}" for f, n in set(existing) - ran)


class SandboxRunner:
    def __init__(self, image: str = IMAGE, timeout: int = 30):
        self.image = image
        self.timeout = timeout

    def profile(self) -> dict[str, str]:
        """The isolation each test run gets, as shown on the dashboard."""
        return {"image": self.image, "network": "Disabled", "memory": f"{MEMORY_MB} MB",
                "cpu": f"{CPUS} core", "timeout": f"{self.timeout} seconds"}

    def run(self, files: dict[str, str]) -> dict:
        d = tempfile.mkdtemp(prefix="gk-files-")
        try:
            for path, content in files.items():
                full = os.path.join(d, path)
                os.makedirs(os.path.dirname(full) or d, exist_ok=True)
                with open(full, "w") as fh:
                    fh.write(content)
            return self.run_path(d)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def run_path(self, path: str) -> dict:
        """Run the project's whole test suite against a cleaned copy of *path*.

        There is no target: the robot cannot narrow the run to its own tests (C3)."""
        work = tempfile.mkdtemp(prefix="gk-sandbox-")
        results = tempfile.mkdtemp(prefix="gk-results-")
        try:
            try:
                _sandbox_copy(path, work)
            except OSError as exc:
                return self._finish({"output": f"could not prepare the sandbox copy: {exc}", "exit_code": 127,
                                     "sandbox_error": True}, cases=[], missing=[])
            os.chmod(work, 0o755)
            os.chmod(results, 0o777)  # the non-root container user writes the report here
            raw = self._docker(work, results)
            cases = _read_report(Path(results) / _REPORT)
        finally:
            shutil.rmtree(work, ignore_errors=True)
            shutil.rmtree(results, ignore_errors=True)
        if cases is None:
            return self._finish(raw, cases=[], missing=[], report_missing=True)
        try:
            existing = existing_tests(path)
        except BaselineError as exc:
            mark_tests(cases, None)
            return self._finish(raw, cases=cases, missing=[], baseline_error=str(exc))
        missing = mark_tests(cases, existing)
        return self._finish(raw, cases=cases, missing=missing)

    def _finish(self, raw: dict, *, cases: list[dict], missing: list[str], report_missing: bool = False,
                baseline_error: str | None = None) -> dict:
        passed = sum(c["outcome"] == "passed" for c in cases)
        failed = sum(c["outcome"] in ("failed", "error") for c in cases)
        skipped = sum(c["outcome"] == "skipped" for c in cases)
        output = redact_secrets(raw.get("output", ""))[0]
        if report_missing and not raw.get("sandbox_error") and not raw.get("timed_out"):
            output = "GateKeep: pytest wrote no readable JUnit report, so no result can be trusted.\n" + output
        if missing:
            output = f"GateKeep: existing tests did not run: {', '.join(missing)}\n" + output
        if baseline_error:
            output = f"GateKeep: could not read the existing tests from git ({baseline_error}), so this run cannot pass.\n" + output
        result = {
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "total": passed + failed,
            "exit_code": raw.get("exit_code", 127),
            "timed_out": raw.get("timed_out", False),
            "sandbox_error": raw.get("sandbox_error", False),
            "report_missing": report_missing,
            "baseline_error": baseline_error,
            "duration_ms": raw.get("duration_ms", 0),
            "output": output,
            "cases": cases,
            "missing_existing": missing,
        }
        result["status"] = verdict(result)
        return result

    def _docker(self, host_dir: str, results_dir: str) -> dict:
        # -o overrides stop the repo's own pytest config from adding options
        # (such as a second --junitxml) or narrowing which tests run.
        pytest_args = ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider",
                       "-o", "addopts=", "-o", "testpaths=", "-o", "junit_family=xunit1",
                       f"--junitxml=/results/{_REPORT}"]
        name = f"gk-sandbox-{uuid.uuid4().hex[:12]}"
        args = [
            "docker", "run", "--rm", "--name", name,
            "--network", "none",
            "--memory", f"{MEMORY_MB}m", "--memory-swap", f"{MEMORY_MB}m", "--cpus", CPUS, "--pids-limit", "128",
            "--read-only", "--tmpfs", "/tmp:rw,size=64m",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--user", "65534:65534",
            "-e", "PYTHONDONTWRITEBYTECODE=1",
            "-v", f"{host_dir}:/work:ro",
            "-v", f"{results_dir}:/results:rw",
            "-w", "/work",
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
        return {"exit_code": code, "timed_out": timed_out, "sandbox_error": sandbox_error,
                "duration_ms": int((time.perf_counter() - started) * 1000), "output": output}


class FakeRunner:
    """No-Docker stand-in for graph tests: reports a fixed passing suite."""

    def run(self, files: dict[str, str]) -> dict:
        return {"passed": len(files), "failed": 0, "skipped": 0, "total": len(files), "exit_code": 0,
                "timed_out": False, "status": "Passed", "duration_ms": 5, "output": "fake",
                "cases": [], "missing_existing": []}

    def run_path(self, path: str) -> dict:
        return {"passed": 1, "failed": 0, "skipped": 0, "total": 1, "exit_code": 0,
                "timed_out": False, "status": "Passed", "duration_ms": 5, "output": "fake",
                "cases": [], "missing_existing": []}


def sandbox_profile(runner: object) -> dict[str, str]:
    """The runner's isolation profile, or nothing for a runner without one."""
    profile = getattr(runner, "profile", None)
    if not callable(profile):
        return {}
    values = profile()
    return {str(k): str(v) for k, v in values.items()} if isinstance(values, dict) else {}


def docker_available(image: str = IMAGE) -> bool:
    if not shutil.which("docker"):
        return False
    try:
        out = subprocess.run(["docker", "images", "-q", image], capture_output=True, text=True, timeout=10)
        return bool(out.stdout.strip())
    except Exception:
        return False
