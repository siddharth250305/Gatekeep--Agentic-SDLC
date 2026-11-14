"""FastAPI wrapper around the pipeline (pipeline mode).

POST /pipeline/{run_id}/start    {brief, repo, branch}             the backend started the run
POST /pipeline/{run_id}/resume   {decision, gate, target, ...}     a reviewer decided a gate
POST /pipeline/{run_id}/work     {}                                wake-up after a restart

All three queue the run on a background worker, which reads the run from the
backend and does the step it is at (graph.Pipeline). They answer 202 at once,
so a slow model, network or Docker call never holds the request or the server
(G6). Nothing about a run is kept here: on startup the worker asks the backend
which pipeline runs are at a robot step and picks them up again, so a restart
never leaves a run stuck (G9).

The endpoints only accept calls from the GateKeep backend, which sends the
shared secret GATEKEEP_PIPELINE_SECRET after checking the reviewer's login.
"""

from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .backend_auth import pipeline_secret_ok
from .graph import build_pipeline
from .llm import get_llm
from .mcp.session import SessionManager
from .mcp.tools import BACKEND_ERRORS, GateKeepTools
from .reporter import HttpReporter
from .sandbox import SandboxRunner
from .workspace import validate_run_id

log = logging.getLogger("gatekeep.pipeline")


class Worker:
    """Runs pipeline steps on background threads, one at a time per run.

    A wake-up for a run that is already being worked on is not dropped: the
    run is worked on once more when the current step ends, because a reviewer
    may have decided while the step was finishing. Several wake-ups in that
    window still mean one more pass, since each pass reads the run afresh.

    A step that fails (a model or backend error) is retried after each delay
    in *retry_delays*, then left alone; a restart or the next decision wakes
    it again. One worker process per deployment: the dedupe is in-process."""

    def __init__(self, pipeline: Any, max_workers: int = 4, retry_delays: tuple[float, ...] = (10.0, 60.0)):
        self.pipeline = pipeline
        self.retry_delays = retry_delays
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="gatekeep-step")
        self._lock = threading.Lock()
        self._active: set[str] = set()
        self._again: set[str] = set()
        self._idle = threading.Condition(self._lock)
        self._stopping = threading.Event()
        self._wake: dict[str, threading.Event] = {}  # runs waiting to retry

    def submit(self, run_id: str) -> str:
        """Queue a run. Returns "queued", or "again" when it is already running."""
        with self._lock:
            if run_id in self._active:
                self._again.add(run_id)
                if run_id in self._wake:
                    self._wake[run_id].set()  # cut a retry wait short
                return "again"
            self._active.add(run_id)
        try:
            self._pool.submit(self._loop, run_id)
        except BaseException:
            self._finish(run_id)  # never leave a run marked as running
            raise
        return "queued"

    def _work_once(self, run_id: str) -> bool:
        """One pass. True when the step failed."""
        try:
            out = self.pipeline.work(run_id)
        except Exception:  # noqa: BLE001 - one bad step must not stop the worker
            log.exception("pipeline step crashed for %s", run_id)
            return True
        log.info("pipeline %s: %s", run_id, out)
        return isinstance(out, dict) and out.get("reason") == "failed"

    def _loop(self, run_id: str) -> None:
        retries = 0
        while True:
            failed = self._work_once(run_id)
            with self._lock:
                if run_id in self._again:
                    self._again.discard(run_id)
                    retries = 0
                    continue
                if not failed or retries >= len(self.retry_delays) or self._stopping.is_set():
                    self._active.discard(run_id)
                    self._idle.notify_all()
                    return
                delay = self.retry_delays[retries]
                retries += 1
                wake = self._wake[run_id] = threading.Event()
            log.warning("pipeline step for %s failed; retry %d in %.0f s", run_id, retries, delay)
            wake.wait(delay)  # a wake-up (or shutdown) ends the wait early
            with self._lock:
                self._wake.pop(run_id, None)
                self._again.discard(run_id)  # the pass that follows reads the run afresh
            if self._stopping.is_set():
                self._finish(run_id)
                return

    def _finish(self, run_id: str) -> None:
        with self._lock:
            self._active.discard(run_id)
            self._again.discard(run_id)
            self._idle.notify_all()

    def recover(self) -> list[str]:
        """Pick up every pipeline run the backend says is at a robot step."""
        try:
            run_ids = self.pipeline.runs_needing_work()
        except BACKEND_ERRORS as exc:
            log.warning("recovery skipped, backend not reachable: %s", exc)
            return []
        except Exception:  # noqa: BLE001 - recovery must never take the service down
            log.exception("recovery failed")
            return []
        for run_id in run_ids:
            self.submit(run_id)
        log.info("recovery: %s", ", ".join(run_ids) if run_ids else "no pipeline run needs work")
        return run_ids

    def drain(self, timeout: float | None = None) -> bool:
        """Wait until no step is running (tests and shutdown)."""
        with self._idle:
            return self._idle.wait_for(lambda: not self._active, timeout)

    def shutdown(self) -> None:
        """Stop taking work and do not wait for running steps: the backend's
        state is the truth, and recovery picks the runs up on the next start."""
        self._stopping.set()
        with self._lock:
            for wake in self._wake.values():
                wake.set()
        self._pool.shutdown(wait=False, cancel_futures=True)


def _build_worker() -> Worker:
    tools = GateKeepTools(SessionManager(), runner=SandboxRunner())
    return Worker(build_pipeline(get_llm(), tools, HttpReporter()))


worker = _build_worker()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Logs go to stderr next to uvicorn's; httpx request lines stay quiet.
    logging.basicConfig(level=logging.INFO, format="[GateKeep pipeline] %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    # Off the event loop: recovery calls the backend and must not delay startup.
    threading.Thread(target=lambda: worker.recover(), name="gatekeep-recover", daemon=True).start()
    yield
    worker.shutdown()


app = FastAPI(title="GateKeep agents", lifespan=lifespan)


def require_backend(x_gatekeep_pipeline_secret: str = Header(default="")) -> None:
    """Fail closed: no configured secret, or a wrong one, means no access."""
    if not os.getenv("GATEKEEP_PIPELINE_SECRET"):
        raise HTTPException(503, "GATEKEEP_PIPELINE_SECRET is not configured")
    if not pipeline_secret_ok(x_gatekeep_pipeline_secret):
        raise HTTPException(401, "only the GateKeep backend may call the pipeline")


def safe_run_id(run_id: str) -> str:
    try:
        return validate_run_id(run_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class StartBody(BaseModel):
    # Kept for the backend's request shape; the step reads the run itself.
    brief: str = ""
    repo: str = ""
    branch: str = ""


class ResumeBody(BaseModel):
    decision: str = ""  # already recorded by the backend; the step is read from it
    feedback: str = ""
    actor: str = ""
    gate: str = ""
    target: str = ""


def _accepted(run_id: str) -> JSONResponse:
    return JSONResponse({"accepted": True, "run_id": run_id, "queue": worker.submit(run_id)}, status_code=202)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/pipeline/{run_id}/start", dependencies=[Depends(require_backend)])
async def start(run_id: str, body: StartBody):
    return _accepted(safe_run_id(run_id))


@app.post("/pipeline/{run_id}/resume", dependencies=[Depends(require_backend)])
async def resume(run_id: str, body: ResumeBody):
    return _accepted(safe_run_id(run_id))


@app.post("/pipeline/{run_id}/work", dependencies=[Depends(require_backend)])
async def work(run_id: str):
    return _accepted(safe_run_id(run_id))
