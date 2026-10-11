import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GENESIS, computeHash, verifyChain } from '../src/audit/chain.js'

const base = {
  seq: 1,
  event: 'run.created',
  actor: 'ml-priya',
  payload: { brief: 'rate limit' },
  createdAt: '2026-09-19T14:02:00Z',
  prevHash: GENESIS,
}

// Build a valid chain of N linked events.
function buildChain(n) {
  const events = []
  let prevHash = GENESIS
  for (let i = 1; i <= n; i++) {
    const e = {
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
  assert.deepEqual(verifyChain(buildChain(4)), { valid: true, length: 4 })
})

test('verifyChain detects a mutated payload (hash_mismatch)', () => {
  const chain = buildChain(4)
  chain[1].payload = { i: 999 } // mutate seq 2, leave its stored hash
  const r = verifyChain(chain)
  assert.equal(r.valid, false)
  assert.equal(r.brokenAt, 2)
  assert.equal(r.reason, 'hash_mismatch')
})

test('verifyChain detects a broken link (prev_hash_mismatch)', () => {
  const chain = buildChain(4)
  chain[2].prevHash = 'a'.repeat(64) // seq 3 points nowhere
  chain[2].hash = computeHash(chain[2]) // attacker even fixes seq 3's own hash
  const r = verifyChain(chain)
  assert.equal(r.valid, false)
  assert.equal(r.brokenAt, 3)
  assert.equal(r.reason, 'prev_hash_mismatch')
})

test('genesis: first event links to 64 zeros', () => {
  assert.equal(buildChain(1)[0].prevHash, GENESIS)
})
