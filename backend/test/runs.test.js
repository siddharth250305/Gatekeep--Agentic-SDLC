import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRun, getRun, listRuns, recordPhaseMetrics, recordTestRun, upsertTests, upsertArtifacts } from '../src/runs/service.js'
import { PASSING } from './helpers/evidence.js'
import { appendEvent, tamperEvent } from '../src/audit/service.js'
import { seed } from '../src/runs/seed.js'
import { createApp } from '../src/app.js'
import { freshDb } from './helpers/db.js'
import { asAgent, asReviewer } from './helpers/auth.js'


test('createRun seeds the 7-step pipeline, starting at Requirements', async () => {
  const db = await freshDb()
  const run = await createRun(db, { runId: 'RUN-1', brief: 'Add a thing' })
  assert.equal(run.id, 'RUN-1')
  assert.equal(run.steps.length, 7)
  assert.deepEqual(run.steps.map((s) => s.key), ['req', 'g1', 'design', 'g2', 'code', 'g3', 'done'])
  assert.equal(run.steps[0].state, 'active')
  assert.ok(run.steps.slice(1).every((s) => s.state === 'pending'))
  assert.equal(run.step, 'req')
  assert.equal(run.totals.cost, '$0.00')
  assert.equal(run.verified, true)
  assert.deepEqual(run.auditChain.map((e) => e.event), ['run.created'])
})

test('phase metrics roll up into totals', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-2', brief: 'x' })
  await recordPhaseMetrics(db, 'RUN-2', 'req', { cost_usd: 0.12, input_tokens: 2800, output_tokens: 1380, duration_ms: 96000 })
  await recordPhaseMetrics(db, 'RUN-2', 'design', { cost_usd: 0.16, input_tokens: 4100, output_tokens: 2140, duration_ms: 148000 })
  const run = await getRun(db, 'RUN-2')
  assert.equal(run.totals.cost, '$0.28')
  assert.equal(run.totals.tokens, '10,420')
  assert.equal(run.totals.wall, '4m 4s')
  const req = run.steps.find((s) => s.key === 'req')
  assert.equal(req.cost, '$0.12')
  assert.equal(req.tokens, '4,180')
})

test('tests + sandbox surface on the run; results come only from a recorded test run (C2)', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-3', brief: 'x' })
  await upsertTests(db, 'RUN-3', { status: 'Completed', image: 'python:3.12-slim', network: 'Disabled', memory: '512 MB', cpu: '1 core', timeout: '30 seconds', passed: 14, failed: 0, total: 14, iterations: 2, duration_ms: 267000 })
  let run = await getRun(db, 'RUN-3')
  assert.equal(run.sandbox.image, 'python:3.12-slim')
  assert.equal(run.sandbox.network, 'Disabled')
  assert.equal(run.tests, null) // numbers written outside a test run are never shown

  await db.query("UPDATE runs SET step = 'code' WHERE run_id = 'RUN-3'")
  await recordTestRun(db, 'RUN-3', { ...PASSING, passed: 14, total: 14, iterations: 2, duration_ms: 267000 }, { agent: 'mcp' })
  run = await getRun(db, 'RUN-3')
  assert.equal(run.tests.passed, 14)
  assert.equal(run.tests.duration, '4m 27s')
})

test('run view carries the audit chain + verified, and detects tamper', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-4', brief: 'x' })
  await appendEvent(db, { runId: 'RUN-4', event: 'run.created', actor: 'a' })
  await appendEvent(db, { runId: 'RUN-4', event: 'design.approved', actor: 'b', payload: { file: 'ok.py' } })

  let run = await getRun(db, 'RUN-4')
  assert.equal(run.auditChain.length, 3) // createRun's own run.created + the two above
  assert.equal(run.verified, true)

  await tamperEvent(db, 'RUN-4', 3, { file: 'backdoor.py' })
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

test('phase state cannot be written through the metrics function', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-5', brief: 'x' })
  await assert.rejects(recordPhaseMetrics(db, 'RUN-5', 'g1', { state: 'approved' }), /can only change through/)
  assert.equal((await getRun(db, 'RUN-5')).steps.find((s) => s.key === 'g1').state, 'pending')
})

test('seed loads 3 demo runs; RUN-0427 is awaiting with real chain', async () => {
  const db = await freshDb()
  const n = await seed(db)
  assert.equal(n, 3)
  const list = await listRuns(db)
  assert.equal(list.length, 3)
  const r = await getRun(db, 'RUN-0427')
  assert.equal(r.awaiting, true)
  assert.equal(r.step, 'g3')
  assert.equal(r.totals.cost, '$0.42')
  assert.equal(r.totals.tokens, '18,420')
  // run.created + 5 moves through the state machine
  assert.equal(r.auditChain.length, 6)
  assert.equal(r.verified, true)
})

test('HTTP: create -> get, PATCH is gone, and 404 on missing', async () => {
  const db = await freshDb()
  const app = createApp(db)
  const human = await asReviewer(db)
  const agent = await asAgent(db)
  const server = app.listen(0)
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  try {
    const created = await (await fetch(`${base}/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...human },
      body: JSON.stringify({ runId: 'RUN-H', brief: 'http run' }),
    })).json()
    assert.equal(created.id, 'RUN-H')

    const got = await (await fetch(`${base}/runs/RUN-H`, { headers: human })).json()
    assert.equal(got.brief, 'http run')

    const patched = await fetch(`${base}/runs/RUN-H`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', ...agent },
      body: JSON.stringify({ status: 'approved' }),
    })
    assert.equal(patched.status, 404)
    assert.equal((await (await fetch(`${base}/runs/RUN-H`, { headers: human })).json()).status, 'running')

    const missing = await fetch(`${base}/runs/RUN-NOPE`, { headers: human })
    assert.equal(missing.status, 404)
  } finally {
    server.close()
  }
})
