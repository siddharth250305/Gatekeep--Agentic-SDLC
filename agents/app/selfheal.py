"""Self-healing loop: run the tests; while they fail, hand the result to a fix
step (which changes the code in the workspace) and run them again. Stops when
green or after max_iterations repair rounds.

Both steps are callbacks so the loop stays free of I/O: in the pipeline they
are GateKeepTools.run_tests and the coding agent fixing files through
GateKeepTools, so every test run is recorded and every fix is policy-checked."""

from __future__ import annotations

from collections.abc import Callable


def failing(result: dict) -> bool:
    """True when the suite ran and did not pass: a failing test, or an
    existing test that went missing. A sandbox error or a timeout is not
    something a code fix can repair, so it is not retried."""
    if result.get("sandbox_error") or result.get("timed_out"):
        return False
    return result.get("failed", 0) > 0 or result.get("status") == "Failed"


def self_heal(run_tests: Callable[[int], dict], fix: Callable[[dict], object], max_iterations: int = 3) -> dict:
    """run_tests(iteration) -> result; fix(result) changes the code."""
    result = run_tests(0)
    iterations = 0
    while failing(result) and iterations < max_iterations:
        iterations += 1
        fix(result)
        result = run_tests(iterations)
    return {**result, "iterations": iterations}
