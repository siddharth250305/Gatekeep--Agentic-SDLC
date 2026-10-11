// SHA-256 per-run hash chain. Pure functions, no database.
//
// Each event's hash covers its own fields AND the previous event's hash, so any
// later mutation of a past event is detectable: recomputing the chain from the
// stored fields no longer matches the stored hashes.
//
// Tamper-EVIDENT (plain SHA-256). To make it tamper-PROOF against an attacker
// who can recompute the whole chain, add a keyed HMAC over the same preimage
// using a server secret. Left as a v2 upgrade.

import { createHash } from 'node:crypto'

// Genesis prev_hash for seq 1 of every run (64 zeros).
export const GENESIS = '0'.repeat(64)

// Recursively sort object keys so serialization is deterministic regardless of
// insertion order or storage round-trips.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canonicalize(value[k])
        return acc
      }, {})
  }
  return value
}

export function canonicalBytes({ seq, event, actor, payload, createdAt, prevHash }) {
  const obj = canonicalize({
    seq,
    event,
    actor,
    payload: payload ?? {},
    created_at: createdAt,
    prev_hash: prevHash,
  })
  return Buffer.from(JSON.stringify(obj), 'utf8')
}

export function computeHash(fields) {
  return createHash('sha256').update(canonicalBytes(fields)).digest('hex')
}

// events: array of { seq, event, actor, payload, createdAt, prevHash, hash }
// ordered by seq ascending.
export function verifyChain(events) {
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
    // 2. Integrity: recomputing the hash from stored fields must match.
    const recomputed = computeHash(e)
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
  return { valid: true, length: events.length }
}
