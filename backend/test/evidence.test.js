// Milestone 3, B7 (with C2 and B6 on the server): Gate 3 approves one exact,
// tested version of the code. Each test run is stored with the code
// fingerprint it ran on; "request review" hands over a fingerprint; approve
// is refused unless the latest test run passed on that same fingerprint.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { createRun, decideGate, getRun, recordTestRun, robotAction } from '../src/runs/service.js'
import { asAgent, asReviewer } from './helpers/auth.js'
import { freshDb } from './helpers/db.js'
import { FP, OTHER_FP, PASSING, handOver } from './helpers/evidence.js'

const PLANNER = { id: 11, username: 'pat-planner', role: 'Planner' }
const ENGINEER = { id: 12, username: 'eli-engineer', role: 'Engineer' }

async function atCode(db, runId = 'RUN-EV') {
  await createRun(db, { runId, brief: 'evidence', createdBy: { id: 99, username: 'rae' } })
  await robotAction(db, runId, 'submit_requirements', { agent: 'mcp' })
  await decideGate(db, runId, { decision: 'approve', user: PLANNER })
  await robotAction(db, runId, 'submit_design', { agent: 'mcp' })
  await decideGate(db, runId, { decision: 'approve', user: ENGINEER })
  return runId
}

const approve = (db, id) => decideGate(db, id, { decision: 'approve', user: ENGINEER })

test('B7: request review without a code fingerprint is refused', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  assert.equal((await robotAction(db, id, 'request_review', { agent: 'mcp' })).error, 'fingerprint_required')
  assert.equal((await robotAction(db, id, 'request_review', { agent: 'mcp', fingerprint: 'abc' })).error, 'fingerprint_required')
  assert.equal((await getRun(db, id)).step, 'code')
})

test('B7: Gate 3 approve is refused when no test run exists', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  await handOver(db, id, { testRun: null })
  const run = await getRun(db, id)
  assert.deepEqual(run.review, { fingerprint: FP, testRunId: null, approvable: false, reason: 'untested' })
  assert.equal((await approve(db, id)).error, 'untested')
  assert.equal((await getRun(db, id)).step, 'g3')
})

test('B7: Gate 3 approve is refused when the code changed after the last test run', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  await handOver(db, id, { fingerprint: OTHER_FP }) // tested FP, handed over OTHER_FP
  const run = await getRun(db, id)
  assert.equal(run.review.approvable, false)
  assert.equal(run.review.reason, 'code_changed')
  assert.equal((await approve(db, id)).error, 'code_changed')
  assert.equal((await getRun(db, id)).step, 'g3')
})

test('B7: Gate 3 approve is refused when the last test run did not pass', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  await handOver(db, id, { testRun: { ...PASSING, status: 'Failed', passed: 2, failed: 1 } })
  assert.equal((await getRun(db, id)).review.reason, 'tests_not_passed')
  assert.equal((await approve(db, id)).error, 'tests_not_passed')
})

test('B7: a later failing run on the same code wins over an earlier passing one', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  await recordTestRun(db, id, PASSING, { agent: 'mcp' })
  await handOver(db, id, { testRun: { ...PASSING, status: 'Failed', passed: 0, failed: 3 } })
  assert.equal((await approve(db, id)).error, 'tests_not_passed')
})

test('B7: approve works on the exact tested version and the diary records both', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  await handOver(db, id)
  let run = await getRun(db, id)
  assert.equal(run.review.approvable, true)
  assert.equal(run.review.reason, null)
  assert.match(run.review.testRunId, /^[0-9a-f-]{36}$/)
  const testRunId = run.review.testRunId

  assert.ok((await approve(db, id)).run)
  run = await getRun(db, id)
  assert.equal(run.step, 'done')
  const approved = run.auditChain.find((e) => e.event === 'g3.approved')
  assert.deepEqual(approved.payload.evidence, { fingerprint: FP, testRun: testRunId })
  const requested = run.auditChain.find((e) => e.event === 'code.review_requested')
  assert.equal(requested.payload.fingerprint, FP)
})

test('B7: Gate 3 sent back to Code, then re-tested and handed over again, can be approved', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  await handOver(db, id, { fingerprint: OTHER_FP })
  await decideGate(db, id, { decision: 'reject', target: 'code', user: ENGINEER })
  await handOver(db, id, { testRun: { ...PASSING, fingerprint: OTHER_FP }, fingerprint: OTHER_FP })
  assert.ok((await approve(db, id)).run)
})

