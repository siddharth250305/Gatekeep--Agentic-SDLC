// Milestone 3, E4 + E1: the audit diary can be trusted against someone with
// database access. Each stamp is an HMAC-SHA256 with a key kept outside the
// database (E1) and covers the run id (E4); the latest stamp is anchored in
// audit_heads with its own HMAC, so deleting the last entries is detected (E4).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { GENESIS, auditKey, canonicalBytes, computeHash } from '../src/audit/chain.js'
import { appendEvent, getChain, verifyRun } from '../src/audit/service.js'
import { createRun, getRun } from '../src/runs/service.js'
import { freshDb } from './helpers/db.js'

const plainSha = (fields) => createHash('sha256').update(canonicalBytes(fields)).digest('hex')

async function chainOf(db, runId, n = 4) {
  for (let i = 1; i <= n; i++) {
    await appendEvent(db, { runId, event: `step.${i}`, actor: 'eli', payload: { i } })
  }
  return getChain(db, runId)
}

test('E1: the stamp is keyed: the same entry gives a different stamp with another key', () => {
  const e = { runId: 'R', seq: 1, event: 'x', actor: 'a', payload: {}, createdAt: '2026-11-14T00:00:00Z', prevHash: GENESIS }
  assert.notEqual(computeHash(e), plainSha(e))
  assert.notEqual(computeHash(e, 'k'.repeat(32)), computeHash(e, 'j'.repeat(32)))
})

test('E1: no key, or a short key, refuses to stamp (fail closed)', () => {
  const saved = process.env.GATEKEEP_AUDIT_KEY
  try {
    delete process.env.GATEKEEP_AUDIT_KEY
    assert.throws(() => auditKey(), /GATEKEEP_AUDIT_KEY/)
    process.env.GATEKEEP_AUDIT_KEY = 'short'
    assert.throws(() => auditKey(), /at least 32/)
  } finally {
    process.env.GATEKEEP_AUDIT_KEY = saved
  }
})

test('E1: editing a row and recomputing every plain SHA-256 stamp is detected', async () => {
  const db = await freshDb()
  const chain = await chainOf(db, 'RUN-E1')
  // The attacker knows the stamp format (the code is public) but not the key.
  let prev = chain[0].hash
  for (const e of chain.slice(1)) {
    const forged = { ...e, payload: e.seq === 2 ? { i: 'backdoor' } : e.payload, prevHash: prev }
    forged.hash = plainSha(forged)
    await db.query('UPDATE audit_events SET payload = $1, prev_hash = $2, hash = $3 WHERE run_id = $4 AND seq = $5',
      [JSON.stringify(forged.payload), forged.prevHash, forged.hash, 'RUN-E1', e.seq])
    prev = forged.hash
  }
  await db.query('UPDATE audit_heads SET hash = $1 WHERE run_id = $2', [prev, 'RUN-E1'])
  const v = await verifyRun(db, 'RUN-E1')
  assert.equal(v.valid, false)
  assert.equal(v.brokenAt, 2)
  assert.equal(v.reason, 'hash_mismatch')
})

test('E4: deleting the last entry is detected', async () => {
  const db = await freshDb()
  await chainOf(db, 'RUN-E4')
  await db.query('DELETE FROM audit_events WHERE run_id = $1 AND seq = 4', ['RUN-E4'])
  const v = await verifyRun(db, 'RUN-E4')
  assert.equal(v.valid, false)
  assert.equal(v.reason, 'truncated')
  assert.equal(v.brokenAt, 4)
})

test('E4: deleting every entry of a run is detected', async () => {
  const db = await freshDb()
  await chainOf(db, 'RUN-E4B')
  await db.query('DELETE FROM audit_events WHERE run_id = $1', ['RUN-E4B'])
  const v = await verifyRun(db, 'RUN-E4B')
  assert.equal(v.valid, false)
  assert.equal(v.reason, 'truncated')
})

test('E4: moving the head back to an earlier entry is detected (the head has its own HMAC)', async () => {
  const db = await freshDb()
  const chain = await chainOf(db, 'RUN-E4C')
  await db.query('DELETE FROM audit_events WHERE run_id = $1 AND seq = 4', ['RUN-E4C'])
  await db.query('UPDATE audit_heads SET seq = 3, hash = $1 WHERE run_id = $2', [chain[2].hash, 'RUN-E4C'])
  const v = await verifyRun(db, 'RUN-E4C')
  assert.equal(v.valid, false)
  assert.equal(v.reason, 'head_mismatch')
})

