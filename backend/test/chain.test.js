import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GENESIS, computeHash, headMac, verifyChain } from '../src/audit/chain.js'

process.env.GATEKEEP_AUDIT_KEY ??= 'test-audit-key-0123456789abcdef0123456789'

const base = {
  runId: 'RUN-1',
  seq: 1,
  event: 'run.created',
  actor: 'ml-priya',
  payload: { brief: 'rate limit' },
  createdAt: '2026-09-19T14:02:00Z',
  prevHash: GENESIS,
}

// The sealed head for a chain (what audit_heads holds).
function headOf(chain) {
  const last = chain.at(-1)
  const head = { runId: 'RUN-1', seq: last ? last.seq : 0, hash: last ? last.hash : GENESIS }
  return { ...head, mac: headMac(head) }
}

// Build a valid chain of N linked events.
function buildChain(n) {
  const events = []
  let prevHash = GENESIS
  for (let i = 1; i <= n; i++) {
    const e = {
      runId: 'RUN-1',
      seq: i,
      event: `event.${i}`,
      actor: 'actor',
      payload: { i },
      createdAt: `2026-09-19T14:0${i}:00Z`,
      prevHash,
    }
    e.hash = computeHash(e)
    events.push(e)
    prevHash = e.hash
  }
  return events
}

test('computeHash is deterministic', () => {
  assert.equal(computeHash(base), computeHash(base))
})

test('computeHash is order-independent for payload keys', () => {
  const a = { ...base, payload: { a: 1, b: 2 } }
  const b = { ...base, payload: { b: 2, a: 1 } }
  assert.equal(computeHash(a), computeHash(b))
})

test('computeHash changes when any field changes', () => {
  const h = computeHash(base)
  assert.notEqual(h, computeHash({ ...base, actor: 'someone-else' }))
  assert.notEqual(h, computeHash({ ...base, payload: { brief: 'changed' } }))
  assert.notEqual(h, computeHash({ ...base, prevHash: 'f'.repeat(64) }))
})

test('verifyChain passes on an intact chain', () => {
  assert.deepEqual(verifyChain(buildChain(4), headOf(buildChain(4))), { valid: true, length: 4 })
})

test('verifyChain detects a mutated payload (hash_mismatch)', () => {
  const chain = buildChain(4)
  const head = headOf(chain)
  chain[1].payload = { i: 999 } // mutate seq 2, leave its stored hash
  const r = verifyChain(chain, head)
  assert.equal(r.valid, false)
  assert.equal(r.brokenAt, 2)
  assert.equal(r.reason, 'hash_mismatch')
})

test('verifyChain detects a broken link (prev_hash_mismatch)', () => {
  const chain = buildChain(4)
  chain[2].prevHash = 'a'.repeat(64) // seq 3 points nowhere
  chain[2].hash = computeHash(chain[2]) // attacker even fixes seq 3's own hash
  const r = verifyChain(chain, headOf(chain))
  assert.equal(r.valid, false)
  assert.equal(r.brokenAt, 3)
  assert.equal(r.reason, 'prev_hash_mismatch')
})

test('genesis: first event links to 64 zeros', () => {
  assert.equal(buildChain(1)[0].prevHash, GENESIS)
})

test('computeHash covers the run id, so an entry cannot move to another run', () => {
  assert.notEqual(computeHash(base), computeHash({ ...base, runId: 'RUN-2' }))
})

test('verifyChain refuses a chain with no head, and one that stops short of its head', () => {
  const chain = buildChain(3)
  assert.equal(verifyChain(chain, null).reason, 'head_missing')
  const head = headOf(chain)
  assert.equal(verifyChain(chain.slice(0, 2), head).reason, 'truncated')
  assert.deepEqual(verifyChain([], null), { valid: true, length: 0 })
})
