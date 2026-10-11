# GateKeep — Progress

_Last updated: 2026-09-26_

GateKeep is a governed multi-agent pipeline: AI agents turn a feature brief into
reviewed, tested code, behind human approval gates, grounded in a real
repository, on a tamper-evident cryptographic audit chain.

---

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | React 18 + JavaScript (JSX), Vite, Tailwind v3, lucide-react, Geist fonts, native WebSocket |
| Backend API | Node.js + Express, `pg`, `ws`, Node `crypto` (SHA-256), tests via `node --test` + `pg-mem` |
| Database | PostgreSQL 16 (Docker) |
| AI agents | Python 3.13, LangGraph (`interrupt()` + `PostgresSaver`), FastAPI + uvicorn, httpx, Anthropic SDK (optional), pytest |
| Execution | Docker isolated sandbox (`gatekeep-sandbox` = `python:3.12-slim` + pytest), git |

```
React ──HTTP/WS──▶ Node/Express ──▶ PostgreSQL
                        └──HTTP──▶ Python/LangGraph ──▶ Docker sandbox + git clone
```

---

## What is built (and verified working)

### Layer 1 — Tamper-evident audit chain ✅
- Real per-run SHA-256 hash chain (`backend/src/audit/`), genesis + `prev_hash` linkage.
- `POST /runs/:id/audit/verify` recomputes the chain and pinpoints the broken seq.
- Tamper = a real DB `UPDATE`; verification catches it. Proven live (chain goes red).

### Layer 2 — Run state + API ✅
- Tables: `runs`, `run_phases` (per-phase cost/tokens), `test_results`, `run_artifacts`, `run_repo_context`.
- REST: create/list/get run, update phase, tests, artifacts, context. Assembled `GET /runs/:id`.

### Layer 3 — Human gates + realtime + frontend ✅
- `POST /runs/:id/decide` (approve/reject), role-gated; advances the pipeline.
- WebSocket broadcasts → the UI updates live, no refresh.
- Frontend fully wired to the API (no mock data driving it); Approve forwards to the agent.

### Layer 4 — LangGraph agents + metering ✅
- Requirements → Gate 1 → Design → Gate 2 → Coding → final gate, as a `StateGraph`.
- Per-phase token + cost metering into `run_phases`.
- Durable `PostgresSaver` checkpoints — paused gates survive an agent restart (proven).

### Layer 5 — Docker sandbox + self-heal ✅
- Generated tests run in an isolated container: no network, capped mem/cpu/pids, non-root, read-only.
- Self-heal loop scaffold (run → fail → fix → re-run).

### Repository fetch ✅
- Real `git clone` (public repos; `GIT_TOKEN` for private) into `agents/workspaces/<run_id>/`.
- Records real commit SHA; shows real files.

### Repository Context Engine ✅ (newest)
- **Scanner** — recursive, typed file records; ignores VCS/build/dep dirs, binaries, secrets.
- **Manifest** — languages %, entry points, dependency/test/doc files. No invented data.
- **Retriever** — deterministic hybrid ranking (filename, path, content, import graph, test links), type-weighted, explainable `reasons`. No embeddings/vector DB.
- **Security** — sensitive files excluded; secret redaction on any content; audit stores only paths+method.
- **Tools** — workspace-scoped `list_files/read_file/search_code/write_file/apply_patch` (no shell).
- Wired into LangGraph: `fetch → context → requirements/design/coding`; agents receive grounded context; coding agent modifies the real workspace; UI **Repository Context** panel shows selected files + why.
- Proven live: `pallets/itsdangerous` → correctly ranked `serializer.py` (94%), `url_safe.py` (87%) with reasons.

#### Phase Review & Dedicated Sub-Routing ✅ (newest)
- **Phase Review (Specs & Design)** — Dedicated view for Phase 1 (Requirements user stories, Given/When/Then, injection defense) and Phase 2 (Technical Design file plan, STRIDE threat model, architecture manifest) with phase review commenting.
- **Dedicated Code Review View** — Preserves the persistent header while providing a dedicated multi-file navigator (`+add` / `-rem`), syntax-highlighted line diffs, "View full file" modal, "Copy code" with feedback, and "Download .patch" unified diff export.
- **Inline Line-Level Commenting** — Hover or click `+` on any changed line of code to leave inline comments. Comments are displayed directly beneath the code line with reviewer name, role, timestamp, and delete action.
- **Dedicated Test Results View** — Clear container isolation specs (Docker image, network: none, memory: 512m, cpu: 1 core, read-only rootfs) and interactive pytest console log viewer (stdout/stderr execution logs, exit codes, pass/fail counts).
- **Agent Rework Feedback Loop** — PRD-compliant rework loop. When changes are requested at Gate 1, Gate 2, or Gate 3, all inline comments and overall guidance are bundled into `feedback`. The LangGraph pipeline loops back (`G1 -> Requirements`, `G2 -> Design`, `G3 -> Coding`), executes the LLM with the reviewer's comments in context, and presents refreshed artifacts and test runs.
- **Zero Dead Buttons** — Every UI button is genuinely functional (Copy Run ID, Copy Git Branch, Download .patch, Export Audit Log JSON, Full File view, Real Search filtering).

### Tests
- **Python: 21 passed, 2 skipped** (metering, graph flow, rework routes, sandbox, workspace, scanner/manifest/retrieval/security/tools, full repo-context integration).
- **Node: 25 passed** (audit chain, run state, gates, rework/reject handling, artifacts, HTTP flows).
- **Frontend: build clean (Vite built in ~900ms).**

---

## Status by phase

| Phase | Status |
|---|---|
| Audit chain (L1) | ✅ done, tested, live |
| Run state + API (L2) | ✅ done, tested |
| Gates + realtime + UI (L3) | ✅ done, tested, live |
| Agents + metering (L4) | ✅ done, tested, live |
| Docker sandbox (L5) | ✅ done, tested, live |
| Repo fetch + Context Engine | ✅ done, tested, live |
| Real LLM reasoning | ✅ Google Gemini live & verified |
| Autonomous ReAct Loop | ✅ Tool-calling live & verified |
| Dedicated Phase & Code Review | ✅ Multi-file diffs & inline comments live |
| Dedicated Test Results | ✅ Container specs & pytest logs live |
| Agent Rework Loop | ✅ Feedback injected on gate rejection |
| Dependency-install build phase | ⬜ out of scope, future |
| Auth / multi-user / deploy | ⬜ future |

---

## Run it

```bash
./scripts/dev.sh start   # Postgres + API(:4000) + agents(:8077) + UI(:5173)
# open http://localhost:5173  ->  + New run  ->  brief + a real repo (e.g. pallets/itsdangerous)
./scripts/dev.sh reset   # fresh demo data
./scripts/dev.sh stop
```

See `MANUAL_TEST.md` for a click-by-click walkthrough.

## Recommended next step
Wire the real Anthropic tool-calling loop (`list_files/read_file/search_code/write_file/apply_patch`)
so the Coding Agent makes intelligent, grounded edits, then add the
dependency-install build phase so real-world repos run their full suites.
