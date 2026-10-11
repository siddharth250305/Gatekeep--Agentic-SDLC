"""FastAPI wrapper around the LangGraph pipeline.

POST /pipeline/{run_id}/start   {brief}            run agents until the first gate
POST /pipeline/{run_id}/resume  {decision}         resume a paused gate
"""

import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel

from .graph import build_graph, resume_run, start_run
from .llm import get_llm
from .reporter import HttpReporter
from .sandbox import SandboxRunner


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


class StartBody(BaseModel):
    brief: str
    repo: str = ""
    branch: str = ""


class ResumeBody(BaseModel):
    decision: str  # "approve" | "reject"
    feedback: str = ""


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/pipeline/{run_id}/start")
def start(run_id: str, body: StartBody):
    return start_run(_pipeline, run_id, body.brief, body.repo, body.branch)


@app.post("/pipeline/{run_id}/resume")
def resume(run_id: str, body: ResumeBody):
    out = resume_run(_pipeline, run_id, body.decision, body.feedback)
    # 409 -> the run has no live pipeline here; the caller (Node) falls back.
    if out.get("resumed") is False:
        return JSONResponse(out, status_code=409)
    return out
