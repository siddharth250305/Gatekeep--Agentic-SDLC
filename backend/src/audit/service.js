// Audit-chain persistence. Storage on top of the pure chain in chain.js.

import { withTransaction } from '../db.js'
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

// Lock the run's chain head for the rest of the transaction and return it.
// Runs that predate audit_heads get their head created from the current tail.
async function lockHead(tx, runId) {
  const sel = 'SELECT seq, hash FROM audit_heads WHERE run_id = $1 FOR UPDATE'
  let head = (await tx.query(sel, [runId])).rows[0]
  if (head) return head
  const tail = (await tx.query(
    'SELECT seq, hash FROM audit_events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1',
    [runId],
  )).rows[0]
  await tx.query(
    'INSERT INTO audit_heads (run_id, seq, hash) VALUES ($1, $2, $3) ON CONFLICT (run_id) DO NOTHING',
    [runId, tail ? Number(tail.seq) : 0, tail ? tail.hash : GENESIS],
  )
  head = (await tx.query(sel, [runId])).rows[0]
  return head
}

// Append an event to a run's chain: lock the head, link prev_hash, compute the
// new hash, insert, move the head. All in one transaction, so two writers on
// the same run can never both claim the same seq or fork the chain. When
// called with a client that is already in a transaction (e.g. decideGate), the
// event commits or rolls back together with the state change it records.
// Postgres stores event / actor / created_at as TEXT. Hashing a number or an
// object and then storing its string form would break verification forever, so
// only accept the exact types that round-trip unchanged.
const MAX_TEXT = 200

function requireText(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`)
  if (value.length > MAX_TEXT) throw new Error(`${name} must be at most ${MAX_TEXT} characters`)
}

// "__proto__" keys do not survive object building the same way on every path,
// so they could slip out of the hash. Reject them anywhere in the payload.
function hasProtoKey(value) {
  if (Array.isArray(value)) return value.some(hasProtoKey)
  if (value && typeof value === 'object') {
    return Object.keys(value).some((k) => k === '__proto__' || hasProtoKey(value[k]))
  }
  return false
}

export function validateEvent({ runId, event, actor, payload = {}, createdAt } = {}) {
  requireText('runId', runId)
  requireText('event', event)
  requireText('actor', actor)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object')
  }
  if (hasProtoKey(payload)) throw new Error('payload must not contain "__proto__" keys')
  if (createdAt !== undefined && (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt)))) {
    throw new Error('createdAt must be an ISO date string')
  }
}

export async function appendEvent(db, { runId, event, actor, payload = {}, createdAt } = {}) {
  validateEvent({ runId, event, actor, payload, createdAt })

  return withTransaction(db, async (tx) => {
    const head = await lockHead(tx, runId)
    const seq = Number(head.seq) + 1
    const prevHash = head.hash
    const createdAtIso = createdAt || new Date().toISOString()
    const hash = computeHash({ seq, event, actor, payload, createdAt: createdAtIso, prevHash })

    const res = await tx.query(
      `INSERT INTO audit_events (run_id, seq, event, actor, payload, created_at, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [runId, seq, event, actor, JSON.stringify(payload), createdAtIso, prevHash, hash],
    )
    await tx.query('UPDATE audit_heads SET seq = $1, hash = $2 WHERE run_id = $3', [seq, hash, runId])
    return toEvent(res.rows[0])
  })
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
