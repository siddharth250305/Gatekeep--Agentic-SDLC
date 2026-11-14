"""G9: one core, two thin adapters (Milestone 5).

MCP mode (an outside robot calling gatekeep_* tools) and pipeline mode (the
built-in agent with an API key) both act only through GateKeepTools, which
checks the phase policy on every call. The pipeline keeps no run state of its
own: each call reads the run from the backend, does the work of the step the
run is at, and hands it over with the same robot actions."""

from __future__ import annotations

import pytest

from app.graph import build_pipeline
from app.llm import CANNED, FakeLLM, LLMResult, ToolCall
from app.mcp import server
from app.mcp.session import SessionManager
from app.mcp.tools import GateKeepTools
from app.reporter import HttpReporter
from app.sandbox import FakeRunner
from tests.conftest import BASE

STATE_FIELDS = {"state", "status", "at"}


def make_core(workspaces, runner=None) -> GateKeepTools:
    """A fresh core, as after a restart: new sessions, new tools, same disk."""
    return GateKeepTools(SessionManager(base_url=BASE), base_url=BASE, runner=runner or FakeRunner(),
                         workspaces=workspaces)


def make_pipeline(core, llm=None):
    return build_pipeline(llm or FakeLLM(), core, HttpReporter(base=BASE))


@pytest.fixture
def core(node, tmp_path):
    return make_core(tmp_path)


# ── the same policy check for both adapters ──────────────────────────────

@pytest.fixture(params=["mcp", "pipeline"])
def adapter(request, core, monkeypatch):
    if request.param == "mcp":
        monkeypatch.setattr(server, "tools", core)
        monkeypatch.setattr(server, "session_manager", core.session_manager)
        return lambda run_id, tool, **args: getattr(server, f"gatekeep_{tool}")(run_id, **args)
    pipeline = make_pipeline(core)
    return lambda run_id, tool, **args: pipeline.tool(run_id, tool, **args)


def test_a_write_outside_the_code_step_is_refused_and_audited(adapter, node, core):
    node.add_run("RUN-A", step="design")
    out = adapter("RUN-A", "write_file", path="app.py", content="x = 1\n")
    assert "not allowed in phase" in out["error"]
    assert not (core.workspaces / "RUN-A" / "app.py").exists()
    assert "mcp.policy.denied" in node.events("RUN-A")


def test_secret_files_are_refused_even_in_the_code_step(adapter, node, core):
    node.add_run("RUN-A", step="code")
    (core.workspaces / "RUN-A").mkdir()
    out = adapter("RUN-A", "write_file", path=".env", content="TOKEN=x")
    assert "blocked by security policy" in out["error"]
    assert not (core.workspaces / "RUN-A" / ".env").exists()
    assert "mcp.policy.denied" in node.events("RUN-A")


def test_path_traversal_is_refused(adapter, node, core):
    node.add_run("RUN-A", step="code")
    (core.workspaces / "RUN-A").mkdir()
    out = adapter("RUN-A", "apply_patch", path="../RUN-B/app.py", find="a", replace="b")
    assert "traversal" in out["error"]


def test_a_move_from_the_wrong_step_is_refused_before_it_reaches_the_backend(adapter, node):
    node.add_run("RUN-A", step="req")
    out = adapter("RUN-A", "submit_design", design="a design")
    assert "not allowed in phase" in out["error"]
    assert node.runs["RUN-A"]["step"] == "req"
    assert not [c for c in node.calls if c[1] == "/runs/RUN-A/actions/submit_design"]


def test_the_allowed_move_goes_through_the_backend_state_machine(adapter, node):
    node.add_run("RUN-A", step="req")
    out = adapter("RUN-A", "submit_requirements", requirements="R1")
    assert out["submitted"] is True
    assert node.runs["RUN-A"]["step"] == "g1"
    assert node.runs["RUN-A"]["requirements"] == "R1"
    assert "requirements.submitted" in node.events("RUN-A")


def test_nothing_can_act_on_a_cancelled_run(adapter, node):
    node.add_run("RUN-A", step="code")
    node.cancel("RUN-A")
    out = adapter("RUN-A", "read_file", path="app.py")
    assert "no active phase" in out["error"]


def test_an_unknown_tool_is_refused(core, node):
    node.add_run("RUN-A", step="code")
    out = make_pipeline(core).tool("RUN-A", "run_shell", command="rm -rf /")
    assert "Unknown tool" in out["error"]


# ── pipeline mode: each step reads the run from the backend ──────────────

