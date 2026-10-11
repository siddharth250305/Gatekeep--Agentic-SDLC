// Audit-chain persistence. Storage on top of the pure chain in chain.js.

import { GENESIS, computeHash, verifyChain } from './chain.js'

// Map a DB row (snake_case) to the shape chain.js expects (camelCase).
function toEvent(row) {
  return {
    seq: Number(row.seq),
    event: row.event,
    actor: row.actor,
    payload: row.payload ?? {},
    createdAt: row.created_at,
    prevHash: row.prev_hash,
    hash: row.hash,
  }
}

// Append an event to a run's chain. Reads the run's tail, links prev_hash,
// computes the new hash, inserts.
//
// Concurrency: appends to the SAME run are assumed serial (the orchestrator
// drives one run's events in order; gates are one human action at a time). For
// multi-writer safety, wrap this in a transaction with
// `SELECT pg_advisory_xact_lock(hashtext($run_id))`. Omitted for v1 so the same
// code runs under pg-mem in tests.
export async function appendEvent(db, { runId, event, actor, payload = {}, createdAt } = {}) {
  if (!runId) throw new Error('runId is required')
  if (!event) throw new Error('event is required')
  if (!actor) throw new Error('actor is required')

  const tail = await db.query(
    'SELECT seq, hash FROM audit_events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1',
    [runId],
  )
  const last = tail.rows[0]
  const seq = last ? Number(last.seq) + 1 : 1
  const prevHash = last ? last.hash : GENESIS
  const createdAtIso = createdAt || new Date().toISOString()
  const hash = computeHash({ seq, event, actor, payload, createdAt: createdAtIso, prevHash })

  const res = await db.query(
    `INSERT INTO audit_events (run_id, seq, event, actor, payload, created_at, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [runId, seq, event, actor, JSON.stringify(payload), createdAtIso, prevHash, hash],
  )
  return toEvent(res.rows[0])
}

export async function getChain(db, runId) {
  const res = await db.query(
    'SELECT * FROM audit_events WHERE run_id = $1 ORDER BY seq ASC',
    [runId],
  )
  return res.rows.map(toEvent)
}

export async function verifyRun(db, runId) {
  const events = await getChain(db, runId)
  return { runId, ...verifyChain(events) }
}

// DEMO / dev only. A REAL database mutation: rewrites a past event's payload and
// does NOT recompute its hash, so verifyRun() then reports the chain broken at
// that seq. This is the honest tamper demonstration, not a UI animation.
export async function tamperEvent(db, runId, seq, newPayload) {
  const res = await db.query(
    'UPDATE audit_events SET payload = $1 WHERE run_id = $2 AND seq = $3 RETURNING *',
    [JSON.stringify(newPayload ?? {}), runId, Number(seq)],
  )
  return res.rows[0] ? toEvent(res.rows[0]) : null
}
