"""Tests for MCP SessionManager.

Validates that:
  - Session IDs are valid UUIDs
  - Sessions map to runs and workspaces properly
  - Backend validation handles success and failure
  - Multiple sessions can exist
"""

from unittest.mock import MagicMock, patch
import pytest

from app.mcp.session import SessionManager, McpSession


def test_create_session_generates_uuid():
    """Verify create_session generates a valid UUID and McpSession instance."""
    sm = SessionManager(base_url="http://test-backend")
    
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"id": "RUN-1000", "brief": "test"}

    with patch("httpx.get", return_value=mock_resp), patch("httpx.post", return_value=mock_resp):
        session = sm.create_session("RUN-1000", provider="claude", client="claude-code")
        assert session is not None
        assert session.run_id == "RUN-1000"
        assert session.provider == "claude"
        assert session.client == "claude-code"
        assert len(session.session_id) == 36  # UUID length
        assert sm.get_session(session.session_id) == session


def test_create_session_validates_run():
    """Verify ValueError is raised if the backend returns 404 for run."""
    sm = SessionManager(base_url="http://test-backend")
    
    with patch("httpx.get", side_effect=Exception("404 Not Found")):
        with pytest.raises(ValueError, match="Run RUN-9999 not found"):
            sm.create_session("RUN-9999")


def test_get_session_returns_none_for_unknown():
    """Verify None is returned when querying an unknown session ID."""
    sm = SessionManager(base_url="http://test-backend")
    assert sm.get_session("non-existent-id") is None


def test_get_session_by_run_finds_session():
    """Verify lookup by run_id finds the bound session."""
    sm = SessionManager(base_url="http://test-backend")
    
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.get", return_value=mock_resp), patch("httpx.post", return_value=mock_resp):
        created = sm.create_session("RUN-1001", provider="cursor")
        found = sm.get_session_by_run("RUN-1001")
        assert found is not None
        assert found.session_id == created.session_id


def test_resolve_workspace_returns_absolute_path():
    """Verify resolved workspace ends with the run_id and is absolute."""
    sm = SessionManager(base_url="http://test-backend")
    
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.get", return_value=mock_resp), patch("httpx.post", return_value=mock_resp):
        session = sm.create_session("RUN-1002")
        ws = sm.resolve_workspace(session)
        assert ws.endswith("RUN-1002")
        assert ws.startswith("/")


def test_multiple_sessions():
    """Verify multiple sessions can be maintained independently."""
    sm = SessionManager(base_url="http://test-backend")
    
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.get", return_value=mock_resp), patch("httpx.post", return_value=mock_resp):
        s1 = sm.create_session("RUN-1003", provider="claude")
        s2 = sm.create_session("RUN-1004", provider="openai")
        
        assert s1.session_id != s2.session_id
        assert sm.get_session(s1.session_id) == s1
        assert sm.get_session(s2.session_id) == s2
