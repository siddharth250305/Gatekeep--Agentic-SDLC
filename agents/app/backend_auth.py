"""Credentials for talking to the GateKeep backend, in both directions.

- Outgoing: the agent services (MCP server, pipeline reporter) send an agent
  API token from GATEKEEP_API_TOKEN (create one with `npm run token:create`
  in backend/). The backend lets agent tokens submit work but never approve.
- Incoming: the pipeline's HTTP endpoints only accept calls that carry the
  shared secret GATEKEEP_PIPELINE_SECRET, which only the backend knows, so a
  paused gate can only be resumed after the backend checked a reviewer's login.
"""

from __future__ import annotations

import hmac
import os


def auth_headers() -> dict[str, str]:
    """Authorization header for backend calls (empty when no token is set)."""
    token = os.getenv("GATEKEEP_API_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def pipeline_secret_ok(presented: str | None) -> bool:
    """True only if a secret is configured and the caller presented exactly it."""
    expected = os.getenv("GATEKEEP_PIPELINE_SECRET", "")
    return bool(expected) and hmac.compare_digest(expected.encode(), (presented or "").encode())
