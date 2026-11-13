// Milestone 2 over HTTP: B1 (back doors closed), E2 (server-only audit
// writes), B8 (start / approve / robot actions safe to repeat), and the
// robot-action, decide and cancel routes that drive the state machine.
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { getRun } from '../src/runs/service.js'
import { asAgent, asReviewer } from './helpers/auth.js'
import { freshDb } from './helpers/db.js'

async function setup() {
  const db = await freshDb()
  const server = createApp(db).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (method, path, headers = {}, body) => fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const requester = await asReviewer(db, 'Engineer', 'rae-requester')
  const planner = await asReviewer(db, 'Planner', 'pat-planner')
  const engineer = await asReviewer(db, 'Engineer', 'eli-engineer')
  const agent = await asAgent(db, 'mcp-agent')
  const created = await call('POST', '/runs', requester, { runId: 'RUN-H', brief: 'http run' })
  assert.equal(created.status, 201)
  return { db, call, requester, planner, engineer, agent, close: () => server.close() }
}

const act = (ctx, action) => ctx.call('POST', `/runs/RUN-H/actions/${action}`, ctx.agent, {})
const decide = (ctx, who, body) => ctx.call('POST', '/runs/RUN-H/decide', who, body)

async function toGate3(ctx) {
  assert.equal((await act(ctx, 'submit_requirements')).status, 200)
  assert.equal((await decide(ctx, ctx.planner, { decision: 'approve' })).status, 200)
  assert.equal((await act(ctx, 'submit_design')).status, 200)
  assert.equal((await decide(ctx, ctx.engineer, { decision: 'approve' })).status, 200)
  assert.equal((await act(ctx, 'request_review')).status, 200)
}

test('POST /runs records the logged-in requester and starts at Requirements', async () => {
  const ctx = await setup()
  try {
    const run = await getRun(ctx.db, 'RUN-H')
    assert.equal(run.step, 'req')
    assert.equal(run.createdBy, 'rae-requester')
    assert.equal(run.auditChain[0].actor, 'rae-requester')
  } finally {
    ctx.close()
  }
})

test('the full table works over HTTP, and the robot route only moves robot steps', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx)
    let run = await getRun(ctx.db, 'RUN-H')
    assert.equal(run.step, 'g3')
    assert.equal(run.gate, 'Engineer')

    // B3: the requester may not approve their own work at Gate 3.
    const self = await decide(ctx, ctx.requester, { decision: 'approve' })
    assert.equal(self.status, 403)

    const res = await decide(ctx, ctx.engineer, { decision: 'approve', gate: 'g3' })
    assert.equal(res.status, 200)
    run = await res.json()
    assert.equal(run.step, 'done')
    assert.equal(run.auditChain.at(-1).actor, 'eli-engineer')
  } finally {
    ctx.close()
  }
})

test('robot actions: unknown action 400, not allowed 409, human caller 403, unknown run 404', async () => {
  const ctx = await setup()
  try {
    assert.equal((await act(ctx, 'approve')).status, 400)
    assert.equal((await act(ctx, 'skip_to_done')).status, 400)
    assert.equal((await act(ctx, 'request_review')).status, 409)
    assert.equal((await ctx.call('POST', '/runs/RUN-H/actions/submit_requirements', ctx.engineer, {})).status, 403)
    assert.equal((await ctx.call('POST', '/runs/RUN-NOPE/actions/submit_requirements', ctx.agent, {})).status, 404)
    assert.equal((await getRun(ctx.db, 'RUN-H')).step, 'req')
  } finally {
    ctx.close()
  }
})

test('decide: robot step 409, wrong role 403, bad decision 400, Gate 3 reject needs a target', async () => {
  const ctx = await setup()
  try {
    assert.equal((await decide(ctx, ctx.engineer, { decision: 'approve' })).status, 409) // at Requirements
    await act(ctx, 'submit_requirements')
    assert.equal((await decide(ctx, ctx.engineer, { decision: 'approve' })).status, 403) // Gate 1 is the Planner's
    assert.equal((await decide(ctx, ctx.planner, { decision: 'skip' })).status, 400)
    assert.equal((await decide(ctx, ctx.agent, { decision: 'approve' })).status, 403)
    await decide(ctx, ctx.planner, { decision: 'approve' })
    await act(ctx, 'submit_design')
    await decide(ctx, ctx.engineer, { decision: 'approve' })
    await act(ctx, 'request_review')
    assert.equal((await decide(ctx, ctx.engineer, { decision: 'reject' })).status, 400)
    const back = await decide(ctx, ctx.engineer, { decision: 'reject', target: 'design', feedback: 'rethink the cache' })
    assert.equal(back.status, 200)
    const run = await back.json()
    assert.equal(run.step, 'design')
    assert.equal(run.auditChain.at(-1).payload.feedback, 'rethink the cache')
  } finally {
    ctx.close()
  }
})

