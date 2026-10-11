"""Self-healing loop: run tests in the sandbox; on failure, hand the output to
a fix function that regenerates the code, then re-run. Stops when green or after
max_iterations."""

from __future__ import annotations

from typing import Callable


def self_heal(runner, files: dict[str, str], fix: Callable[[dict, str], dict], max_iterations: int = 3) -> dict:
    result = runner.run(files)
    iterations = 0
    while result["failed"] > 0 and iterations < max_iterations:
        iterations += 1
        files = fix(files, result["output"])
        result = runner.run(files)
    return {**result, "iterations": iterations}
