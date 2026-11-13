from app.graph import build_graph, resume_run, start_run
from app.llm import FakeLLM
from app.reporter import NullReporter


def make():
    reporter = NullReporter()
    return build_graph(FakeLLM(), reporter), reporter


def test_pipeline_pauses_at_first_gate_and_meters_requirements():
    app, r = make()
    out = start_run(app, "RUN-T1", "add rate limiting to the checkout webhook")
    assert out["paused"] is True
    assert out["gate"]["gate"] == "g1"
    assert out["phases_run"] == 1
    assert out["total_cost_usd"] > 0
    assert out["total_tokens"] > 0
    keys = [k for k, _ in r.phases]
    assert "req" in keys        # requirements phase metered
    assert "g1" in keys         # planner gate opened
    assert ("requirements.completed") in [e for e, _ in r.audits]


def test_full_approval_flow_reaches_approved():
    app, r = make()
    start_run(app, "RUN-T2", "brief")
    resume_run(app, "RUN-T2", "approve")            # g1 -> design -> g2
    out = resume_run(app, "RUN-T2", "approve")      # g2 -> coding -> code gate
    assert out["paused"] is True
    assert out["gate"]["gate"] == "code"
    assert out["phases_run"] == 3                   # req, design, code all metered
    final = resume_run(app, "RUN-T2", "approve")    # final approve
    assert final["status"] == "approved"
    events = [e for e, _ in r.audits]
    assert "g1.approved" in events
    assert "g2.approved" in events
    assert "code.approved" in events
    # total cost accumulates across the three agent phases
    assert final["total_cost_usd"] >= out["total_cost_usd"]


def test_reject_stops_the_pipeline():
    app, r = make()
    start_run(app, "RUN-T3", "brief")
    out = resume_run(app, "RUN-T3", "reject")
    assert out["status"] == "rejected"
    assert out["paused"] is False
    assert "g1.rejected" in [e for e, _ in r.audits]
    assert {"status": "rejected", "gate": None} in r.runs


def test_a_late_approve_for_an_earlier_gate_is_refused():
    # g1 approved -> the graph runs Design and pauses at g2. A second Approve
    # meant for g1 must not land on g2.
    app, r = make()
    start_run(app, "RUN-T4", "brief")
    first = resume_run(app, "RUN-T4", "approve", gate="g1")
    assert first["resumed"] is True and first["gate"]["gate"] == "g2"
    again = resume_run(app, "RUN-T4", "approve", gate="g1")
    assert again == {"resumed": False, "reason": "stale_gate", "gate": "g2"}
    assert "g2.approved" not in [e for e, _ in r.audits]


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
    assert [e for e, _ in r.audits].count("g1.approved") == 1


def test_the_audit_actor_is_the_authenticated_reviewer():
    app, r = make()
    start_run(app, "RUN-T6", "brief")
    resume_run(app, "RUN-T6", "approve", gate="g1", actor="adesh")
    assert ("g1.approved", "adesh") in r.audits
    # Without an actor (older callers), the gate's role is recorded as before.
    resume_run(app, "RUN-T6", "approve")
    assert ("g2.approved", "Engineer") in r.audits


def test_resume_of_a_run_that_was_never_started_says_not_running():
    app, _ = make()
    out = resume_run(app, "RUN-NEVER", "approve", gate="g1")
    assert out["resumed"] is False and out["reason"] == "not_running"
