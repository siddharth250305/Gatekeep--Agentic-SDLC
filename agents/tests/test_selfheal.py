from app.selfheal import self_heal
from app.graph import build_graph, start_run, resume_run
from app.llm import FakeLLM
from app.reporter import NullReporter
from app.sandbox import FakeRunner


class FlakyRunner:
    """Fails the first N runs, then passes. Simulates a fixable bug."""

    def __init__(self, fails=1):
        self.calls = 0
        self.fails = fails

    def run(self, files):
        self.calls += 1
        failing = self.calls <= self.fails
        return {
            "passed": 0 if failing else 3,
            "failed": 1 if failing else 0,
            "total": 3, "exit_code": 1 if failing else 0,
            "timed_out": False, "duration_ms": 5, "output": "1 failed" if failing else "3 passed",
        }


def test_self_heal_recovers_after_a_fix():
    runner = FlakyRunner(fails=1)
    fixed = {"changed": True}
    result = self_heal(runner, {"a.py": "x"}, fix=lambda f, o: fixed, max_iterations=3)
    assert result["failed"] == 0
    assert result["iterations"] == 1  # one repair round
    assert runner.calls == 2


def test_self_heal_gives_up_after_max_iterations():
    runner = FlakyRunner(fails=99)
    result = self_heal(runner, {"a.py": "x"}, fix=lambda f, o: f, max_iterations=3)
    assert result["failed"] > 0
    assert result["iterations"] == 3


def test_coding_node_reports_sandbox_results():
    r = NullReporter()
    app = build_graph(FakeLLM(), r, runner=FakeRunner())
    start_run(app, "RUN-S", "brief")
    resume_run(app, "RUN-S", "approve")  # g1 -> design -> g2
    resume_run(app, "RUN-S", "approve")  # g2 -> coding (runs sandbox) -> code gate
    assert len(r.tests_reported) == 1
    tr = r.tests_reported[0]
    assert tr["passed"] == 2 and tr["failed"] == 0  # FakeRunner: 2 files -> 2 "passed"
    assert "sandbox.tested" in [e for e, _ in r.audits]
