# GateKeep agents

Python. Two thin adapters over one core:

- **MCP mode** (`app/mcp/server.py`): an outside robot (Claude Desktop, Cursor) calls the 20 `gatekeep_*` tools.
- **Pipeline mode** (`app/main.py` + `app/graph.py`): GateKeep runs the agent itself.

Both act only through `GateKeepTools.call` (`app/mcp/tools.py`): it reads the run from the Node backend,
checks the phase and file policy (`app/mcp/policy.py`), records a refusal in the audit log, and only then runs
the tool. Run state (which step, who must approve) belongs to the Node backend; nothing here decides it
(`docs/adr/0001-node-owns-run-state.md`).

## Layout

- `app/mcp/tools.py`   - `GateKeepTools`: the policy-checked tools both modes use
- `app/mcp/policy.py`  - which tool may run in which step, and which files may be read or written
- `app/mcp/session.py` - client sessions; an idle session expires after `GATEKEEP_SESSION_TTL_SECONDS` (default 3600)
- `app/mcp/server.py`  - the MCP server (stdio, SSE or streamable HTTP with a token)
- `app/graph.py`       - `Pipeline.work(run_id)`: reads the run, does the step it is at (requirements, design or
                         code, with self-heal) and hands it over; keeps no state between calls
- `app/main.py`        - FastAPI: `/pipeline/{run_id}/start`, `/resume`, `/work` answer 202 and queue the run on a
                         background worker; on startup it picks up unfinished pipeline runs
- `app/llm.py`         - `GeminiLLM`, `AnthropicLLM` (both with tool calling), `FakeLLM` (offline), `get_llm()`
- `app/sandbox.py`     - the Docker test runner (no network, 512 MB, 1 CPU, read-only code)
- `app/reporter.py`    - phase metrics and work events to the Node API

## Setup and test

```bash
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt      # add `anthropic` for Claude in pipeline mode
python -m pytest -q                  # offline: fake model, fake backend, fake sandbox
```

## Pipeline mode against the Node backend

```bash
export GATEKEEP_API=http://localhost:4040
export GATEKEEP_API_TOKEN=gka_...        # npm run token:create -- --name pipeline
export GATEKEEP_PIPELINE_SECRET=...      # the same value the backend uses
uvicorn app.main:app --port 8077
```

Start a run from the dashboard (or `POST /runs/:id/start` on the backend). Gate decisions go through the
backend, which wakes the pipeline; the pipeline reads the run back and does the next step. The model is chosen
by `get_llm()`: `GEMINI_API_KEY`, else `ANTHROPIC_API_KEY` (`ANTHROPIC_MODEL`, default `claude-opus-5-5`), else
the offline fake model. Each step records `input_tokens`, `output_tokens`, `cost_usd` and `duration_ms` on its
phase.

Run **one** pipeline process (no `uvicorn --workers N`): a run is worked on by one thread at a time, and that
guard lives in the process. A step that fails (model or backend error) is retried after 10 s and 60 s, then waits
for the next gate decision or a restart; the failure is recorded on the run as `pipeline.step.failed` with
secrets removed. The coding model is offered only the five workspace tools; the hand-over to Gate 3 is done by
the pipeline itself.

Other settings:

- `GATEKEEP_WORKSPACE_ROOT`: where run workspaces live (default `agents/workspaces`). Give each deployment, or a
  throwaway test stack, its own folder so runs with the same id never share a workspace.
- `GIT_TOKEN`: GitHub token for cloning private repositories and for **Create pull request** (I6): the service
  pushes the approved code on `gatekeep/<run>` with the signed evidence and opens the PR
  (`POST /pipeline/:id/pull-request`, called by the backend only). `GATEKEEP_GITHUB_API` overrides the API address
  (tests, GitHub Enterprise).

The project policy (`gatekeep.yaml`, I5) is read from the workspace's base commit (`app/project_policy.py`) and
recorded with the backend before the first workspace tool runs; `GateKeepTools.call` then enforces it on every
call (`app/mcp/policy.py`).
