"""G8: robot sessions expire, and startup attaches to no run.

A session that is idle longer than its TTL is dropped and ended in the backend
(the dashboard stops showing it as connected). Using a session keeps it alive.
On startup the MCP server binds to nothing; a session is made on first use."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx

from app.mcp import server
from app.mcp.session import SessionManager
from app.mcp.tools import GateKeepTools
from tests.conftest import BASE


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make(ttl=60):
    clock = Clock()
    return SessionManager(base_url=BASE, ttl_seconds=ttl, clock=clock), clock


def test_a_session_expires_after_the_idle_ttl_and_the_backend_is_told(node):
    node.add_run("RUN-S")
    sm, clock = make()
    s = sm.create_session("RUN-S")
    clock.t += 61
    assert sm.get_session(s.session_id) is None
    assert node.sessions[s.session_id]["status"] == "ended"


def test_using_a_session_keeps_it_alive(node):
    node.add_run("RUN-S")
    sm, clock = make()
    s = sm.create_session("RUN-S")
    clock.t += 50
    assert sm.get_session(s.session_id) is s
    clock.t += 50
    assert sm.get_session(s.session_id) is s


def test_lookup_by_run_skips_an_expired_session(node):
    node.add_run("RUN-S")
    sm, clock = make()
    sm.create_session("RUN-S")
    clock.t += 61
    assert sm.get_session_by_run("RUN-S") is None


def test_an_expired_session_is_replaced_on_the_next_tool_call(node, monkeypatch):
    node.add_run("RUN-S")
    sm, clock = make()
    monkeypatch.setattr(server, "session_manager", sm)
    monkeypatch.setattr(server, "tools", GateKeepTools(sm, base_url=BASE))
    first = server.gatekeep_get_approval_status("RUN-S")
    old = sm.get_session_by_run("RUN-S").session_id
    clock.t += 61
    second = server.gatekeep_get_approval_status("RUN-S")
    new = sm.get_session_by_run("RUN-S").session_id
    assert first == second and old != new
    assert node.sessions[old]["status"] == "ended"


def test_sweep_ends_every_expired_session(node):
    node.add_run("RUN-1")
    node.add_run("RUN-2")
    sm, clock = make()
    a = sm.create_session("RUN-1")
    clock.t += 30
    b = sm.create_session("RUN-2")
    clock.t += 40  # a is 70 s idle, b is 40 s idle
    assert sm.sweep_expired() == [a.session_id]
    assert sm.get_session(b.session_id) is b


def test_end_session_drops_it_and_tells_the_backend(node):
    node.add_run("RUN-S")
    sm, _ = make()
    s = sm.create_session("RUN-S")
    sm.end_session(s.session_id)
    assert sm.get_session(s.session_id) is None
    assert node.sessions[s.session_id]["status"] == "ended"


def test_the_ttl_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("GATEKEEP_SESSION_TTL_SECONDS", "5")
    assert SessionManager(base_url=BASE).ttl_seconds == 5


def test_startup_attaches_to_no_run(monkeypatch):
    """Before: main() bound itself to the first awaiting run, or any run."""
    calls = []
    for name in ("get", "post", "patch"):
        monkeypatch.setattr(httpx, name, lambda url, _n=name, **kw: calls.append((_n, url)))
    monkeypatch.setattr("sys.argv", ["server", "--transport", "stdio"])
    monkeypatch.setattr(server.mcp, "run", MagicMock())
    sm = SessionManager(base_url=BASE)
    monkeypatch.setattr(server, "session_manager", sm)
    server.main()
    assert calls == []
    assert sm._sessions == {}
    assert not hasattr(SessionManager, "auto_register_startup")