test('cancel: Planner or Engineer only, final afterwards', async () => {
  const ctx = await setup()
  try {
    assert.equal((await ctx.call('POST', '/runs/RUN-H/cancel', ctx.agent, {})).status, 403)
    const res = await ctx.call('POST', '/runs/RUN-H/cancel', ctx.planner, { reason: 'duplicate' })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).step, 'cancelled')
    assert.equal((await ctx.call('POST', '/runs/RUN-H/cancel', ctx.engineer, {})).status, 409)
    assert.equal((await act(ctx, 'submit_requirements')).status, 409)
    assert.equal((await decide(ctx, ctx.planner, { decision: 'approve' })).status, 409)
  } finally {
    ctx.close()
  }
})

// ---- B1: back doors ------------------------------------------------------

test('B1: PATCH /runs/:id no longer exists, for agents or humans', async () => {
  const ctx = await setup()
  try {
    for (const who of [ctx.agent, ctx.engineer]) {
      const res = await ctx.call('PATCH', '/runs/RUN-H', who, { status: 'approved', gate: null })
      assert.equal(res.status, 404)
    }
    const run = await getRun(ctx.db, 'RUN-H')
    assert.equal(run.status, 'running')
    assert.equal(run.step, 'req')
  } finally {
    ctx.close()
  }
})

test('B1: PUT /phases cannot change state, status or time; metrics still work', async () => {
  const ctx = await setup()
  try {
    for (const body of [{ state: 'approved' }, { status: 'Approved' }, { at: 'now' }, { state: 'active', cost_usd: 0.1 }]) {
      const res = await ctx.call('PUT', '/runs/RUN-H/phases/g2', ctx.agent, body)
      assert.equal(res.status, 403, JSON.stringify(body))
    }
    const metrics = await ctx.call('PUT', '/runs/RUN-H/phases/req', ctx.agent, {
      cost_usd: 0.12, input_tokens: 10, output_tokens: 20, model: 'agent-model', duration_ms: 1000,
    })
    assert.equal(metrics.status, 200)
    const run = await getRun(ctx.db, 'RUN-H')
    assert.equal(run.steps.find((s) => s.key === 'g2').state, 'pending')
    assert.equal(run.steps.find((s) => s.key === 'req').cost, '$0.12')
    assert.equal(run.step, 'req')
  } finally {
    ctx.close()
  }
})

// ---- E2: only the server writes the diary ------------------------------------

test('E2: the audit endpoint refuses a caller-chosen actor or date', async () => {
  const ctx = await setup()
  try {
    const before = (await getRun(ctx.db, 'RUN-H')).auditChain.length
    const forged = [
      { event: 'mcp.file.written', actor: 'alice' },
      { event: 'mcp.file.written', createdAt: '2020-01-01T10:00:00.000Z' },
    ]
    for (const body of forged) {
      assert.equal((await ctx.call('POST', '/runs/RUN-H/audit', ctx.agent, body)).status, 400, JSON.stringify(body))
    }
    assert.equal((await getRun(ctx.db, 'RUN-H')).auditChain.length, before)
  } finally {
    ctx.close()
  }
})

test('E2: an agent cannot write step-change or run events into the diary', async () => {
  const ctx = await setup()
  try {
    const before = (await getRun(ctx.db, 'RUN-H')).auditChain.length
    for (const event of ['g2.approved', 'g3.approved', 'requirements.submitted', 'run.cancelled', 'code.approved', 'design.approved']) {
      assert.equal((await ctx.call('POST', '/runs/RUN-H/audit', ctx.agent, { event })).status, 400, event)
    }
    // The same request shape with a work event is accepted, so the refusals
    // above are about the event name, not a missing field.
    assert.equal((await ctx.call('POST', '/runs/RUN-H/audit', ctx.agent, { event: 'mcp.tests.run' })).status, 201)
    assert.equal((await getRun(ctx.db, 'RUN-H')).auditChain.length, before + 1)
  } finally {
    ctx.close()
  }
})

