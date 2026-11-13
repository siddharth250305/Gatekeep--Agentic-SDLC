"""A1: only the backend (holding GATEKEEP_PIPELINE_SECRET) can start or resume
the pipeline, so nobody can approve a gate by calling the agent service directly."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app import main
from app.backend_auth import auth_headers, pipeline_secret_ok

client = TestClient(main.app)


def test_resume_without_secret_configured_fails_closed(monkeypatch):
    monkeypatch.delenv("GATEKEEP_PIPELINE_SECRET", raising=False)
    r = client.post("/pipeline/RUN-1/resume", json={"decision": "approve"})
    assert r.status_code == 503


@pytest.mark.parametrize("presented", [None, "", "wrong-secret"])
def test_resume_with_wrong_secret_is_refused(monkeypatch, presented):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    headers = {} if presented is None else {"x-gatekeep-pipeline-secret": presented}
    with patch.object(main, "resume_run") as resume:
        r = client.post("/pipeline/RUN-1/resume", json={"decision": "approve"}, headers=headers)
    assert r.status_code == 401
    resume.assert_not_called()


def test_resume_with_the_right_secret_reaches_the_pipeline(monkeypatch):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    with patch.object(main, "resume_run", return_value={"resumed": True}) as resume:
        r = client.post("/pipeline/RUN-1/resume", json={"decision": "approve", "actor": "adesh", "gate": "g1"},
                        headers={"x-gatekeep-pipeline-secret": "s3cret-value"})
    assert r.status_code == 200
    resume.assert_called_once()
    # The gate that was decided and where the backend sent the run reach the
    # graph. (The reviewer is already in the backend's audit entry.)
    assert resume.call_args.kwargs == {"gate": "g1", "target": ""}


def test_resume_passes_the_backend_target_through(monkeypatch):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    with patch.object(main, "resume_run", return_value={"resumed": True}) as resume:
        r = client.post("/pipeline/RUN-1/resume",
                        json={"decision": "reject", "gate": "g3", "target": "design", "actor": "eli"},
                        headers={"x-gatekeep-pipeline-secret": "s3cret-value"})
    assert r.status_code == 200
    assert resume.call_args.kwargs["target"] == "design"


def test_resume_of_an_already_decided_gate_is_409(monkeypatch):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    stale = {"resumed": False, "reason": "stale_gate", "gate": "g2"}
    with patch.object(main, "resume_run", return_value=stale):
        r = client.post("/pipeline/RUN-1/resume", json={"decision": "approve", "gate": "g1"},
                        headers={"x-gatekeep-pipeline-secret": "s3cret-value"})
    assert r.status_code == 409
    assert r.json()["reason"] == "stale_gate"


def test_start_rejects_unsafe_run_ids(monkeypatch):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    with patch.object(main, "start_run") as start:
        r = client.post("/pipeline/bad%20id/start", json={"brief": "x"},
                        headers={"x-gatekeep-pipeline-secret": "s3cret-value"})
    assert r.status_code == 400
    start.assert_not_called()


def test_pipeline_secret_ok_needs_a_configured_secret(monkeypatch):
    monkeypatch.delenv("GATEKEEP_PIPELINE_SECRET", raising=False)
    assert pipeline_secret_ok("") is False
    assert pipeline_secret_ok("anything") is False


def test_auth_headers_carry_the_agent_token(monkeypatch):
    monkeypatch.setenv("GATEKEEP_API_TOKEN", "gka_abc")
    assert auth_headers() == {"Authorization": "Bearer gka_abc"}
    monkeypatch.delenv("GATEKEEP_API_TOKEN")
    assert auth_headers() == {}
