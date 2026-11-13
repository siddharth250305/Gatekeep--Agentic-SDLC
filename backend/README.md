# GateKeep backend

Node.js + Express + PostgreSQL. The foundation layer: a **tamper-evident,
per-run SHA-256 audit chain** with a verification endpoint. Every later phase
(agents, gates, sandbox) appends to this chain.

## Why it is real

- Each audit event's `hash` = SHA-256 over its own fields **plus the previous
  event's hash** (`src/audit/chain.js`).
- Each run has its own chain, starting from a genesis hash of 64 zeros.
- `verify` recomputes every hash from the stored fields and checks each link.
  Any mutation of a past row makes the recomputed hash diverge from the stored
  one, and `verify` reports the exact `seq` that broke.
- The tamper demo is a **real `UPDATE`** on the payload (hash left untouched),
  not a UI animation. See the demo below.

## Run

```bash
docker compose up -d db          # Postgres on :5432
cp .env.example .env
npm install
npm start                        # API on :4040 (creates the table on boot)
```

## Test

```bash
npm test        # in-memory Postgres (pg-mem), no infra needed
npm run test:pg # the same suite on a real Postgres, including the locking tests
```

## API

**Runs (run state, owned by the state machine in `src/runs/machine.js`)**

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| GET  | `/runs` | any login | list runs (id, brief, status, cost) |
| POST | `/runs` | reviewer | create `{ brief, description?, repo?, branch?, commit?, runId? }`; starts at Requirements; the reviewer is recorded as the requester |
| GET  | `/runs/:runId` | any login | full run: `step`, steps, totals, sandbox, tests, audit chain, verified |
| POST | `/runs/:runId/start` | reviewer | start the agent pipeline; only once, only at Requirements (409 otherwise) |
| POST | `/runs/:runId/decide` | reviewer | `{ decision: approve\|reject, gate?, target?, feedback? }`; `gate` is the step the reviewer was looking at (409 if the run moved on); at Gate 3 a reject needs `target: code\|design` |
| POST | `/runs/:runId/cancel` | reviewer | `{ reason? }`; Planner, Engineer or Admin, from any active step |
| POST | `/runs/:runId/actions/:action` | agent | `submit_requirements`, `submit_design` or `request_review`, with optional `{ artifacts, details }`; artifacts are stored only if the move is allowed; a repeat returns 200 unchanged |
| PUT | `/runs/:runId/phases/:key` | agent | metrics only `{ cost_usd?, input_tokens?, output_tokens?, model?, duration_ms? }`; `state`, `status`, `at` get 403 |
| PUT | `/runs/:runId/tests` | agent | upsert sandbox + test result |

There is no `PATCH /runs/:runId`. Refusals: 400 bad input, 403 wrong role or the requester at Gate 3, 404 unknown run, 409 move not allowed / run finished / stale gate.

**Audit chain**

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/runs/:runId/audit` | agent | record agent work `{ event, payload? }`; `event` must start with `mcp.`, `repo.`, `workspace.`, `sandbox.` or `pipeline.`; the server sets the actor (the token's name) and the time, and refuses `actor` / `createdAt` |
| GET  | `/runs/:runId/audit` | any login | list the run's chain |
| POST | `/runs/:runId/audit/verify` | any login | verify integrity |
| POST | `/runs/:runId/audit/:seq/tamper` | Admin, demo mode only | DEMO: real DB mutation of `payload` |

**Live updates**: `POST /auth/ws-ticket` (reviewer) returns a single-use ticket valid for 30 s; the dashboard connects to `ws://…/?ticket=…`. Agent services connect with an `Authorization: Bearer` header.

Seed the 3 demo runs (RUN-0427/0426/0425) with real chains: `npm run seed`.

## Demo: watch the chain break

Start the backend with `GATEKEEP_DEMO_MODE=1 SEED_DEMO=true`, then, with an Admin's session token in `$ADMIN`:

```bash
R=RUN-0427
curl -s -XPOST localhost:4040/runs/$R/audit/verify -H "authorization: Bearer $ADMIN"   # { "valid": true, ... }

# Real database mutation of a past event's payload:
curl -s -XPOST localhost:4040/runs/$R/audit/2/tamper -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"payload":{"file":"backdoor.py"}}'

curl -s -XPOST localhost:4040/runs/$R/audit/verify -H "authorization: Bearer $ADMIN"
# { "valid": false, "brokenAt": 2, "reason": "hash_mismatch", ... }
```

## Next layers (build on this)

1. `runs` / `phase_metrics` / `test_results` tables + REST.
2. Human gates via the Python LangGraph service (`interrupt()`), WebSocket push
   for live progression.
3. Docker sandbox test runner + self-heal loop.
4. Wire the React frontend's Approval-chain panel to real `verify` + the tamper
   affordance.

## Hardening notes (v2)

- Tamper-**proof**: add a keyed HMAC over the same preimage (server secret) so an
  attacker who can recompute the chain still cannot forge it.
- Concurrency: wrap `appendEvent` in a transaction with
  `pg_advisory_xact_lock(hashtext(run_id))` for multi-writer safety.
