import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRun, decideGate, getRun, updateRun, upsertPhase } from '../src/runs/service.js'
import { seed } from '../src/runs/seed.js'
import { createApp } from '../src/app.js'
import { freshDb as emptyDb } from './helpers/db.js'
import { asReviewer } from './helpers/auth.js'

// Fresh database with the demo runs loaded (RUN-0427 awaits the Engineer).
async function freshDb() {
  const db = await emptyDb()
  await seed(db)
  return db
}


test('approve as the assigned role completes the run + appends audit', async () => {
  const db = await freshDb()
  const before = await getRun(db, 'RUN-0427')
  assert.equal(before.awaiting, true)
  assert.equal(before.auditChain.length, 4)

  const { run } = await decideGate(db, 'RUN-0427', { decision: 'approve', actor: 'adrt25', role: 'Engineer' })
  assert.equal(run.status, 'approved')
  assert.equal(run.awaiting, false)
  assert.equal(run.gate, null)
  assert.equal(run.steps.find((s) => s.key === 'code').state, 'approved')
  assert.equal(run.steps.find((s) => s.key === 'out').state, 'approved')
  // a real audit event was appended, chain still verifies
  assert.equal(run.auditChain.length, 5)
  assert.equal(run.auditChain.at(-1).event, 'code.approved')
  assert.equal(run.verified, true)
})

test('reject marks the run rejected + records feedback', async () => {
  const db = await freshDb()
  const { run } = await decideGate(db, 'RUN-0427', {
    decision: 'reject', actor: 'adrt25', role: 'Engineer', feedback: 'add tests for the 429 path',
  })
  assert.equal(run.status, 'rejected')
  assert.equal(run.steps.find((s) => s.key === 'code').state, 'rejected')
  assert.equal(run.auditChain.at(-1).event, 'code.rejected')
  assert.equal(run.auditChain.at(-1).payload.feedback, 'add tests for the 429 path')
})

test('wrong role cannot decide the gate', async () => {
  const db = await freshDb()
  const out = await decideGate(db, 'RUN-0427', { decision: 'approve', role: 'Planner' })
  assert.equal(out.error, 'wrong_role')
  assert.equal(out.gate, 'Engineer')
})

test('no active gate returns an error (already rejected run)', async () => {
  const db = await freshDb()
  const out = await decideGate(db, 'RUN-0425', { decision: 'approve', role: 'Engineer' })
  assert.equal(out.error, 'no_active_gate')
})

test('HTTP decide broadcasts a run.updated event', async () => {
  const db = await freshDb()
  const events = []
  const app = createApp(db, (msg) => events.push(msg))
  const engineer = await asReviewer(db, 'Engineer', 'adrt25')
  const server = app.listen(0)
  const { port } = server.address()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/runs/RUN-0427/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...engineer },
      body: JSON.stringify({ decision: 'approve' }),
    })
    assert.equal(res.status, 200)
    const run = await res.json()
    assert.equal(run.status, 'approved')
    assert.deepEqual(events.at(-1), { type: 'run.updated', runId: 'RUN-0427' })
    // The audit actor is the logged-in reviewer, not anything from the body.
    assert.equal(run.auditChain.at(-1).actor, 'adrt25')
  } finally {
    server.close()
  }
})

test('HTTP decide with wrong role -> 403', async () => {
  const db = await freshDb()
  const app = createApp(db)
  const planner = await asReviewer(db, 'Planner')
  const server = app.listen(0)
  const { port } = server.address()
  try {
    // Claiming another role in the body changes nothing: the login decides.
    const res = await fetch(`http://127.0.0.1:${port}/runs/RUN-0427/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...planner },
      body: JSON.stringify({ decision: 'approve', role: 'Engineer' }),
    })
    assert.equal(res.status, 403)
  } finally {
    server.close()
  }
})

test('a repeated approve cannot push the run past an agent phase', async () => {
  // Before E6, the second click approved whatever phase was active next
  // (here the agent's Design phase), so the run skipped straight to Gate 2.
  const db = await emptyDb()
  await createRun(db, { runId: 'RUN-R', brief: 'retry' })
  await upsertPhase(db, 'RUN-R', 'req', { state: 'approved', status: 'Complete' })
  await upsertPhase(db, 'RUN-R', 'g1', { state: 'active', status: 'Ready for review' })
  await updateRun(db, 'RUN-R', { status: 'awaiting_gate', gate: 'Planner' })

  const first = await decideGate(db, 'RUN-R', { decision: 'approve', actor: 'p', role: 'Planner' })
  assert.equal(first.run.steps.find((s) => s.key === 'design').state, 'active')

  const second = await decideGate(db, 'RUN-R', { decision: 'approve', actor: 'p', role: 'Planner' })
  assert.equal(second.error, 'no_active_gate')
  const run = await getRun(db, 'RUN-R')
  assert.equal(run.steps.find((s) => s.key === 'design').state, 'active')
})

test('a missing role is refused, not skipped', async () => {
  const db = await freshDb()
  const out = await decideGate(db, 'RUN-0427', { decision: 'approve', actor: 'x' })
  assert.equal(out.error, 'wrong_role')
})
