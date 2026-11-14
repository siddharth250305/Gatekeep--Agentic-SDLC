// G9 / Milestone 5: restarting a service never leaves a pipeline run stuck.
// The pipeline keeps no run state, so after the Node backend restarts it
// wakes the pipeline for every pipeline run that is at a robot step; the
// pipeline reads the run back from here and does that step.
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { claimStart, createRun, listRuns } from '../src/runs/service.js'
import { recoverPipelineRuns } from '../src/runs/pipeline.js'
import { freshDb } from './helpers/db.js'

async function mockPipeline(status = 202) {
  const calls = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      calls.push({ url: req.url, body: JSON.parse(raw || '{}'), secret: req.headers['x-gatekeep-pipeline-secret'] })
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: true }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() }
}

// Restore an env var exactly (assigning undefined would store "undefined").
function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function runAt(db, runId, step, { started = true } = {}) {
  await createRun(db, { runId, brief: 'b' })
  if (started) await claimStart(db, runId)
  await db.query('UPDATE runs SET step = $1 WHERE run_id = $2', [step, runId])
}

test('the run list says where each run is and whether the pipeline started it', async () => {
  const db = await freshDb()
  await runAt(db, 'RUN-L1', 'design')
  await runAt(db, 'RUN-L2', 'req', { started: false })
  const runs = Object.fromEntries((await listRuns(db)).map((r) => [r.id, r]))
  assert.equal(runs['RUN-L1'].step, 'design')
  assert.equal(runs['RUN-L1'].started, true)
  assert.equal(runs['RUN-L2'].started, false)
})

test('after a restart the pipeline is woken for every started run at a robot step, and only those', async () => {
  const db = await freshDb()
  await runAt(db, 'RUN-R1', 'req')
  await runAt(db, 'RUN-R2', 'design')
  await runAt(db, 'RUN-R3', 'code')
  await runAt(db, 'RUN-G1', 'g2') // waiting for a human: nothing to do
  await runAt(db, 'RUN-D1', 'done')
  await runAt(db, 'RUN-C1', 'cancelled')
  await runAt(db, 'RUN-M1', 'code', { started: false }) // MCP mode: an outside robot works on it
  const pipeline = await mockPipeline()
  const saved = [process.env.PIPELINE_URL, process.env.GATEKEEP_PIPELINE_SECRET]
  process.env.PIPELINE_URL = pipeline.url
  process.env.GATEKEEP_PIPELINE_SECRET = 'pipe-secret'
  try {
    const out = await recoverPipelineRuns(db)
    assert.deepEqual(out.woken.sort(), ['RUN-R1', 'RUN-R2', 'RUN-R3'])
    assert.deepEqual(pipeline.calls.map((c) => c.url).sort(), [
      '/pipeline/RUN-R1/work', '/pipeline/RUN-R2/work', '/pipeline/RUN-R3/work',
    ])
    assert.ok(pipeline.calls.every((c) => c.secret === 'pipe-secret'))
  } finally {
    pipeline.close()
    restoreEnv('PIPELINE_URL', saved[0])
    restoreEnv('GATEKEEP_PIPELINE_SECRET', saved[1])
  }
})

test('recovery never throws when the pipeline is not running', async () => {
  const db = await freshDb()
  await runAt(db, 'RUN-R1', 'design')
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = 'http://127.0.0.1:1' // nothing listens here
  try {
    const out = await recoverPipelineRuns(db)
    assert.deepEqual(out.woken, [])
    assert.deepEqual(out.failed, ['RUN-R1'])
  } finally {
    restoreEnv('PIPELINE_URL', saved)
  }
})

test('a pipeline that accepts the call but never answers does not stall recovery', async () => {
  const db = await freshDb()
  await runAt(db, 'RUN-H1', 'design')
  await runAt(db, 'RUN-H2', 'code')
  const sockets = []
  const server = http.createServer((req) => { sockets.push(req.socket) }) // never responds
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = `http://127.0.0.1:${server.address().port}`
  try {
    const t0 = Date.now()
    const out = await recoverPipelineRuns(db, { timeoutMs: 200 })
    assert.ok(Date.now() - t0 < 2000, 'each wake-up gives up after its timeout')
    assert.deepEqual(out.failed.sort(), ['RUN-H1', 'RUN-H2'])
  } finally {
    sockets.forEach((s) => s.destroy())
    server.close()
    restoreEnv('PIPELINE_URL', saved)
  }
})
