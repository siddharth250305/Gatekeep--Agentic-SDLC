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
npm start                        # API on :4000 (creates the table on boot)
```

## Test

```bash
npm test        # 11 tests, uses in-memory Postgres (pg-mem), no infra needed
```

## API

**Runs (Layer 2 - run state)**

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/runs` | list runs (id, brief, status, cost) |
| POST | `/runs` | create `{ brief, description?, repo?, branch?, commit?, runId? }` (seeds the 6-phase pipeline) |
| GET  | `/runs/:runId` | full assembled run: steps + totals + sandbox + tests + audit chain + verified |
| PATCH | `/runs/:runId` | update `{ status?, gate? }` |
| PUT | `/runs/:runId/phases/:key` | update a phase `{ state?, status?, at?, cost_usd?, input_tokens?, output_tokens?, model?, duration_ms? }` |
| PUT | `/runs/:runId/tests` | upsert sandbox + test result |

**Audit chain (Layer 1)**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/runs/:runId/audit` | append `{ event, actor, payload? }` |
| GET  | `/runs/:runId/audit` | list the run's chain |
| POST | `/runs/:runId/audit/verify` | verify integrity |
| POST | `/runs/:runId/audit/:seq/tamper` | DEMO: real DB mutation of `payload` |

Seed the 3 demo runs (RUN-0427/0426/0425) with real chains: `npm run seed`.

## Demo: watch the chain break

```bash
R=RUN-0427
curl -s -XPOST localhost:4000/runs/$R/audit -H 'content-type: application/json' \
  -d '{"event":"run.created","actor":"ml-priya"}'
curl -s -XPOST localhost:4000/runs/$R/audit -H 'content-type: application/json' \
  -d '{"event":"design.approved","actor":"o-lindqvist","payload":{"file":"throttle.py"}}'

curl -s -XPOST localhost:4000/runs/$R/audit/verify        # { "valid": true, "length": 2 }

# Real database mutation of the approved event's payload:
curl -s -XPOST localhost:4000/runs/$R/audit/2/tamper -H 'content-type: application/json' \
  -d '{"payload":{"file":"backdoor.py"}}'

curl -s -XPOST localhost:4000/runs/$R/audit/verify
# { "valid": false, "brokenAt": 2, "reason": "hash_mismatch",
#   "recomputedHash": "…", "storedHash": "…" }
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
