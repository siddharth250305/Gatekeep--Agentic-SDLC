"""Reports pipeline progress to the Node backend (metrics, audit, run state).
NullReporter records calls for tests instead of making HTTP requests."""

from __future__ import annotations

import os


class HttpReporter:
    def __init__(self, base: str | None = None):
        import httpx

        self._httpx = httpx
        self.base = base or os.getenv("GATEKEEP_API", "http://localhost:4040")

    def phase(self, run_id: str, key: str, **fields):
        self._httpx.put(f"{self.base}/runs/{run_id}/phases/{key}", json=fields, timeout=8)

    def run(self, run_id: str, **fields):
        self._httpx.patch(f"{self.base}/runs/{run_id}", json=fields, timeout=8)

    def audit(self, run_id: str, event: str, actor: str, payload: dict | None = None):
        self._httpx.post(
            f"{self.base}/runs/{run_id}/audit",
            json={"event": event, "actor": actor, "payload": payload or {}},
            timeout=8,
        )

    def tests(self, run_id: str, **fields):
        self._httpx.put(f"{self.base}/runs/{run_id}/tests", json=fields, timeout=8)

    def artifacts(self, run_id: str, **fields):
        self._httpx.put(f"{self.base}/runs/{run_id}/artifacts", json=fields, timeout=8)

    def event(self, run_id: str, type: str, data: dict | None = None):
        """Transient WebSocket event (not persisted)."""
        try:
            self._httpx.post(f"{self.base}/runs/{run_id}/event", json={"type": type, "data": data or {}}, timeout=5)
        except Exception:
            pass  # transient UX only; never block the pipeline

    def repo_context(self, run_id: str, context: dict):
        """Store the UI-safe repository context (no source, no secrets)."""
        self._httpx.put(f"{self.base}/runs/{run_id}/context", json=context, timeout=8)


class NullReporter:
    def __init__(self):
        self.phases: list[tuple[str, dict]] = []
        self.runs: list[dict] = []
        self.audits: list[tuple[str, str]] = []
        self.tests_reported: list[dict] = []

    def phase(self, run_id, key, **fields):
        self.phases.append((key, fields))

    def run(self, run_id, **fields):
        self.runs.append(fields)

    def audit(self, run_id, event, actor, payload=None):
        self.audits.append((event, actor))

    def tests(self, run_id, **fields):
        self.tests_reported.append(fields)

    def artifacts(self, run_id, **fields):
        self.artifacts_reported = getattr(self, "artifacts_reported", [])
        self.artifacts_reported.append(fields)

    def event(self, run_id, type, data=None):
        self.events = getattr(self, "events", [])
        self.events.append((type, data or {}))

    def repo_context(self, run_id, context):
        self.repo_contexts = getattr(self, "repo_contexts", [])
        self.repo_contexts.append(context)
