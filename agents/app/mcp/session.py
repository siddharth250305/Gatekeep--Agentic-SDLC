"""MCP session management — maps external agent connections to GateKeep runs.

Each MCP session binds a (provider, client) pair to exactly one run_id.
Sessions are validated against the Node backend on creation and audit-logged.
A session idle longer than its TTL expires: it is dropped here and ended in the
backend, so the dashboard stops showing it as connected (G8). Nothing binds a
session at startup; one is created on a client's first call for a run.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx

from ..backend_auth import auth_headers
from ..workspace import WORKSPACES, validate_run_id

log = logging.getLogger("gatekeep.mcp")

# What a backend call can fail with: transport and HTTP status errors, or a
# body that is not valid JSON (json.JSONDecodeError is a ValueError).
BACKEND_ERRORS = (httpx.HTTPError, ValueError)

# How long a session may sit unused before it expires (seconds).
DEFAULT_TTL_SECONDS = 3600

@dataclass
class McpSession:
    """A single MCP client ↔ GateKeep run binding."""
    session_id: str
    run_id: str
    provider: str
    client: str
    created_at: str
    workspace: str | None
    tool_calls: int = 0
    model: str | None = None
    last_used: float = field(default_factory=time.monotonic)  # clock() reading of the last use


class SessionManager:
    """In-memory session store with backend validation, audit registration
    and an idle timeout."""

    def __init__(self, base_url: str | None = None, ttl_seconds: float | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self.base_url = base_url or os.getenv("GATEKEEP_API", "http://localhost:4040")
        if ttl_seconds is None:
            ttl_seconds = float(os.getenv("GATEKEEP_SESSION_TTL_SECONDS", DEFAULT_TTL_SECONDS))
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._sessions: dict[str, McpSession] = {}
        # Tools run on worker threads: guard the store, and make "find or
        # create the session for this run" one step (one session per run).
        self._lock = threading.RLock()
        self._create_lock = threading.Lock()
        # Sessions whose "ended" never reached the backend; sent again later
        # so the dashboard does not show them as connected forever.
        self._unsent_ends: set[str] = set()

    def create_session(
        self,
        run_id: str,
        provider: str | None = None,
        client: str | None = None,
        model: str | None = None,
    ) -> McpSession:
        """Create and register a new MCP session, validating the run exists."""
        validate_run_id(run_id)
        self._resend_ends()
        self.sweep_expired()
        provider = provider or os.getenv("MCP_PROVIDER", "claude")
        client = client or os.getenv("MCP_CLIENT", "claude-desktop")

        # Validate run_id against the backend
        try:
            resp = httpx.get(f"{self.base_url}/runs/{run_id}", headers=auth_headers(), timeout=10.0)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ValueError(f"Run {run_id} not found or backend unreachable: {exc}") from exc

        session_id = str(uuid.uuid4())
        workspace = str(WORKSPACES / run_id)

        model = model or os.getenv("MCP_MODEL", "Sonnet 5.5")

        session = McpSession(
            session_id=session_id,
            run_id=run_id,
            provider=provider,
            client=client,
            created_at=datetime.now(UTC).isoformat(),
            workspace=workspace,
            tool_calls=0,
            model=model,
            last_used=self._clock(),
        )

        with self._lock:
            self._sessions[session_id] = session
        self._register_in_backend(session)
        return session

    def session_for_run(self, run_id: str) -> McpSession:
        """The live session for a run, created on first use. Calls arriving
        together for one run get the same session."""
        with self._create_lock:
            return self.get_session_by_run(run_id) or self.create_session(run_id)

    def record_tool_call(self, session_id: str, tool_name: str) -> None:
        """Increment tool call counter and update last_tool on backend."""
        session = self.get_session(session_id)
        if session:
            with self._lock:
                session.tool_calls += 1
                count = session.tool_calls
            try:
                resp = httpx.patch(
                    f"{self.base_url}/mcp/sessions/{session_id}",
                    json={
                        "tool_calls": count,
                        "last_tool": tool_name,
                        "last_tool_at": datetime.now(UTC).isoformat(),
                    },
                    headers=auth_headers(),
                    timeout=5.0,
                )
                resp.raise_for_status()
            except BACKEND_ERRORS as exc:
                log.warning("record_tool_call warning: %s", exc)

    def _expired(self, session: McpSession) -> bool:
        return self._clock() - session.last_used > self.ttl_seconds

    def get_session(self, session_id: str) -> McpSession | None:
        """Look up a live session by its ID. Using it keeps it alive; an
        expired one is ended and None is returned."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            expired = self._expired(session)
            if not expired:
                session.last_used = self._clock()
        if expired:
            self.end_session(session_id)
            return None
        return session

    def get_session_by_run(self, run_id: str) -> McpSession | None:
        """Find the first live session for a given run."""
        with self._lock:
            candidates = [(sid, s) for sid, s in self._sessions.items() if s.run_id == run_id]
        for session_id, session in candidates:
            if self.get_session(session_id):
                return session
        return None

    def sweep_expired(self) -> list[str]:
        """End every expired session. Returns their IDs."""
        with self._lock:
            expired = [sid for sid, s in self._sessions.items() if self._expired(s)]
        for sid in expired:
            self.end_session(sid)
        return expired

    def end_session(self, session_id: str) -> None:
        """Drop a session and mark it ended in the backend (best effort)."""
        with self._lock:
            if self._sessions.pop(session_id, None) is None:
                return
        self._send_end(session_id)

    def _send_end(self, session_id: str) -> None:
        try:
            resp = httpx.post(f"{self.base_url}/mcp/sessions/{session_id}/end", json={},
                              headers=auth_headers(), timeout=5.0)
            resp.raise_for_status()
        except BACKEND_ERRORS as exc:
            log.warning("session end warning (will retry): %s", exc)
            with self._lock:
                self._unsent_ends.add(session_id)
            return
        with self._lock:
            self._unsent_ends.discard(session_id)

    def _resend_ends(self) -> None:
        with self._lock:
            pending = list(self._unsent_ends)
        for session_id in pending:
            self._send_end(session_id)

    def resolve_workspace(self, session: McpSession) -> str:
        """Resolve the absolute workspace directory for a session."""
        return session.workspace or str(WORKSPACES / session.run_id)

    def _register_in_backend(self, session: McpSession) -> None:
        """Register the session in the backend MCP sessions table + audit log."""
        try:
            # Register in mcp_sessions table
            resp = httpx.post(f"{self.base_url}/mcp/sessions", json={
                "session_id": session.session_id,
                "run_id": session.run_id,
                "provider": session.provider,
                "client": session.client,
                "model": session.model,
            }, headers=auth_headers(), timeout=10.0)
            resp.raise_for_status()
        except BACKEND_ERRORS as exc:
            log.warning("session registration warning: %s", exc)

        try:
            # Audit log entry
            # The backend stamps the actor (the agent token) and the time.
            resp = httpx.post(f"{self.base_url}/runs/{session.run_id}/audit", json={
                "event": "mcp.session.created",
                "payload": {
                    "session_id": session.session_id,
                    "provider": session.provider,
                    "client": session.client,
                },
            }, headers=auth_headers(), timeout=10.0)
            resp.raise_for_status()
        except BACKEND_ERRORS as exc:
            log.warning("audit registration warning: %s", exc)