test('B6 (server side): test runs can only be recorded while the run is at Code', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-REQ', brief: 'x' })
  assert.equal((await recordTestRun(db, 'RUN-REQ', PASSING, { agent: 'mcp' })).error, 'wrong_step')
  const id = await atCode(db)
  await handOver(db, id, { fingerprint: OTHER_FP })
  // At Gate 3 the evidence is frozen: no new run can be slipped in.
  assert.equal((await recordTestRun(db, id, { ...PASSING, fingerprint: OTHER_FP }, { agent: 'mcp' })).error, 'wrong_step')
  assert.equal((await approve(db, id)).error, 'code_changed')
  assert.equal((await recordTestRun(db, 'RUN-NOPE', PASSING, { agent: 'mcp' })).error, 'not_found')
})

test('C2: a test run must be well formed', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  const bad = [
    { ...PASSING, fingerprint: 'nope' },
    { ...PASSING, status: 'Great' },
    { ...PASSING, passed: -1 },
    { ...PASSING, total: '3' },
    { ...PASSING, cases: 'x' },
    { ...PASSING, cases: [{ name: 'a', file: 'b', outcome: 'won', new: true }] },
    { ...PASSING, cases: [{ name: 7, file: 'b', outcome: 'passed', new: true }] },
    { ...PASSING, cases: Array.from({ length: 2001 }, () => PASSING.cases[0]) },
    { ...PASSING, missing_existing: [1] },
    // A "Passed" run must agree with its own counts (review finding #5).
    { ...PASSING, failed: 1, total: 4 },
    { ...PASSING, passed: 0, total: 0, cases: [] },
    { ...PASSING, missing_existing: ['tests/test_app.py::test_old'] },
    { ...PASSING, cases: [{ ...PASSING.cases[0], outcome: 'failed' }, ...PASSING.cases.slice(1)] },
    { ...PASSING, total: 7 },
    { ...PASSING, status: 'Failed', passed: 2, failed: 1, total: 9 },
  ]
  for (const fields of bad) {
    assert.equal((await recordTestRun(db, id, fields, { agent: 'mcp' })).error, 'bad_test_run', JSON.stringify(fields).slice(0, 80))
  }
})

test('C2 + C3: the run shows the latest test run with every test, marked new or existing', async () => {
  const db = await freshDb()
  const id = await atCode(db)
  await recordTestRun(db, id, { ...PASSING, status: 'Failed', passed: 2, failed: 1 }, { agent: 'mcp' })
  const latest = await recordTestRun(db, id, { ...PASSING, image: 'python:3.12-slim', network: 'Disabled' }, { agent: 'mcp' })
  const run = await getRun(db, id)
  assert.equal(run.tests.id, latest.id)
  assert.equal(run.tests.status, 'Passed')
  assert.equal(run.tests.fingerprint, FP)
  assert.deepEqual(run.tests.cases.map((c) => [c.name, c.new]), [['test_old', false], ['test_limit', true], ['test_429', true]])
  assert.deepEqual(run.tests.missingExisting, [])
  assert.equal(run.sandbox.image, 'python:3.12-slim')
  assert.equal(run.sandbox.status, 'Passed')
})

test('HTTP: test runs are agent-only, result fields cannot be faked through PUT /tests, approve refusal says why', async () => {
  const db = await freshDb()
  const server = createApp(db).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (method, path, headers, body) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body),
  })
  try {
    const agent = await asAgent(db)
    const engineer = await asReviewer(db, 'Engineer', 'eli2')
    const id = await atCode(db, 'RUN-EVH')
    assert.equal((await call('POST', `/runs/${id}/test-runs`, engineer, PASSING)).status, 403)
    const created = await call('POST', `/runs/${id}/test-runs`, agent, PASSING)
    assert.equal(created.status, 201)
    assert.match((await created.json()).id, /^[0-9a-f-]{36}$/)
    assert.equal((await call('POST', `/runs/${id}/test-runs`, agent, { ...PASSING, status: 'Great' })).status, 400)

    const faked = await call('PUT', `/runs/${id}/tests`, agent, { status: 'Passed', passed: 999, total: 999 })
    assert.equal(faked.status, 403)
    assert.equal((await call('PUT', `/runs/${id}/tests`, agent, { image: 'python:3.12-slim' })).status, 200)

    assert.equal((await call('POST', `/runs/${id}/actions/request_review`, agent, {})).status, 400)
    assert.equal((await call('POST', `/runs/${id}/actions/request_review`, agent, { fingerprint: OTHER_FP })).status, 200)
    const refused = await call('POST', `/runs/${id}/decide`, engineer, { decision: 'approve', gate: 'g3' })
    assert.equal(refused.status, 409)
    const body = await refused.json()
    assert.equal(body.reason, 'code_changed')
    assert.match(body.error, /changed after the last test run/)
  } finally {
    server.close()
  }
})
