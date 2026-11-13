// Gate decisions and the agent pipeline. The backend owns run state (ADR
// 0001), so it records the move through the state machine first and then
// tells the pipeline to continue. A mock pipeline stands in for LangGraph.
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { getRun } from '../src/runs/service.js'
import { seed } from '../src/runs/seed.js'
import { asReviewer } from './helpers/auth.js'
import { freshDb } from './helpers/db.js'

// Starts a mock pipeline. respond(body) -> { status, json, delayMs }.
async function mockPipeline(respond) {
  const calls = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}')
      calls.push({ url: req.url, body, secret: req.headers['x-gatekeep-pipeline-secret'] })
      const { status = 200, json = { resumed: true }, delayMs = 0 } = respond(body)
      await new Promise((r) => setTimeout(r, delayMs))
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() }
}

async function setup(respond) {
  const db = await freshDb()
  await seed(db) // RUN-0427 is waiting at Gate 3 for an Engineer
  const pipeline = await mockPipeline(respond)
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = pipeline.url
  const server = createApp(db).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const decide = (headers, body = { decision: 'approve' }) => fetch(`${base}/runs/RUN-0427/decide`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
  const done = () => {
    server.close()
    pipeline.close()
    process.env.PIPELINE_URL = saved
  }
  return { db, pipeline, decide, done }
}

test('two simultaneous approves resume the pipeline once', async () => {
  const { pipeline, decide, done, db } = await setup(() => ({ delayMs: 150 }))
  try {
    const [a, b] = await Promise.all([
      decide(await asReviewer(db, 'Engineer', 'eng-a')),
      decide(await asReviewer(db, 'Admin', 'admin-b')),
    ])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    assert.equal(pipeline.calls.length, 1)
  } finally {
    done()
  }
})

test('the pipeline is told which gate was decided, where the run went, and by whom', async () => {
  const { pipeline, decide, done, db } = await setup(() => ({}))
  try {
    const res = await decide(await asReviewer(db, 'Engineer', 'adrt25'), { decision: 'approve', actor: 'spoofed' })
    assert.equal(res.status, 200)
    assert.equal(pipeline.calls.length, 1)
    assert.deepEqual(pipeline.calls[0].body, { decision: 'approve', target: 'done', feedback: '', actor: 'adrt25', gate: 'g3' })
    assert.equal((await getRun(db, 'RUN-0427')).step, 'done')
  } finally {
    done()
  }
})

test('a decision the state machine refuses is never forwarded', async () => {
  const { pipeline, decide, done, db } = await setup(() => ({}))
  try {
    assert.equal((await decide(await asReviewer(db, 'Planner'))).status, 403) // Gate 3 is the Engineer's
    assert.equal((await decide(await asReviewer(db, 'Engineer'), { decision: 'approve', gate: 'g2' })).status, 409) // stale
    assert.equal((await decide(await asReviewer(db, 'Engineer'), { decision: 'reject' })).status, 400) // no target
    assert.equal(pipeline.calls.length, 0)
  } finally {
    done()
  }
})

test('the decision is recorded once even if the pipeline is somewhere else', async () => {
  const { decide, done, db } = await setup(() => ({ status: 409, json: { resumed: false, reason: 'stale_gate', gate: 'g2' } }))
  try {
    const before = await getRun(db, 'RUN-0427')
    const res = await decide(await asReviewer(db, 'Engineer'))
    assert.equal(res.status, 200)
    const run = await res.json()
    assert.equal(run.step, 'done')
    assert.deepEqual(run.pipeline, { resumed: false, reason: 'stale_gate' })
    assert.equal(run.auditChain.length, before.auditChain.length + 1)
  } finally {
    done()
  }
})

test('a pipeline error is reported next to the recorded decision, never applied twice', async () => {
  const { decide, done, db } = await setup(() => ({ status: 500, json: { detail: 'boom' } }))
  try {
    const before = await getRun(db, 'RUN-0427')
    const res = await decide(await asReviewer(db, 'Engineer'))
    assert.equal(res.status, 200)
    const run = await res.json()
    assert.deepEqual(run.pipeline, { resumed: false, reason: 'status_500' })
    assert.equal((await getRun(db, 'RUN-0427')).auditChain.length, before.auditChain.length + 1)
    // A retry of the same click is refused: the gate is already decided.
    assert.equal((await decide(await asReviewer(db, 'Engineer'), { decision: 'approve', gate: 'g3' })).status, 409)
  } finally {
    done()
  }
})

test('a run the pipeline does not know (MCP mode) needs no pipeline', async () => {
  const { decide, done, db } = await setup(() => ({ status: 409, json: { resumed: false, reason: 'not_running' } }))
  try {
    const res = await decide(await asReviewer(db, 'Engineer', 'adrt25'))
    assert.equal(res.status, 200)
    const run = await res.json()
    assert.equal(run.status, 'approved')
    assert.equal(run.pipeline, undefined)
    assert.equal(run.auditChain.at(-1).actor, 'adrt25')
  } finally {
    done()
  }
})
