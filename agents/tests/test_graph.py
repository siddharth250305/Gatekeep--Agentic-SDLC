"""The pipeline under the backend state machine (B1, B2, B4).

The pipeline does work and reports it. It never writes a phase's state or a
run's status: it hands work over with the backend's robot actions (through
GateKeepTools), and the step the backend says the run is at decides what it
does next. Gate decisions are the backend's; the pipeline only follows them."""

import re

import pytest

from app.graph import build_pipeline, rework_feedback
from app.llm import FakeLLM
from app.mcp.session import SessionManager
from app.mcp.tools import GateKeepTools
from app.reporter import HttpReporter
from app.sandbox import FakeRunner
from tests.conftest import BASE

# What the backend accepts on POST /runs/:id/audit from an agent (E2).
AGENT_EVENT = re.compile(r"^(mcp|repo|workspace|sandbox|pipeline)\.[a-z0-9_.-]{1,80}$")
STATE_FIELDS = {"state", "status", "at"}
MOVES = {"requirements.submitted", "design.submitted", "code.review_requested"}


@pytest.fixture
def work(node, tmp_path):
    def run(run_id):
        core = GateKeepTools(SessionManager(base_url=BASE), base_url=BASE, runner=FakeRunner(), workspaces=tmp_path)
        return build_pipeline(FakeLLM(), core, HttpReporter(base=BASE)).work(run_id)
    return run


def assert_reports_work_only(node, run_id):
    """B1: no phase state or run status is written; the only moves are the
    robot actions, and every other audit entry is a work event."""
    for _, _, metrics in node.phase_metrics:
        assert not STATE_FIELDS & set(metrics), metrics
    assert not [c for c in node.calls if c[0] == "PATCH" and c[1].startswith("/runs")]
    for entry in node.runs[run_id]["auditChain"]:
        if entry.get("actor") == "agent:test" and entry["event"] not in MOVES:
            assert AGENT_EVENT.match(entry["event"]), entry["event"]


def test_full_approval_flow_reaches_done_through_gate_3(node, work):
    node.add_run("RUN-T2")
    for expected in ("requirements", "design", "code"):
        assert work("RUN-T2")["did"] == expected
        node.decide("RUN-T2", "approve")
    assert node.runs["RUN-T2"]["step"] == "done"
    assert [k for _, k, _ in node.phase_metrics] == ["req", "design", "code"]
    assert_reports_work_only(node, "RUN-T2")


def test_reject_at_gate_1_sends_the_work_back_to_requirements(node, work):
    node.add_run("RUN-T3")
    work("RUN-T3")
    node.decide("RUN-T3", "reject", feedback="be specific")
    assert work("RUN-T3")["did"] == "requirements"
    assert node.events("RUN-T3").count("requirements.submitted") == 2
    assert node.runs["RUN-T3"]["step"] == "g1"


def test_reject_at_gate_2_goes_back_to_design_never_to_code(node, work):
    node.add_run("RUN-T7", step="g2")
    node.decide("RUN-T7", "reject")
    assert work("RUN-T7")["did"] == "design"
    assert "code.review_requested" not in node.events("RUN-T7")
    assert node.runs["RUN-T7"]["step"] == "g2"


def test_reject_at_gate_3_goes_to_the_step_the_reviewer_chose(node, work):
    node.add_run("RUN-T8", step="g3")
    node.decide("RUN-T8", "reject", target="design")
    assert work("RUN-T8")["did"] == "design"
    assert node.runs["RUN-T8"]["step"] == "g2"


def test_a_cancelled_run_gets_no_more_work(node, work):
    node.add_run("RUN-T9", step="g1")
    node.cancel("RUN-T9")
    out = work("RUN-T9")
    assert out["did"] is None and out["reason"] == "finished"
    assert node.runs["RUN-T9"]["step"] == "cancelled"


def test_a_repeated_wake_up_does_the_step_once(node, work):
    # Two wake-ups for one decision: the second finds the run at the next gate.
    node.add_run("RUN-T4", step="design")
    assert work("RUN-T4")["did"] == "design"
    assert work("RUN-T4")["reason"] == "waiting_for_reviewer"
    assert node.events("RUN-T4").count("design.submitted") == 1


def test_rework_feedback_is_only_the_open_rejection_to_this_step():
    chain = [{"event": "g3.rejected", "payload": {"to": "design", "feedback": "rethink"}},
             {"event": "pipeline.design.completed", "payload": {}}]
    assert rework_feedback({"step": "design", "auditChain": chain}) == "rethink"
    assert rework_feedback({"step": "code", "auditChain": chain}) == ""
    chain.append({"event": "design.submitted", "payload": {}})
    assert rework_feedback({"step": "design", "auditChain": chain}) == ""