test('E2: agent work events are stamped with the token name and the server clock', async () => {
  const ctx = await setup()
  try {
    const t0 = Date.now()
    const res = await ctx.call('POST', '/runs/RUN-H/audit', ctx.agent, { event: 'mcp.file.written', payload: { path: 'a.py' } })
    assert.equal(res.status, 201)
    const row = await res.json()
    assert.equal(row.actor, 'agent:mcp-agent')
    assert.ok(Math.abs(Date.parse(row.createdAt) - t0) < 5000)
    assert.equal((await ctx.call('POST', '/runs/RUN-H/audit', ctx.engineer, { event: 'mcp.file.written' })).status, 403)
  } finally {
    ctx.close()
  }
})

// ---- B8: safe to repeat over HTTP ------------------------------------------

test('B8: a double-clicked approve records one approval and the second gets 409', async () => {
  const ctx = await setup()
  try {
    await act(ctx, 'submit_requirements')
    const a = await decide(ctx, ctx.planner, { decision: 'approve', gate: 'g1' })
    const b = await decide(ctx, ctx.planner, { decision: 'approve', gate: 'g1' })
    assert.equal(a.status, 200)
    assert.equal(b.status, 409)
    const run = await getRun(ctx.db, 'RUN-H')
    assert.equal(run.step, 'design')
    assert.equal(run.auditChain.filter((e) => e.event === 'g1.approved').length, 1)
  } finally {
    ctx.close()
  }
})

test('B8: a repeated robot submission returns 200 without a second move', async () => {
  const ctx = await setup()
  try {
    assert.equal((await act(ctx, 'submit_requirements')).status, 200)
    const again = await act(ctx, 'submit_requirements')
    assert.equal(again.status, 200)
    assert.equal((await again.json()).step, 'g1')
    const run = await getRun(ctx.db, 'RUN-H')
    assert.equal(run.auditChain.filter((e) => e.event === 'requirements.submitted').length, 1)
  } finally {
    ctx.close()
  }
})

async function mockPipeline(status = 200) {
  const calls = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      calls.push({ url: req.url, body: JSON.parse(raw || '{}') })
      res.writeHead(status, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() }
}

test('B8: pressing Start twice starts the pipeline once', async () => {
  const pipeline = await mockPipeline()
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = pipeline.url
  const ctx = await setup()
  try {
    const first = await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)
    const second = await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)
    assert.equal(first.status, 200)
    assert.equal(second.status, 409)
    assert.equal(pipeline.calls.filter((c) => c.url.endsWith('/start')).length, 1)
  } finally {
    ctx.close()
    pipeline.close()
    process.env.PIPELINE_URL = saved
  }
})

test('B8: a start that never reached the pipeline can be tried again', async () => {
  const saved = process.env.PIPELINE_URL // a closed port: connection refused
  const ctx = await setup()
  try {
    assert.equal((await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)).status, 502)
    const ok = await mockPipeline(200)
    process.env.PIPELINE_URL = ok.url
    assert.equal((await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)).status, 200)
    ok.close()
  } finally {
    ctx.close()
    process.env.PIPELINE_URL = saved
  }
})

test('B8: a start that failed inside the pipeline is not released (it may have begun)', async () => {
  const broken = await mockPipeline(500)
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = broken.url
  const ctx = await setup()
  try {
    assert.equal((await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)).status, 502)
    // A second graph for the same run must not be launched.
    assert.equal((await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)).status, 409)
    assert.equal(broken.calls.length, 1)
    assert.equal((await getRun(ctx.db, 'RUN-H')).started, true)
  } finally {
    ctx.close()
    broken.close()
    process.env.PIPELINE_URL = saved
  }
})

test('a decision on a pipeline run whose pipeline is gone is recorded with a warning', async () => {
  const pipeline = await mockPipeline(200)
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = pipeline.url
  const ctx = await setup()
  try {
    assert.equal((await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)).status, 200)
    await act(ctx, 'submit_requirements')
    pipeline.close() // the pipeline process went away
    process.env.PIPELINE_URL = saved // closed port: connection refused
    const res = await decide(ctx, ctx.planner, { decision: 'approve' })
    assert.equal(res.status, 200)
    const run = await res.json()
    assert.equal(run.step, 'design')
    assert.deepEqual(run.pipeline, { resumed: false, reason: 'not_running' })
  } finally {
    ctx.close()
    process.env.PIPELINE_URL = saved
  }
})

test('decide: a gate that is not a string is refused, not ignored', async () => {
  const ctx = await setup()
  try {
    await act(ctx, 'submit_requirements')
    assert.equal((await decide(ctx, ctx.planner, { decision: 'approve', gate: 1 })).status, 400)
    assert.equal((await getRun(ctx.db, 'RUN-H')).step, 'g1')
  } finally {
    ctx.close()
  }
})

