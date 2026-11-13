# ADR 0001: The Node backend is the only owner of run state

- **Status:** Accepted
- **Date:** 2026-11-13
- **Plan item:** G4 in `organised.md`

## Context

Three programs currently change the state of a run (which phase is active, who must approve, whether it is finished):

1. The Node backend (`backend/src/runs/service.js`, `decideGate`).
2. The Python MCP server (`agents/app/mcp/tools.py`), which writes phase states directly with `PUT /runs/:id/phases/:key` and `PATCH /runs/:id`.
3. The Python LangGraph pipeline (`agents/app/graph.py`), which keeps its own copy of the state in memory and also writes phases through `agents/app/reporter.py`.

Because each one decides state on its own, they disagree. Examples found in review: a rejected design can be skipped, Gate 3 is assigned to "Agent" on the MCP path, and a pipeline restart leaves runs stuck (see `drawback.md` 2.2, 2.3, 2.8).

## Decision

**The Node backend is the single source of truth for run state.**

- Only the backend decides which phase is active, which role must act, and whether a run is finished.
- Every change of state goes through one backend function that checks a fixed table of allowed moves, inside a database transaction, and writes exactly one audit event.
- The Python services (MCP server and pipeline) **do work and report results**: they submit requirements, designs, files, diffs and test results. They ask the backend to move the run forward (for example "requirements submitted"), and the backend decides whether that move is allowed.
- The Python services never write `state` or `status` of a phase directly. They read the current phase from the backend on every call and fail closed when it is unclear.
- The pipeline's in-memory checkpoint is only a cache of its own progress. If it is lost, the backend's state wins.

## How we get there

This ADR is the target. It is reached step by step:

| Step | Plan item | What changes | Status |
|---|---|---|---|
| 1 | E6 (Milestone 1) | Gate decisions and audit appends run in one transaction with a row lock. | Done |
| 2 | A1 (Milestone 1) | Every caller is authenticated. Agents and humans get different rights. | Done |
| 3 | B2 (Milestone 2) | The allowed-moves table lives in the backend (`backend/src/runs/machine.js`). | Done |
| 4 | B1 (Milestone 2) | `PATCH /runs` is removed and `PUT /phases` takes metrics only. Robots move a run only with `POST /runs/:id/actions/:action`. | Done |
| 5 | G9 (Milestone 5) | The pipeline calls the same backend actions as the MCP server. | Started in Milestone 2: the pipeline now uses the robot actions and no longer writes state. Keep-or-remove and the rest of G9 remain for Milestone 5. |

## Consequences

- **Good:** one place to read and test the rules; no split-brain between services; the audit log matches the real state.
- **Good:** both ways of running GateKeep (external agent over MCP, or the built-in agent with an API key) follow the same rules, because neither owns state.
- **Cost:** the Python services need the backend to be reachable for every state change. When it is not, they must stop and report an error rather than continue. This is the intended fail-closed behaviour.
- **Cost (paid in Milestone 2):** the direct phase writes in `agents/app/mcp/tools.py` and `agents/app/reporter.py` were replaced by robot actions.
