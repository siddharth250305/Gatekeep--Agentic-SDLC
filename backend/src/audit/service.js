// Audit-chain persistence. Storage on top of the pure chain in chain.js.

import { withTransaction } from '../db.js'
import { GENESIS, computeHash, headMac, verifyChain } from './chain.js'

// Map a DB row (snake_case) to the shape chain.js expects (camelCase).
function toEvent(row) {
  return {
    runId: row.run_id,
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
// The head is checked before it is extended: its seal must be valid and it
// must point at the last entry. Otherwise someone moved it (for example back
// to an earlier entry after deleting the newest ones), and re-sealing it
// would hide that, so the append is refused (E4).
// A head is created with a run's first entry. A run that already has entries
// but no head was tampered with; and a run that exists (has a runs row) can
// only start its diary with "run.created", so a wiped diary cannot restart.
async function lockHead(tx, runId, event) {
  const sel = 'SELECT seq, hash, mac FROM audit_heads WHERE run_id = $1 FOR UPDATE'
  let head = (await tx.query(sel, [runId])).rows[0]
  if (head) return checkedHead(tx, runId, head)
  // Two first appends at once: the INSERT of the loser waits for the winner
  // and then does nothing. Only the transaction that really created the head
  // checks the run's history, so a concurrent first event is never mistaken
  // for a deleted head.
  const created = await tx.query(
    'INSERT INTO audit_heads (run_id, seq, hash, mac) VALUES ($1, 0, $2, $3) ON CONFLICT (run_id) DO NOTHING',
    [runId, GENESIS, headMac({ runId, seq: 0, hash: GENESIS })],
  )
  if (created.rowCount === 1) {
    const any = (await tx.query('SELECT 1 FROM audit_events WHERE run_id = $1 LIMIT 1', [runId])).rows[0]
    if (any) throw new Error(`audit head missing for ${runId}: the diary was altered, so it cannot be extended`)
    const run = (await tx.query('SELECT 1 FROM runs WHERE run_id = $1', [runId])).rows[0]
    if (run && event !== 'run.created') {
      throw new Error(`audit head missing for ${runId}: the run's diary was wiped, so it cannot be restarted`)
    }
  }
  head = (await tx.query(sel, [runId])).rows[0]
  return checkedHead(tx, runId, head)
}

async function checkedHead(tx, runId, head) {
  const seq = Number(head.seq)
  if (head.mac !== headMac({ runId, seq, hash: head.hash })) {
    throw new Error(`audit head for ${runId} has no valid seal: the diary was altered, so it cannot be extended`)
  }
  const tail = (await tx.query(
    'SELECT seq, hash FROM audit_events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1', [runId],
  )).rows[0]
  if ((tail ? Number(tail.seq) : 0) !== seq || (tail ? tail.hash : GENESIS) !== head.hash) {
    throw new Error(`audit head for ${runId} does not match the last entry: the diary was altered, so it cannot be extended`)
  }
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
    const head = await lockHead(tx, runId, event)
    const seq = Number(head.seq) + 1
    const prevHash = head.hash
    const createdAtIso = createdAt || new Date().toISOString()
    const hash = computeHash({ runId, seq, event, actor, payload, createdAt: createdAtIso, prevHash })

    const res = await tx.query(
      `INSERT INTO audit_events (run_id, seq, event, actor, payload, created_at, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [runId, seq, event, actor, JSON.stringify(payload), createdAtIso, prevHash, hash],
    )
    await tx.query(
      'UPDATE audit_heads SET seq = $1, hash = $2, mac = $3 WHERE run_id = $4',
      [seq, hash, headMac({ runId, seq, hash }), runId],
    )
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
  const row = (await db.query('SELECT seq, hash, mac FROM audit_heads WHERE run_id = $1', [runId])).rows[0]
  const head = row ? { runId, seq: Number(row.seq), hash: row.hash, mac: row.mac } : null
  return { runId, ...verifyChain(events, head) }
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