test('artifacts can only be written for the robot step the run is at', async () => {
  const ctx = await setup()
  const put = (body) => ctx.call('PUT', '/runs/RUN-H/artifacts', ctx.agent, body)
  try {
    assert.equal((await put({ requirements: 'draft' })).status, 200) // at Requirements
    assert.equal((await put({ diff: { file: 'x' } })).status, 409) // not the Code step
    await act(ctx, 'submit_requirements')
    // At Gate 1 the reviewer is reading the requirements: nobody may swap them.
    assert.equal((await put({ requirements: 'swapped' })).status, 409)
    assert.equal((await getRun(ctx.db, 'RUN-H')).requirements, 'draft')
    await decide(ctx, ctx.planner, { decision: 'approve' })
    await act(ctx, 'submit_design')
    await decide(ctx, ctx.engineer, { decision: 'approve' })
    assert.equal((await put({ files: [], summary: { headline: 'wip' } })).status, 200) // at Code
    assert.equal((await put({ requirements: 'late change' })).status, 409)
    await act(ctx, 'request_review')
    // At Gate 3 and after Done, the reviewed diff cannot change.
    assert.equal((await put({ diff: { file: 'evil' } })).status, 409)
    await decide(ctx, ctx.engineer, { decision: 'approve' })
    assert.equal((await put({ diff: { file: 'evil' } })).status, 409)
    assert.equal((await getRun(ctx.db, 'RUN-H')).diff, null)
  } finally {
    ctx.close()
  }
})

test('B8: a run that has moved past Requirements cannot be started', async () => {
  const pipeline = await mockPipeline()
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = pipeline.url
  const ctx = await setup()
  try {
    await act(ctx, 'submit_requirements')
    assert.equal((await ctx.call('POST', '/runs/RUN-H/start', ctx.engineer)).status, 409)
    assert.equal(pipeline.calls.length, 0)
  } finally {
    ctx.close()
    pipeline.close()
    process.env.PIPELINE_URL = saved
  }
})

test('a robot action can attach details to its one audit entry', async () => {
  const ctx = await setup()
  try {
    await act(ctx, 'submit_requirements')
    await decide(ctx, ctx.planner, { decision: 'approve' })
    await act(ctx, 'submit_design')
    await decide(ctx, ctx.engineer, { decision: 'approve' })
    const before = (await getRun(ctx.db, 'RUN-H')).auditChain.length
    const res = await ctx.call('POST', '/runs/RUN-H/actions/request_review', ctx.agent, {
      details: { summary: 'Added y.', files: ['app.py'] },
    })
    assert.equal(res.status, 200)
    const chain = (await res.json()).auditChain
    assert.equal(chain.length, before + 1)
    assert.deepEqual(chain.at(-1).payload, { from: 'code', to: 'g3', details: { summary: 'Added y.', files: ['app.py'] } })
    // details must be an object, and cannot override from / to
    assert.equal((await ctx.call('POST', '/runs/RUN-H/actions/request_review', ctx.agent, { details: 'x' })).status, 400)
  } finally {
    ctx.close()
  }
})

test('a submission stores its artifact in the same step as the move, or not at all', async () => {
  const ctx = await setup()
  try {
    const ok = await ctx.call('POST', '/runs/RUN-H/actions/submit_requirements', ctx.agent, {
      artifacts: { requirements: 'REQ-1: limit to 60/min' },
    })
    assert.equal(ok.status, 200)
    const run = await ok.json()
    assert.equal(run.step, 'g1')
    assert.equal(run.requirements, 'REQ-1: limit to 60/min')

    // Refused move (the run is at Gate 1): the new text is not stored.
    const refused = await ctx.call('POST', '/runs/RUN-H/actions/submit_design', ctx.agent, { artifacts: { design: { plan: 'x' } } })
    assert.equal(refused.status, 409)
    assert.equal((await getRun(ctx.db, 'RUN-H')).design, null)

    // Each action may only carry its own artifact.
    const wrong = await ctx.call('POST', '/runs/RUN-H/actions/submit_requirements', ctx.agent, { artifacts: { design: 'sneaky' } })
    assert.equal(wrong.status, 400)
    // A repeated submission does not overwrite what the reviewer is looking at.
    const again = await ctx.call('POST', '/runs/RUN-H/actions/submit_requirements', ctx.agent, { artifacts: { requirements: 'changed' } })
    assert.equal(again.status, 200)
    assert.equal((await getRun(ctx.db, 'RUN-H')).requirements, 'REQ-1: limit to 60/min')
  } finally {
    ctx.close()
  }
})
