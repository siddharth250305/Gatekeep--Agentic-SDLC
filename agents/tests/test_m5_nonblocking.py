"""G6: slow model, network and Docker work never freezes the Python servers.

The pipeline service answers start/resume at once and does the step on a
background worker. The MCP server runs every tool off the event loop, so one
slow call (a 30 s sandbox run) does not hold up the others."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock

import httpx
from fastapi.testclient import TestClient

from app import main
from app.mcp import server

SECRET = {"x-gatekeep-pipeline-secret": "s3cret-value"}


class SlowPipeline:
    """work() blocks until *release* is set (or *delay* passes), so tests
    control exactly when a step ends instead of racing a timer."""

    def __init__(self, delay=0.0, fail=False, barrier=None):
        self.delay = delay
        self.fail = fail
        self.barrier = barrier
        self.calls: list[str] = []
        self.started = threading.Event()
        self.release = threading.Event()
        self._lock = threading.Lock()

    def work(self, run_id):
        with self._lock:
            self.calls.append(run_id)
        self.started.set()
        if self.barrier is not None:
            self.barrier.wait()  # every run must be inside work() at once
        elif self.delay:
            self.release.wait(self.delay)
        if self.fail:
            raise RuntimeError("boom")
        return {"run_id": run_id, "did": None}

    def runs_needing_work(self):
        return ["RUN-A", "RUN-B"]


def _client(monkeypatch, pipeline):
    monkeypatch.setenv("GATEKEEP_PIPELINE_SECRET", "s3cret-value")
    worker = main.Worker(pipeline, retry_delays=())
    monkeypatch.setattr(main, "worker", worker)
    return TestClient(main.app), worker


def test_start_answers_at_once_while_the_step_runs_in_the_background(monkeypatch):
    slow = SlowPipeline(delay=1.0)
    client, worker = _client(monkeypatch, slow)
    t0 = time.perf_counter()
    r = client.post("/pipeline/RUN-1/start", json={"brief": "x"}, headers=SECRET)
    assert time.perf_counter() - t0 < 0.5
    assert r.status_code == 202 and r.json()["accepted"] is True
    assert slow.started.wait(2)
    slow.release.set()
    assert worker.drain(5)
    assert slow.calls == ["RUN-1"]


def test_resume_answers_at_once(monkeypatch):
    slow = SlowPipeline(delay=1.0)
    client, worker = _client(monkeypatch, slow)
    t0 = time.perf_counter()
    r = client.post("/pipeline/RUN-1/resume", json={"decision": "approve", "gate": "g1"}, headers=SECRET)
    assert time.perf_counter() - t0 < 0.5
    assert r.status_code == 202
    slow.release.set()
    assert worker.drain(5)


def test_the_server_stays_responsive_during_a_slow_step(monkeypatch):
    slow = SlowPipeline(delay=1.0)
    client, worker = _client(monkeypatch, slow)
    client.post("/pipeline/RUN-1/start", json={"brief": "x"}, headers=SECRET)
    assert slow.started.wait(2)
    t0 = time.perf_counter()
    assert client.get("/health").status_code == 200
    assert time.perf_counter() - t0 < 0.3
    slow.release.set()
    assert worker.drain(5)


def test_wakeups_during_a_step_run_it_once_more_not_once_per_wakeup():
    slow = SlowPipeline(delay=5)
    worker = main.Worker(slow, retry_delays=())
    worker.submit("R")
    assert slow.started.wait(2)
    assert worker.submit("R") == "again"  # a decision lands while the step is still running
    assert worker.submit("R") == "again"
    slow.release.set()
    assert worker.drain(5)
    assert slow.calls == ["R", "R"]


def test_a_wakeup_after_the_step_finished_runs_it_again():
    slow = SlowPipeline()
    worker = main.Worker(slow, retry_delays=())
    worker.submit("R")
    assert worker.drain(5)
    worker.submit("R")
    assert worker.drain(5)
    assert slow.calls == ["R", "R"]


def test_different_runs_are_worked_on_in_parallel():
    # Both steps must be inside work() together, or the barrier times out.
    slow = SlowPipeline(barrier=threading.Barrier(2, timeout=5))
    worker = main.Worker(slow, retry_delays=())
    worker.submit("A")
    worker.submit("B")
    assert worker.drain(10)
    assert sorted(slow.calls) == ["A", "B"]
    assert not slow.barrier.broken


def test_a_crashing_step_does_not_stop_the_worker():
    failing = SlowPipeline(fail=True)
    worker = main.Worker(failing, retry_delays=())
    worker.submit("R")
    assert worker.drain(5)
    worker.submit("R")
    assert worker.drain(5)
    assert failing.calls == ["R", "R"]


def test_recover_queues_every_run_the_backend_says_needs_work():
    slow = SlowPipeline()
    worker = main.Worker(slow, retry_delays=())
    assert sorted(worker.recover()) == ["RUN-A", "RUN-B"]
    assert worker.drain(5)
    assert sorted(slow.calls) == ["RUN-A", "RUN-B"]


def test_recover_survives_an_unreachable_backend():
    pipeline = SlowPipeline()
    pipeline.runs_needing_work = MagicMock(side_effect=httpx.ConnectError("down"))
    assert main.Worker(pipeline).recover() == []


def test_slow_mcp_tool_calls_do_not_block_each_other(monkeypatch):
    # Each call waits until all three are running at once. On the event loop
    # they would run one after another and the barrier would break.
    barrier = threading.Barrier(3, timeout=5)
    tools = MagicMock()
    tools.list_runs.side_effect = lambda: (barrier.wait(), [])[1]
    monkeypatch.setattr(server, "tools", tools)

    async def three_at_once():
        await asyncio.gather(*(server.mcp.call_tool("gatekeep_list_runs", {}) for _ in range(3)))

    asyncio.run(three_at_once())
    assert tools.list_runs.call_count == 3
    assert not barrier.broken


def test_requirements_pin_an_mcp_sdk_that_runs_sync_tools_off_the_event_loop():
    reqs = (Path(main.__file__).resolve().parent.parent / "requirements.txt").read_text()
    assert "mcp>=2.3" in reqs
