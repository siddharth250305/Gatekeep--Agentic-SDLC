// E6: state changes and audit appends are transactional and serialized.
// These need real Postgres (npm run test:pg); pg-mem does not enforce locks
// or roll back, so under plain `npm test` they are skipped.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendEvent, getChain, verifyRun } from '../src/audit/service.js'
import { seed } from '../src/runs/seed.js'
import { addComment, cancelRun, createRun, decideGate, getRun, robotAction } from '../src/runs/service.js'
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
  await robotAction(db, 'RUN-G1', 'submit_requirements', { agent: 'mcp' })

  const results = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map((username, i) =>
      decideGate(db, 'RUN-G1', { decision: 'approve', user: { id: i + 1, username, role: 'Planner' } })),
  )

  assert.equal(results.filter((r) => r.run).length, 1)
  // The losers see the run already at the robot's Design step.
  assert.ok(results.filter((r) => r.error).every((r) => r.error === 'not_allowed' && r.step === 'design'))

  // Without the lock, a second approval landed on the now-active Design
  // phase and pushed the run straight past it.
  const run = await getRun(db, 'RUN-G1')
  const state = Object.fromEntries(run.steps.map((s) => [s.key, s.state]))
  assert.deepEqual(state, { req: 'approved', g1: 'approved', design: 'active', g2: 'pending', code: 'pending', g3: 'pending', done: 'pending' })
  const events = run.auditChain.map((e) => e.event)
  assert.deepEqual(events, ['run.created', 'requirements.submitted', 'g1.approved'])
})

test('five copies of one robot submission at once: one move, one audit entry', { skip: NEEDS_PG }, async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-R5', brief: 'race' })
  const results = await Promise.all(
    Array.from({ length: 5 }, () => robotAction(db, 'RUN-R5', 'submit_requirements', { agent: 'mcp' })),
  )
  assert.ok(results.every((r) => r.run))
  assert.equal(results.filter((r) => !r.unchanged).length, 1)
  const run = await getRun(db, 'RUN-R5')
  assert.equal(run.step, 'g1')
  assert.equal(run.auditChain.filter((e) => e.event === 'requirements.submitted').length, 1)
})

test('approve and cancel at the same moment: exactly one wins', { skip: NEEDS_PG }, async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-AC', brief: 'race' })
  await robotAction(db, 'RUN-AC', 'submit_requirements', { agent: 'mcp' })
  const planner = { id: 1, username: 'p', role: 'Planner' }
  const [a, c] = await Promise.all([
    decideGate(db, 'RUN-AC', { decision: 'approve', user: planner }),
    cancelRun(db, 'RUN-AC', { user: { id: 2, username: 'e', role: 'Engineer' } }),
  ])
  const run = await getRun(db, 'RUN-AC')
  const moves = run.auditChain.filter((e) => e.event === 'g1.approved' || e.event === 'run.cancelled')
  assert.equal(moves.length, a.run && c.run ? 2 : 1)
  // Whatever the order, the end state matches the audit log: either cancelled,
  // or approved and then cancelled from Design (cancel is allowed there).
  assert.equal(run.auditChain.at(-1).payload.to, run.step)
  assert.ok(['design', 'cancelled'].includes(run.step))
})

test('a decision that fails half-way changes nothing', { skip: NEEDS_PG }, async () => {
  const db = await freshDb()
  await seed(db)
  const before = await getRun(db, 'RUN-0427')
  // A username longer than the audit limit makes appendEvent throw AFTER the
  // run and phase rows were updated inside the transaction.
  await assert.rejects(
    decideGate(db, 'RUN-0427', { decision: 'approve', user: { id: 77, username: 'x'.repeat(500), role: 'Engineer' } }),
    /actor must be at most/,
  )
  const run = await getRun(db, 'RUN-0427')
  assert.equal(run.status, 'awaiting_gate')
  assert.equal(run.step, 'g3')
  assert.equal(run.steps.find((s) => s.key === 'g3').state, 'active')
  assert.equal(run.auditChain.length, before.auditChain.length)
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
