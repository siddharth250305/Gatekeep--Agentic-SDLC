"""A1: only the backend (holding GATEKEEP_PIPELINE_SECRET) can start or resume
the pipeline, so nobody can approve a gate by calling the agent service directly."""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app import main
from app.backend_auth import auth_headers, pipeline_secret_ok

client = TestClient(main.app)


def test_resume_without_secret_configured_fails_closed(monkeypatch):
    monkeypatch.delenv("GATEKEEP_PIPELINE_SECRET", raising=False)
    r = client.post("/pipeline/RUN-1/resume", json={"decision": "approve"})
    assert r.status_code == 503


@pytest.fixture
def queue(monkeypatch):
    """main.worker replaced by a mock: these tests are about who may call."""
    worker = MagicMock()
    worker.submit.return_value = "queued"
    monkeypatch.setattr(main, "worker", worker)
    return worker


@pytest.mark.parametrize("path", ["start", "resume", "work"])
@pytest.mark.parametrize("presented", [None, "", "wrong-secret"])
def test_calls_with_a_wrong_secret_are_refused(monkeypatch, queue, path, presented):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    headers = {} if presented is None else {"x-gatekeep-pipeline-secret": presented}
    r = client.post(f"/pipeline/RUN-1/{path}", json={"decision": "approve"}, headers=headers)
    assert r.status_code == 401
    queue.submit.assert_not_called()


def test_resume_with_the_right_secret_queues_the_run(monkeypatch, queue):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    r = client.post("/pipeline/RUN-1/resume", json={"decision": "approve", "actor": "adesh", "gate": "g1"},
                    headers={"x-gatekeep-pipeline-secret": "s3cret-value"})
    assert r.status_code == 202
    assert r.json() == {"accepted": True, "run_id": "RUN-1", "queue": "queued"}
    # Only the run id is passed on: the step to do is read from the backend,
    # never taken from the request body.
    queue.submit.assert_called_once_with("RUN-1")


@pytest.mark.parametrize("path", ["start", "resume", "work"])
def test_unsafe_run_ids_are_rejected(monkeypatch, queue, path):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    r = client.post(f"/pipeline/bad%20id/{path}", json={"brief": "x"},
                    headers={"x-gatekeep-pipeline-secret": "s3cret-value"})
    assert r.status_code == 400
    queue.submit.assert_not_called()


def test_pipeline_secret_ok_needs_a_configured_secret(monkeypatch):
    monkeypatch.delenv("GATEKEEP_PIPELINE_SECRET", raising=False)
    assert pipeline_secret_ok("") is False
    assert pipeline_secret_ok("anything") is False


def test_auth_headers_carry_the_agent_token(monkeypatch):
    monkeypatch.setenv("GATEKEEP_API_TOKEN", "gka_abc")
    assert auth_headers() == {"Authorization": "Bearer gka_abc"}
    monkeypatch.delenv("GATEKEEP_API_TOKEN")
    assert auth_headers() == {}
