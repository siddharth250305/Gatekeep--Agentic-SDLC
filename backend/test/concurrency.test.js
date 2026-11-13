// E6: state changes and audit appends are transactional and serialized.
// These need real Postgres (npm run test:pg); pg-mem does not enforce locks
// or roll back, so under plain `npm test` they are skipped.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendEvent, getChain, verifyRun } from '../src/audit/service.js'
import { seed } from '../src/runs/seed.js'
import { addComment, createRun, decideGate, getRun, updateRun, upsertPhase } from '../src/runs/service.js'
import { NEEDS_PG, freshDb } from './helpers/db.js'

test('20 concurrent appends to one run produce one valid chain', { skip: NEEDS_PG }, async () => {
  const db = await freshDb()
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => appendEvent(db, { runId: 'RUN-C', event: `e${i}`, actor: 'a' })),
  )
  const chain = await getChain(db, 'RUN-C')
  assert.deepEqual(chain.map((e) => e.seq), Array.from({ length: 20 }, (_, i) => i + 1))
  assert.deepEqual(await verifyRun(db, 'RUN-C'), { runId: 'RUN-C', valid: true, length: 20 })
})

test('five reviewers approving Gate 1 at once: one approval, Design is not skipped', { skip: NEEDS_PG }, async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-G1', brief: 'race' })
  await upsertPhase(db, 'RUN-G1', 'req', { state: 'approved', status: 'Complete' })
  await upsertPhase(db, 'RUN-G1', 'g1', { state: 'active', status: 'Ready for review' })
  await updateRun(db, 'RUN-G1', { status: 'awaiting_gate', gate: 'Planner' })

  const results = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map((actor) =>
      decideGate(db, 'RUN-G1', { decision: 'approve', actor, role: 'Planner' })),
  )

  assert.equal(results.filter((r) => r.run).length, 1)
  assert.ok(results.filter((r) => r.error).every((r) => r.error === 'no_active_gate'))

  // Without the lock, a second approval landed on the now-active Design
  // phase and pushed the run straight past it.
  const run = await getRun(db, 'RUN-G1')
  const state = Object.fromEntries(run.steps.map((s) => [s.key, s.state]))
  assert.deepEqual(state, { req: 'approved', g1: 'approved', design: 'active', g2: 'pending', code: 'pending', out: 'pending' })
  const events = run.auditChain.map((e) => e.event)
  assert.deepEqual(events, ['g1.approved'])
})

test('a decision that fails half-way changes nothing', { skip: NEEDS_PG }, async () => {
  const db = await freshDb()
  await seed(db)
  // An actor longer than the audit limit makes appendEvent throw AFTER the
  // phase row was updated inside the transaction.
  await assert.rejects(
    decideGate(db, 'RUN-0427', { decision: 'approve', actor: 'x'.repeat(500), role: 'Engineer' }),
    /actor must be at most/,
  )
  const run = await getRun(db, 'RUN-0427')
  assert.equal(run.status, 'awaiting_gate')
  assert.equal(run.steps.find((s) => s.key === 'code').state, 'active')
  assert.equal(run.auditChain.length, 4)
})

test('10 concurrent comments are all kept', { skip: NEEDS_PG }, async () => {
  const db = await freshDb()
  await seed(db)
  const before = (await getRun(db, 'RUN-0427')).comments.length
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => addComment(db, 'RUN-0427', { text: `c${i}`, author: 'a' })),
  )
  assert.equal((await getRun(db, 'RUN-0427')).comments.length, before + 10)
})

test('two first comments on a run with no artifacts row are both kept', { skip: NEEDS_PG }, async () => {
  // Before the fix there was no row to lock: both inserted it, one failed.
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-FC', brief: 'first comments' })
  await Promise.all([
    addComment(db, 'RUN-FC', { text: 'one', author: 'a' }),
    addComment(db, 'RUN-FC', { text: 'two', author: 'b' }),
  ])
  assert.deepEqual((await getRun(db, 'RUN-FC')).comments.map((c) => c.text).sort(), ['one', 'two'])
})
