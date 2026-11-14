"""Reports pipeline work to the Node backend: phase metrics, work audit events
and the UI-safe repository context. Robot moves, files and test runs go
through GateKeepTools (the same core MCP mode uses). The backend state machine
owns run state, so nothing here writes a phase's state or a run's status (B1).
A refused report raises; the pipeline decides whether that stops a step."""

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
        resp = self._httpx.put(f"{self.base}/runs/{run_id}/phases/{key}", json=_metrics_only(fields),
                               headers=auth_headers(), timeout=8)
        resp.raise_for_status()

    def audit(self, run_id: str, event: str, payload: dict | None = None):
        """Record work the pipeline did. The backend stamps the actor and time."""
        resp = self._httpx.post(
            f"{self.base}/runs/{run_id}/audit",
            json={"event": event, "payload": payload or {}},
            headers=auth_headers(),
            timeout=8,
        )
        resp.raise_for_status()

    def repo_context(self, run_id: str, context: dict):
        """Store the UI-safe repository context (no source, no secrets)."""
        self._httpx.put(f"{self.base}/runs/{run_id}/context", json=context, headers=auth_headers(), timeout=8)
