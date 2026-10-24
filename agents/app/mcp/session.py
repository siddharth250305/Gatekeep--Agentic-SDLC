"""MCP session management — maps external agent connections to GateKeep runs.

Each MCP session binds a (provider, client) pair to exactly one run_id.
Sessions are validated against the Node backend on creation and audit-logged.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Absolute root for workspaces so paths resolve correctly regardless of cwd.
_WORKSPACES = Path(__file__).resolve().parent.parent.parent / "workspaces"


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


class SessionManager:
    """In-memory session store with backend validation and audit registration."""

    def __init__(self, base_url: str | None = None):
        self.base_url = base_url or os.getenv("GATEKEEP_API", "http://localhost:4040")
        self._sessions: dict[str, McpSession] = {}

    def create_session(
        self,
        run_id: str,
        provider: str | None = None,
        client: str | None = None,
    ) -> McpSession:
        """Create and register a new MCP session, validating the run exists."""
        provider = provider or os.getenv("MCP_PROVIDER", "claude")
        client = client or os.getenv("MCP_CLIENT", "claude-desktop")

        # Validate run_id against the backend
        try:
            resp = httpx.get(f"{self.base_url}/runs/{run_id}", timeout=10.0)
            resp.raise_for_status()
        except Exception as exc:
            raise ValueError(f"Run {run_id} not found or backend unreachable: {exc}")

        session_id = str(uuid.uuid4())
        workspace = str(_WORKSPACES / run_id)

        model = os.getenv("MCP_MODEL", "Sonnet 5.5")

        session = McpSession(
            session_id=session_id,
            run_id=run_id,
            provider=provider,
            client=client,
            created_at=datetime.now(timezone.utc).isoformat(),
            workspace=workspace,
            tool_calls=0,
            model=model,
        )

        self._sessions[session_id] = session
        self._register_in_backend(session)
        return session

    def record_tool_call(self, session_id: str, tool_name: str) -> None:
        """Increment tool call counter and update last_tool on backend."""
        session = self.get_session(session_id)
        if session:
            session.tool_calls += 1
            try:
                httpx.patch(
                    f"{self.base_url}/mcp/sessions/{session_id}",
                    json={
                        "tool_calls": session.tool_calls,
                        "last_tool": tool_name,
                        "last_tool_at": datetime.now(timezone.utc).isoformat(),
                    },
                    timeout=5.0,
                )
            except Exception as exc:
                print(f"[mcp] record_tool_call warning: {exc}")

    def auto_register_startup(self) -> McpSession | None:
        """On agent startup, bind to the active/awaiting run so the UI shows connection immediately."""
        try:
            resp = httpx.get(f"{self.base_url}/runs", timeout=5.0)
            if resp.status_code == 200:
                runs = resp.json()
                if runs:
                    target = next((r for r in runs if r.get("status") == "awaiting_gate"), runs[0])
                    return self.create_session(target["id"])
        except Exception as exc:
            print(f"[mcp] auto-register warning: {exc}")
        return None

    def get_session(self, session_id: str) -> McpSession | None:
        """Look up a session by its unique ID."""
        return self._sessions.get(session_id)

    def get_session_by_run(self, run_id: str) -> McpSession | None:
        """Find the first active session for a given run."""
        for session in self._sessions.values():
            if session.run_id == run_id:
                return session
        return None

    def resolve_workspace(self, session: McpSession) -> str:
        """Resolve the absolute workspace directory for a session."""
        return session.workspace or str(_WORKSPACES / session.run_id)

    def _register_in_backend(self, session: McpSession) -> None:
        """Register the session in the backend MCP sessions table + audit log."""
        try:
            # Register in mcp_sessions table
            httpx.post(f"{self.base_url}/mcp/sessions", json={
                "session_id": session.session_id,
                "run_id": session.run_id,
                "provider": session.provider,
                "client": session.client,
                "model": session.model,
            }, timeout=10.0)
        except Exception as exc:
            print(f"[mcp] session registration warning: {exc}")

        try:
            # Audit log entry
            httpx.post(f"{self.base_url}/runs/{session.run_id}/audit", json={
                "event": "mcp.session.created",
                "actor": f"mcp-{session.provider}",
                "payload": {
                    "session_id": session.session_id,
                    "client": session.client,
                },
            }, timeout=10.0)
        except Exception as exc:
            print(f"[mcp] audit registration warning: {exc}")