test('E4: deleting the head row is detected, and nothing more can be appended', async () => {
  const db = await freshDb()
  await chainOf(db, 'RUN-E4D')
  await db.query('DELETE FROM audit_events WHERE run_id = $1 AND seq = 4', ['RUN-E4D'])
  await db.query('DELETE FROM audit_heads WHERE run_id = $1', ['RUN-E4D'])
  assert.equal((await verifyRun(db, 'RUN-E4D')).reason, 'head_missing')
  // Appending must not quietly rebuild the head from the shortened chain.
  await assert.rejects(appendEvent(db, { runId: 'RUN-E4D', event: 'x', actor: 'a' }), /audit head/)
})

test('E4: entries copied from another run are detected (the run id is in the stamp)', async () => {
  const db = await freshDb()
  const source = await chainOf(db, 'RUN-SRC', 2)
  await chainOf(db, 'RUN-DST', 2)
  await db.query('DELETE FROM audit_events WHERE run_id = $1', ['RUN-DST'])
  for (const e of source) {
    await db.query(
      `INSERT INTO audit_events (run_id, seq, event, actor, payload, created_at, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['RUN-DST', e.seq, e.event, e.actor, JSON.stringify(e.payload), e.createdAt, e.prevHash, e.hash],
    )
  }
  await db.query('UPDATE audit_heads SET hash = $1 WHERE run_id = $2', [source[1].hash, 'RUN-DST'])
  const v = await verifyRun(db, 'RUN-DST')
  assert.equal(v.valid, false)
  assert.equal(v.brokenAt, 1)
})

test('an intact chain still verifies, and its head matches the last entry', async () => {
  const db = await freshDb()
  const chain = await chainOf(db, 'RUN-OK', 3)
  assert.deepEqual(await verifyRun(db, 'RUN-OK'), { runId: 'RUN-OK', valid: true, length: 3 })
  const head = (await db.query('SELECT seq, hash, mac FROM audit_heads WHERE run_id = $1', ['RUN-OK'])).rows[0]
  assert.equal(Number(head.seq), 3)
  assert.equal(head.hash, chain[2].hash)
  assert.match(head.mac, /^[0-9a-f]{64}$/)
})

// ── Review findings: a forged head can never be re-sealed by the next append ──

test('E4: a rolled-back head is refused on the next append, not re-sealed', async () => {
  const db = await freshDb()
  const chain = await chainOf(db, 'RUN-RB')
  await db.query('DELETE FROM audit_events WHERE run_id = $1 AND seq = 4', ['RUN-RB'])
  await db.query('UPDATE audit_heads SET seq = 3, hash = $1 WHERE run_id = $2', [chain[2].hash, 'RUN-RB'])
  await assert.rejects(appendEvent(db, { runId: 'RUN-RB', event: 'g3.approved', actor: 'eli' }), /audit head/)
  assert.equal((await verifyRun(db, 'RUN-RB')).valid, false)
})

test('E4: a head with no seal (from before the seal existed) is refused on append', async () => {
  const db = await freshDb()
  await chainOf(db, 'RUN-NS', 2)
  await db.query('UPDATE audit_heads SET mac = NULL WHERE run_id = $1', ['RUN-NS'])
  await assert.rejects(appendEvent(db, { runId: 'RUN-NS', event: 'x', actor: 'a' }), /audit head/)
})

test('E4: a sealed head that does not match the last entry is refused on append', async () => {
  const db = await freshDb()
  await chainOf(db, 'RUN-TL', 3)
  await db.query('DELETE FROM audit_events WHERE run_id = $1 AND seq = 3', ['RUN-TL']) // head left sealed at 3
  await assert.rejects(appendEvent(db, { runId: 'RUN-TL', event: 'x', actor: 'a' }), /audit head/)
})

test('E4: wiping a run diary (entries and head) and starting again is detected', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-WIPE', brief: 'x' })
  await db.query('DELETE FROM audit_events WHERE run_id = $1', ['RUN-WIPE'])
  await db.query('DELETE FROM audit_heads WHERE run_id = $1', ['RUN-WIPE'])
  // A run that exists can only start a new diary with its "run.created" entry.
  await assert.rejects(appendEvent(db, { runId: 'RUN-WIPE', event: 'g1.approved', actor: 'pat' }), /audit head/)
  assert.equal((await getRun(db, 'RUN-WIPE')).verified, false)
})
