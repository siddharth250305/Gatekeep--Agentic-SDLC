import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newDb } from 'pg-mem'
import { runSchema } from '../src/db.js'
import { getRun, decideGate } from '../src/runs/service.js'
import { seed } from '../src/runs/seed.js'
import { createApp } from '../src/app.js'

async function freshDb() {
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  await runSchema(pool)
  await seed(pool)
  return pool
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
  const server = app.listen(0)
  const { port } = server.address()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/runs/RUN-0427/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', role: 'Engineer', actor: 'adrt25' }),
    })
    assert.equal(res.status, 200)
    const run = await res.json()
    assert.equal(run.status, 'approved')
    assert.deepEqual(events.at(-1), { type: 'run.updated', runId: 'RUN-0427' })
  } finally {
    server.close()
  }
})

test('HTTP decide with wrong role -> 403', async () => {
  const db = await freshDb()
  const app = createApp(db)
  const server = app.listen(0)
  const { port } = server.address()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/runs/RUN-0427/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', role: 'Planner' }),
    })
    assert.equal(res.status, 403)
  } finally {
    server.close()
  }
})
