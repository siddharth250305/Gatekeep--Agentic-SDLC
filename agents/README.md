# GateKeep agents (Layer 4)

Python + LangGraph. Runs the Requirements / Design / Coding agents with
`interrupt()` human gates, meters token+cost per phase, and reports everything
to the Node backend (phase metrics, audit events, run status).

Runs **offline** with a deterministic fake model (no key, no network). Set
`ANTHROPIC_API_KEY` to use a real model.

## Layout

- `app/pricing.py`  - price table + `cost_usd()`
- `app/llm.py`      - `FakeLLM` (deterministic) + `AnthropicLLM` (real) + `get_llm()`
- `app/graph.py`    - LangGraph StateGraph: agent nodes meter + report, gate nodes `interrupt()`
- `app/reporter.py` - pushes phase/audit/run updates to the Node API
- `app/main.py`     - FastAPI: `/pipeline/{run_id}/start` and `/resume`

## Setup + test

```bash
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q        # 6 tests, offline (fake model + fake reporter)
```

## Run against the Node backend

```bash
# 1. Node API on :4000 (backend/) must be running.
# 2. Start the agent service:
GATEKEEP_API=http://localhost:4000 uvicorn app.main:app --port 8077

# 3. Create a run in Node, then drive the pipeline:
curl -XPOST localhost:4000/runs -H 'content-type: application/json' \
  -d '{"runId":"RUN-9001","brief":"Add response caching"}'
curl -XPOST localhost:8077/pipeline/RUN-9001/start  -d '{"brief":"Add response caching"}' -H 'content-type: application/json'
curl -XPOST localhost:8077/pipeline/RUN-9001/resume -d '{"decision":"approve"}' -H 'content-type: application/json'   # Gate 1
curl -XPOST localhost:8077/pipeline/RUN-9001/resume -d '{"decision":"approve"}' -H 'content-type: application/json'   # Gate 2
curl -XPOST localhost:8077/pipeline/RUN-9001/resume -d '{"decision":"approve"}' -H 'content-type: application/json'   # final
```

Each agent phase records `input_tokens`, `output_tokens`, `cost_usd`, and
`duration_ms` into `run_phases`; the dashboard's per-phase cost + totals come
straight from that.

## Notes / next

- Checkpointer is `MemorySaver` (in-process). For durable, cross-process gates
  swap in `langgraph.checkpoint.postgres.PostgresSaver` against the same DB.
- The gate resume is currently driven by this service's `/resume`. Wiring the
  frontend's Approve button through Node to here (forward-on-decide) is the
  small remaining integration seam.
- Docker sandbox test execution (real pytest in a container) is Layer 5.
