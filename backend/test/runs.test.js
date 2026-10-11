import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newDb } from 'pg-mem'
import { runSchema } from '../src/db.js'
import { createRun, getRun, listRuns, updateRun, upsertPhase, upsertTests, upsertArtifacts } from '../src/runs/service.js'
import { appendEvent, tamperEvent } from '../src/audit/service.js'
import { seed } from '../src/runs/seed.js'
import { createApp } from '../src/app.js'

async function freshDb() {
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  await runSchema(pool)
  return pool
}

test('createRun seeds the 6-phase pipeline', async () => {
  const db = await freshDb()
  const run = await createRun(db, { runId: 'RUN-1', brief: 'Add a thing' })
  assert.equal(run.id, 'RUN-1')
  assert.equal(run.steps.length, 6)
  assert.deepEqual(run.steps.map((s) => s.key), ['req', 'g1', 'design', 'g2', 'code', 'out'])
  assert.ok(run.steps.every((s) => s.state === 'pending'))
  assert.equal(run.totals.cost, '$0.00')
  assert.equal(run.verified, true) // empty chain is trivially valid
})

test('phase metrics roll up into totals', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-2', brief: 'x' })
  await upsertPhase(db, 'RUN-2', 'req', { state: 'approved', status: 'Approved', cost_usd: 0.12, input_tokens: 2800, output_tokens: 1380, duration_ms: 96000 })
  await upsertPhase(db, 'RUN-2', 'design', { state: 'approved', status: 'Approved', cost_usd: 0.16, input_tokens: 4100, output_tokens: 2140, duration_ms: 148000 })
  const run = await getRun(db, 'RUN-2')
  assert.equal(run.totals.cost, '$0.28')
  assert.equal(run.totals.tokens, '10,420')
  assert.equal(run.totals.wall, '4m 4s')
  const req = run.steps.find((s) => s.key === 'req')
  assert.equal(req.cost, '$0.12')
  assert.equal(req.tokens, '4,180')
})

test('tests + sandbox surface on the run', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-3', brief: 'x' })
  await upsertTests(db, 'RUN-3', { status: 'Completed', image: 'python:3.12-slim', network: 'Disabled', memory: '512 MB', cpu: '1 core', timeout: '30 seconds', passed: 14, failed: 0, total: 14, iterations: 2, duration_ms: 267000 })
  const run = await getRun(db, 'RUN-3')
  assert.equal(run.sandbox.image, 'python:3.12-slim')
  assert.equal(run.sandbox.network, 'Disabled')
  assert.equal(run.tests.passed, 14)
  assert.equal(run.tests.duration, '4m 27s')
})

test('run view carries the audit chain + verified, and detects tamper', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-4', brief: 'x' })
  await appendEvent(db, { runId: 'RUN-4', event: 'run.created', actor: 'a' })
  await appendEvent(db, { runId: 'RUN-4', event: 'design.approved', actor: 'b', payload: { file: 'ok.py' } })

  let run = await getRun(db, 'RUN-4')
  assert.equal(run.auditChain.length, 2)
  assert.equal(run.verified, true)

  await tamperEvent(db, 'RUN-4', 2, { file: 'backdoor.py' })
  run = await getRun(db, 'RUN-4')
  assert.equal(run.verified, false)
})

test('artifacts (files/diff/summary) surface on the run', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-A', brief: 'x' })
  await upsertArtifacts(db, 'RUN-A', {
    files: [{ path: 'throttle.py', add: 2, rem: 0 }],
    diff: { file: 'throttle.py', add: 2, rem: 0, lines: [{ n2: 1, type: 'add', text: 'def is_allowed(): ...' }] },
    summary: { headline: 'Ready', sub: 'done', checks: ['3/3 tests passed'] },
  })
  const run = await getRun(db, 'RUN-A')
  assert.equal(run.files[0].path, 'throttle.py')
  assert.equal(run.diff.file, 'throttle.py')
  assert.equal(run.summary.headline, 'Ready')
})

test('updateRun flips status + awaiting', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-5', brief: 'x' })
  const run = await updateRun(db, 'RUN-5', { status: 'awaiting_gate', gate: 'Engineer' })
  assert.equal(run.status, 'awaiting_gate')
  assert.equal(run.awaiting, true)
  assert.equal(run.gate, 'Engineer')
})

test('seed loads 3 demo runs; RUN-0427 is awaiting with real chain', async () => {
  const db = await freshDb()
  const n = await seed(db)
  assert.equal(n, 3)
  const list = await listRuns(db)
  assert.equal(list.length, 3)
  const r = await getRun(db, 'RUN-0427')
  assert.equal(r.awaiting, true)
  assert.equal(r.totals.cost, '$0.42')
  assert.equal(r.totals.tokens, '18,420')
  assert.equal(r.auditChain.length, 4)
  assert.equal(r.verified, true)
})

test('HTTP: create -> get -> patch, and 404 on missing', async () => {
  const db = await freshDb()
  const app = createApp(db)
  const server = app.listen(0)
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  try {
    const created = await (await fetch(`${base}/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'RUN-H', brief: 'http run' }),
    })).json()
    assert.equal(created.id, 'RUN-H')

    const got = await (await fetch(`${base}/runs/RUN-H`)).json()
    assert.equal(got.brief, 'http run')

    const patched = await (await fetch(`${base}/runs/RUN-H`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })).json()
    assert.equal(patched.status, 'approved')

    const missing = await fetch(`${base}/runs/RUN-NOPE`)
    assert.equal(missing.status, 404)
  } finally {
    server.close()
  }
})
