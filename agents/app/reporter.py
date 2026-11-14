"""Reports pipeline work to the Node backend: metrics, artifacts, test results,
work audit events, and robot actions (submit_requirements, submit_design,
request_review). The backend state machine owns run state, so nothing here
writes a phase's state or a run's status (B1).
NullReporter records calls for tests instead of making HTTP requests."""

from __future__ import annotations

import os

from .backend_auth import auth_headers

# Phase rows take metrics only; their state, status and time belong to the backend.
STATE_FIELDS = frozenset({"state", "status", "at"})


def _metrics_only(fields: dict) -> dict:
    forbidden = STATE_FIELDS & set(fields)
    if forbidden:
        raise ValueError(f"phase {sorted(forbidden)} can only change through the backend state machine")
    return fields


class HttpReporter:
    def __init__(self, base: str | None = None):
        import httpx

        self._httpx = httpx
        self.base = base or os.getenv("GATEKEEP_API", "http://localhost:4040")

    def phase(self, run_id: str, key: str, **fields):
        """Record a phase's metrics (cost, tokens, model, duration)."""
        self._httpx.put(f"{self.base}/runs/{run_id}/phases/{key}", json=_metrics_only(fields),
                        headers=auth_headers(), timeout=8)

    def action(self, run_id: str, action: str, artifacts: dict | None = None, details: dict | None = None,
               fingerprint: str | None = None):
        """Hand a finished step to the backend, which moves the run if allowed.
        A refusal raises, so the pipeline stops instead of carrying on.
        request_review carries the fingerprint of the code under review (B7)."""
        body: dict = {}
        if artifacts:
            body["artifacts"] = artifacts
        if details:
            body["details"] = details
        if fingerprint:
            body["fingerprint"] = fingerprint
        resp = self._httpx.post(f"{self.base}/runs/{run_id}/actions/{action}", json=body,
                                headers=auth_headers(), timeout=8)
        resp.raise_for_status()
        return resp.json()

    def audit(self, run_id: str, event: str, payload: dict | None = None):
        """Record work the pipeline did. The backend stamps the actor and time."""
        self._httpx.post(
            f"{self.base}/runs/{run_id}/audit",
            json={"event": event, "payload": payload or {}},
            headers=auth_headers(),
            timeout=8,
        )

    def test_run(self, run_id: str, **fields) -> dict:
        """Record a test run (results, each test, the sandbox profile and the
        code fingerprint it ran on). Returns the stored run, with its id."""
        resp = self._httpx.post(f"{self.base}/runs/{run_id}/test-runs", json=fields, headers=auth_headers(), timeout=8)
        resp.raise_for_status()
        return resp.json()

    def artifacts(self, run_id: str, **fields):
        self._httpx.put(f"{self.base}/runs/{run_id}/artifacts", json=fields, headers=auth_headers(), timeout=8)

    def event(self, run_id: str, type: str, data: dict | None = None):
        """Transient WebSocket event (not persisted)."""
        try:
            self._httpx.post(f"{self.base}/runs/{run_id}/event", json={"type": type, "data": data or {}}, headers=auth_headers(), timeout=5)
        except Exception:
            pass  # transient UX only; never block the pipeline

    def repo_context(self, run_id: str, context: dict):
        """Store the UI-safe repository context (no source, no secrets)."""
        self._httpx.put(f"{self.base}/runs/{run_id}/context", json=context, headers=auth_headers(), timeout=8)


class NullReporter:
    def __init__(self):
        self.phases: list[tuple[str, dict]] = []
        self.runs: list[dict] = []  # stays empty: there is no run-status writer any more
        self.actions: list[str] = []
        self.action_bodies: list[tuple[str, dict]] = []
        self.audits: list[tuple[str, dict]] = []
        self.tests_reported: list[dict] = []

    def phase(self, run_id, key, **fields):
        self.phases.append((key, _metrics_only(fields)))

    def action(self, run_id, action, artifacts=None, details=None, fingerprint=None):
        self.actions.append(action)
        self.action_bodies.append((action, {"artifacts": artifacts, "details": details, "fingerprint": fingerprint}))
        return {}

    def audit(self, run_id, event, payload=None):
        self.audits.append((event, payload or {}))

    def audit_events(self) -> list[str]:
        return [event for event, _ in self.audits]

    def test_run(self, run_id, **fields):
        self.tests_reported.append(fields)
        return {"id": f"tr-{len(self.tests_reported)}"}

    def artifacts(self, run_id, **fields):
        self.artifacts_reported = getattr(self, "artifacts_reported", [])
        self.artifacts_reported.append(fields)

    def event(self, run_id, type, data=None):
        self.events = getattr(self, "events", [])
        self.events.append((type, data or {}))

    def repo_context(self, run_id, context):
        self.repo_contexts = getattr(self, "repo_contexts", [])
        self.repo_contexts.append(context)
