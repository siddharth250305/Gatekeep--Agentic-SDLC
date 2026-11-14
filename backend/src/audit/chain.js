// HMAC-SHA256 per-run audit chain. Pure functions, no database.
//
// Each event's stamp covers its own fields, its run id AND the previous
// event's stamp, so any later change to a past event, or an event copied in
// from another run, no longer matches (E4).
//
// The stamp is an HMAC with a key kept outside the database, in the
// GATEKEEP_AUDIT_KEY environment variable (E1). Someone who can edit the
// database can recompute plain SHA-256 hashes, but not these stamps.
// The run's latest stamp is also kept in audit_heads with its own HMAC
// (headMac), so deleting the last entries is detected too (E4).

import { createHmac } from 'node:crypto'

// Genesis prev_hash for seq 1 of every run (64 zeros).
export const GENESIS = '0'.repeat(64)

const MIN_KEY_LENGTH = 32

// The stamping key. Missing or short: refuse (fail closed), never fall back
// to unkeyed hashes.
export function auditKey() {
  const key = process.env.GATEKEEP_AUDIT_KEY
  if (!key) throw new Error('GATEKEEP_AUDIT_KEY is not set: the audit diary cannot be stamped')
  if (key.length < MIN_KEY_LENGTH) throw new Error(`GATEKEEP_AUDIT_KEY must be at least ${MIN_KEY_LENGTH} characters`)
  return key
}

// Recursively sort object keys so serialization is deterministic regardless of
// insertion order or storage round-trips.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    // fromEntries defines own properties, so no key (not even "__proto__")
    // can turn into a prototype and drop out of the serialized bytes.
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonicalize(value[k])]),
    )
  }
  return value
}

export function canonicalBytes({ runId, seq, event, actor, payload, createdAt, prevHash }) {
  const obj = canonicalize({
    run_id: runId,
    seq,
    event,
    actor,
    payload: payload ?? {},
    created_at: createdAt,
    prev_hash: prevHash,
  })
  return Buffer.from(JSON.stringify(obj), 'utf8')
}

export function computeHash(fields, key = auditKey()) {
  return createHmac('sha256', key).update(canonicalBytes(fields)).digest('hex')
}

// The HMAC that seals a run's head (its latest seq and stamp).
export function headMac({ runId, seq, hash }, key = auditKey()) {
  const bytes = Buffer.from(JSON.stringify({ head: true, run_id: runId, seq: Number(seq), hash }), 'utf8')
  return createHmac('sha256', key).update(bytes).digest('hex')
}

// events: array of { runId, seq, event, actor, payload, createdAt, prevHash, hash }
// ordered by seq ascending. head: { runId, seq, hash, mac } from audit_heads,
// or null when the run has no head row. Every entry must link and match its
// HMAC, and the last one must be the sealed head.
export function verifyChain(events, head, key = auditKey()) {
  let expectedPrev = GENESIS
  for (const e of events) {
    // 1. Linkage: this event must point at the previous event's hash.
    if (e.prevHash !== expectedPrev) {
      return {
        valid: false,
        brokenAt: e.seq,
        reason: 'prev_hash_mismatch',
        expectedPrevHash: expectedPrev,
        storedPrevHash: e.prevHash,
      }
    }
    // 2. Integrity: recomputing the stamp from stored fields must match.
    const recomputed = computeHash(e, key)
    if (recomputed !== e.hash) {
      return {
        valid: false,
        brokenAt: e.seq,
        reason: 'hash_mismatch',
        recomputedHash: recomputed,
        storedHash: e.hash,
      }
    }
    expectedPrev = e.hash
  }
  // 3. Completeness: the chain must end exactly at the sealed head.
  if (!head) {
    return events.length ? { valid: false, brokenAt: null, reason: 'head_missing' } : { valid: true, length: 0 }
  }
  if (head.mac !== headMac(head, key)) {
    return { valid: false, brokenAt: Number(head.seq), reason: 'head_mismatch' }
  }
  const last = events.at(-1)
  const tailSeq = last ? last.seq : 0
  if (Number(head.seq) !== tailSeq || head.hash !== (last ? last.hash : GENESIS)) {
    return {
      valid: false,
      brokenAt: tailSeq + 1,
      reason: Number(head.seq) > tailSeq ? 'truncated' : 'head_mismatch',
      expectedLength: Number(head.seq),
      storedLength: events.length,
    }
  }
  return { valid: true, length: events.length }
}
