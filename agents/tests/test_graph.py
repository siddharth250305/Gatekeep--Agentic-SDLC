"""The LangGraph pipeline under the backend state machine (B1, B2, B4).

The pipeline does work and reports it. It never writes a phase's state or a
run's status: it calls the backend's robot actions (submit_requirements,
submit_design, request_review), and its gate nodes only wait for the human
decision the backend has already recorded, then route on it."""

import re

from app.graph import build_graph, resume_run, start_run
from app.llm import FakeLLM
from app.reporter import NullReporter

# What the backend accepts on POST /runs/:id/audit from an agent (E2).
AGENT_EVENT = re.compile(r"^(mcp|repo|workspace|sandbox|pipeline)\.[a-z0-9_.-]{1,80}$")
STATE_FIELDS = {"state", "status", "at"}


def make():
    reporter = NullReporter()
    return build_graph(FakeLLM(), reporter), reporter


def assert_reports_work_only(r):
    """B1: no phase state, no run status, and no step-change audit events."""
    assert r.runs == []
    for key, fields in r.phases:
        assert not STATE_FIELDS & set(fields), (key, fields)
    for event in r.audit_events():
        assert AGENT_EVENT.match(event), event


def test_pipeline_pauses_at_first_gate_and_meters_requirements():
    app, r = make()
    out = start_run(app, "RUN-T1", "add rate limiting to the checkout webhook")
    assert out["paused"] is True
    assert out["gate"]["gate"] == "g1"
    assert out["phases_run"] == 1
    assert out["total_cost_usd"] > 0
    assert out["total_tokens"] > 0
    assert [k for k, _ in r.phases] == ["req"]          # requirements metered
    assert r.actions == ["submit_requirements"]          # backend opens Gate 1
    assert "pipeline.requirements.completed" in r.audit_events()
    assert_reports_work_only(r)


def test_full_approval_flow_reaches_done_through_gate_3():
    app, r = make()
    start_run(app, "RUN-T2", "brief")
    resume_run(app, "RUN-T2", "approve", gate="g1")             # g1 -> design -> g2
    out = resume_run(app, "RUN-T2", "approve", gate="g2")       # g2 -> coding -> g3
    assert out["paused"] is True
    assert out["gate"] == {"gate": "g3", "role": "Engineer"}
    assert out["phases_run"] == 3
    assert r.actions == ["submit_requirements", "submit_design", "request_review"]
    final = resume_run(app, "RUN-T2", "approve", gate="g3", target="done")
    assert final["status"] == "approved"
    assert final["paused"] is False
    assert final["total_cost_usd"] >= out["total_cost_usd"]
    assert_reports_work_only(r)


def test_reject_at_gate_1_sends_the_work_back_to_requirements():
    app, r = make()
    start_run(app, "RUN-T3", "brief")
    out = resume_run(app, "RUN-T3", "reject", "be specific", gate="g1", target="req")
    assert out["paused"] is True
    assert out["gate"]["gate"] == "g1"
    assert r.actions == ["submit_requirements", "submit_requirements"]
    assert_reports_work_only(r)


def test_reject_at_gate_2_goes_back_to_design_never_to_code():
    app, r = make()
    start_run(app, "RUN-T7", "brief")
    resume_run(app, "RUN-T7", "approve", gate="g1")
    out = resume_run(app, "RUN-T7", "reject", gate="g2", target="design")
    assert out["gate"]["gate"] == "g2"
    assert "request_review" not in r.actions
    assert r.actions == ["submit_requirements", "submit_design", "submit_design"]


def test_reject_at_gate_3_goes_to_the_step_the_reviewer_chose():
    app, r = make()
    start_run(app, "RUN-T8", "brief")
    resume_run(app, "RUN-T8", "approve", gate="g1")
    resume_run(app, "RUN-T8", "approve", gate="g2")
    to_code = resume_run(app, "RUN-T8", "reject", "missing test", gate="g3", target="code")
    assert to_code["gate"]["gate"] == "g3"
    assert r.actions[-2:] == ["request_review", "request_review"]
    to_design = resume_run(app, "RUN-T8", "reject", gate="g3", target="design")
    assert to_design["gate"]["gate"] == "g2"
    assert r.actions[-1] == "submit_design"


def test_cancel_ends_the_pipeline():
    app, r = make()
    start_run(app, "RUN-T9", "brief")
    out = resume_run(app, "RUN-T9", "cancel", gate="g1", target="cancelled")
    assert out["paused"] is False
    assert out["status"] == "cancelled"
    assert r.actions == ["submit_requirements"]


def test_a_late_approve_for_an_earlier_gate_is_refused():
    # g1 approved -> the graph runs Design and pauses at g2. A second Approve
    # meant for g1 must not land on g2.
    app, r = make()
    start_run(app, "RUN-T4", "brief")
    first = resume_run(app, "RUN-T4", "approve", gate="g1")
    assert first["resumed"] is True and first["gate"]["gate"] == "g2"
    again = resume_run(app, "RUN-T4", "approve", gate="g1")
    assert again == {"resumed": False, "reason": "stale_gate", "gate": "g2"}
    assert r.actions.count("submit_design") == 1


def test_concurrent_resumes_of_one_gate_resume_once():
    import threading

    app, r = make()
    start_run(app, "RUN-T5", "brief")
    results = []
    threads = [threading.Thread(target=lambda: results.append(resume_run(app, "RUN-T5", "approve", gate="g1")))
               for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(o["resumed"] for o in results) == [False, True]
    assert r.actions.count("submit_design") == 1


def test_resume_of_a_run_that_was_never_started_says_not_running():
    app, _ = make()
    out = resume_run(app, "RUN-NEVER", "approve", gate="g1")
    assert out["resumed"] is False and out["reason"] == "not_running"