def test_requirements_step_hands_the_ai_text_to_gate_1(node, core):
    node.add_run("RUN-P1")
    out = make_pipeline(core).work("RUN-P1")
    assert out["did"] == "requirements"
    run = node.runs["RUN-P1"]
    assert run["step"] == "g1"
    assert run["requirements"] == CANNED["requirements"]
    assert "pipeline.requirements.completed" in node.events("RUN-P1")
    (run_id, key, metrics), = node.phase_metrics
    assert (run_id, key) == ("RUN-P1", "req") and metrics["input_tokens"] > 0
    assert not STATE_FIELDS & set(metrics)


def test_gate_2_reviews_the_design_the_ai_actually_wrote(node, core):
    """Problem 2.7: the design is no longer replaced by a rule-built stand-in."""
    node.add_run("RUN-P2", step="design")
    out = make_pipeline(core).work("RUN-P2")
    assert out["did"] == "design"
    assert node.runs["RUN-P2"]["design"] == CANNED["design"]
    assert node.runs["RUN-P2"]["step"] == "g2"


def test_a_whole_run_survives_a_restart_at_every_gate(node, tmp_path):
    """A brand-new core and pipeline at each step: nothing is kept in memory."""
    node.add_run("RUN-P3")
    assert make_pipeline(make_core(tmp_path)).work("RUN-P3")["did"] == "requirements"
    node.decide("RUN-P3", "approve")
    assert make_pipeline(make_core(tmp_path)).work("RUN-P3")["did"] == "design"
    node.decide("RUN-P3", "approve")
    assert make_pipeline(make_core(tmp_path)).work("RUN-P3")["did"] == "code"

    run = node.runs["RUN-P3"]
    assert run["step"] == "g3"
    events = node.events("RUN-P3")
    # The code was written, tested and handed over through GateKeepTools.
    assert events.count("mcp.file.written") == 2
    assert "mcp.tests.run" in events and "code.review_requested" in events
    assert (tmp_path / "RUN-P3" / "throttle.py").is_file()
    assert node.test_runs and node.test_runs[-1]["fingerprint"]
    review = next(e for e in run["auditChain"] if e["event"] == "code.review_requested")
    assert review["payload"]["fingerprint"] == node.test_runs[-1]["fingerprint"]

    node.decide("RUN-P3", "approve")
    out = make_pipeline(make_core(tmp_path)).work("RUN-P3")
    assert out["did"] is None and node.runs["RUN-P3"]["step"] == "done"


class RecordingLLM(FakeLLM):
    def __init__(self):
        self.prompts: list[str] = []

    def generate(self, prompt, kind="", system=None):
        self.prompts.append(prompt)
        return super().generate(prompt, kind, system)

    def chat(self, messages, tools_schema=None, system=None):
        self.prompts.append(messages[0]["text"])
        return super().chat(messages, tools_schema, system)


def test_gate_1_feedback_reaches_the_agent_from_the_backend_after_a_restart(node, tmp_path):
    node.add_run("RUN-P4")
    make_pipeline(make_core(tmp_path)).work("RUN-P4")
    node.decide("RUN-P4", "reject", feedback="cover the 429 Retry-After path")
    llm = RecordingLLM()
    make_pipeline(make_core(tmp_path), llm).work("RUN-P4")
    assert "cover the 429 Retry-After path" in llm.prompts[-1]
    assert node.runs["RUN-P4"]["step"] == "g1"


def test_gate_3_feedback_goes_to_the_coding_agent(node, tmp_path):
    node.add_run("RUN-P5", step="g3")
    node.decide("RUN-P5", "reject", target="code", feedback="add a test for the limit")
    llm = RecordingLLM()
    make_pipeline(make_core(tmp_path), llm).work("RUN-P5")
    assert any("add a test for the limit" in p for p in llm.prompts)
    assert node.runs["RUN-P5"]["step"] == "g3"


def test_feedback_of_an_approved_round_is_not_sent_again(node, core):
    node.add_run("RUN-P6", step="g1")
    node.decide("RUN-P6", "reject", feedback="old note")
    make_pipeline(core).work("RUN-P6")
    node.decide("RUN-P6", "approve")
    llm = RecordingLLM()
    make_pipeline(core, llm).work("RUN-P6")
    assert node.runs["RUN-P6"]["step"] == "g2"
    assert "old note" not in llm.prompts[-1]


def test_mcp_mode_runs_are_never_touched_by_the_pipeline(node, core):
    node.add_run("RUN-M", started=False)
    out = make_pipeline(core).work("RUN-M")
    assert out["did"] is None and out["reason"] == "not_a_pipeline_run"
    assert node.runs["RUN-M"]["step"] == "req"


def test_the_pipeline_waits_while_a_reviewer_decides(node, core):
    node.add_run("RUN-G", step="g2")
    out = make_pipeline(core).work("RUN-G")
    assert out["did"] is None and out["reason"] == "waiting_for_reviewer"


