"""FastAPI wrapper around the LangGraph pipeline.

POST /pipeline/{run_id}/start   {brief}            run agents until the first gate
POST /pipeline/{run_id}/resume  {decision, gate, target}  continue after the backend recorded a decision

Both endpoints only accept calls from the GateKeep backend, which sends the
shared secret GATEKEEP_PIPELINE_SECRET after checking the reviewer's login.
"""

import os

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel

from .backend_auth import pipeline_secret_ok
from .graph import build_graph, resume_run, start_run
from .llm import get_llm
from .reporter import HttpReporter
from .sandbox import SandboxRunner
from .workspace import validate_run_id


def _checkpointer():
    """Durable Postgres checkpoints when CHECKPOINT_DB is set, so paused gates
    survive an agent restart. Falls back to in-process MemorySaver otherwise."""
    uri = os.getenv("CHECKPOINT_DB")
    if not uri:
        return MemorySaver()
    try:
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        pool = ConnectionPool(uri, open=True, kwargs={"autocommit": True, "row_factory": dict_row})
        cp = PostgresSaver(pool)
        cp.setup()
        print("Using PostgresSaver (durable checkpoints)")
        return cp
    except Exception as e:  # pragma: no cover - infra dependent
        print(f"PostgresSaver unavailable ({e}); using MemorySaver")
        return MemorySaver()


app = FastAPI(title="GateKeep agents")
_pipeline = build_graph(get_llm(), HttpReporter(), SandboxRunner(), _checkpointer())


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
    brief: str
    repo: str = ""
    branch: str = ""


class ResumeBody(BaseModel):
    decision: str  # "approve" | "reject" | "cancel", already recorded by the backend
    feedback: str = ""
    actor: str = ""   # the reviewer (the backend's audit log already names them)
    gate: str = ""    # the gate that was decided (g1 / g2 / g3); refused if the run moved on
    target: str = ""  # where the backend sent the run (Gate 3 reject: code or design)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/pipeline/{run_id}/start", dependencies=[Depends(require_backend)])
def start(run_id: str, body: StartBody):
    return start_run(_pipeline, safe_run_id(run_id), body.brief, body.repo, body.branch)


@app.post("/pipeline/{run_id}/resume", dependencies=[Depends(require_backend)])
def resume(run_id: str, body: ResumeBody):
    out = resume_run(_pipeline, safe_run_id(run_id), body.decision, body.feedback,
                     gate=body.gate or None, target=body.target)
    # 409 with reason "not_running" -> no live pipeline here (MCP mode).
    # 409 with reason "stale_gate"  -> the graph is paused at another gate.
    if out.get("resumed") is False:
        return JSONResponse(out, status_code=409)
    return out