def test_runs_needing_work_are_started_runs_at_an_agent_step(node, core):
    node.add_run("A", step="req")
    node.add_run("B", step="g1")
    node.add_run("C", step="design", started=False)
    node.add_run("D", step="code")
    node.add_run("E", step="done")
    assert sorted(make_pipeline(core).runs_needing_work()) == ["A", "D"]


def test_the_pipeline_keeps_no_run_state_between_calls(core):
    import app.graph as graph

    pipeline = make_pipeline(core)
    assert pipeline.graph.checkpointer is None  # no LangGraph checkpoint store
    assert not hasattr(graph, "_resume_locks")
    assert not hasattr(graph, "resume_run")


def test_a_step_that_fails_is_recorded_on_the_run(node, core):
    class Broken(FakeLLM):
        def generate(self, prompt, kind="", system=None):
            raise RuntimeError("model unavailable")

    node.add_run("RUN-F")
    out = make_pipeline(core, Broken()).work("RUN-F")
    assert out["did"] is None and out["reason"] == "failed"
    failed = [e for e in node.runs["RUN-F"]["auditChain"] if e["event"] == "pipeline.step.failed"]
    assert failed and "model unavailable" in failed[0]["payload"]["error"]
    assert node.runs["RUN-F"]["step"] == "req"


# ── self-heal: the AI's fix is applied and the tests run again ───────────

BUGGY = "def is_allowed(count, limit=60):\n    return count < limit\n"
TESTS = ("from throttle import is_allowed\n\n\ndef test_at_limit():\n    assert is_allowed(60)\n")


def _reply(tool_calls=None, text=""):
    return LLMResult(content=text, input_tokens=10, output_tokens=5, model="fake", duration_ms=1,
                     tool_calls=tool_calls)


class FixingLLM(FakeLLM):
    """Writes a bug, then fixes it when shown the failing test output."""

    def chat(self, messages, tools_schema=None, system=None):
        if messages[-1]["role"] == "tool":
            return _reply(text="done")
        if "1 failed: test_at_limit" in messages[0]["text"]:
            return _reply([ToolCall("apply_patch", {"path": "throttle.py", "find": "count < limit",
                                                     "replace": "count <= limit"}, id="fix-1")])
        return _reply([ToolCall("write_file", {"path": "throttle.py", "content": BUGGY}, id="w-1"),
                       ToolCall("write_file", {"path": "test_throttle.py", "content": TESTS}, id="w-2")])


class FileCheckRunner:
    """Passes only when the workspace holds the fixed code."""

    def __init__(self):
        self.runs = 0

    def run_path(self, path):
        self.runs += 1
        ok = "count <= limit" in open(f"{path}/throttle.py").read()
        return {"passed": 1 if ok else 0, "failed": 0 if ok else 1, "skipped": 0, "total": 1,
                "exit_code": 0 if ok else 1, "timed_out": False, "status": "Passed" if ok else "Failed",
                "duration_ms": 3, "output": "1 passed" if ok else "1 failed: test_at_limit",
                "cases": [], "missing_existing": []}


def test_self_heal_applies_the_ai_fix_and_runs_the_tests_again(node, tmp_path):
    runner = FileCheckRunner()
    node.add_run("RUN-H", step="code")
    out = make_pipeline(make_core(tmp_path, runner), FixingLLM()).work("RUN-H")
    assert out["did"] == "code"
    assert runner.runs == 2
    assert [t["status"] for t in node.test_runs] == ["Failed", "Passed"]
    assert node.test_runs[-1]["iterations"] == 1
    assert "count <= limit" in (tmp_path / "RUN-H" / "throttle.py").read_text()
    assert "mcp.file.patched" in node.events("RUN-H")
    assert node.runs["RUN-H"]["step"] == "g3"


def test_self_heal_gives_up_after_three_fixes_and_still_hands_over(node, tmp_path):
    class NeverFixes(FixingLLM):
        def chat(self, messages, tools_schema=None, system=None):
            if "1 failed: test_at_limit" in messages[0]["text"]:
                return _reply(text="I could not fix it")
            return super().chat(messages, tools_schema, system)

    runner = FileCheckRunner()
    node.add_run("RUN-H2", step="code")
    make_pipeline(make_core(tmp_path, runner), NeverFixes()).work("RUN-H2")
    assert runner.runs == 4  # the first run and three repair rounds
    assert node.test_runs[-1]["iterations"] == 3 and node.test_runs[-1]["status"] == "Failed"
    # Gate 3 shows the failure; the backend refuses to approve failing code (B7).
    assert node.runs["RUN-H2"]["step"] == "g3"
