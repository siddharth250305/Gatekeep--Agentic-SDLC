// Milestone 6 over HTTP: the project policy is recorded once and enforced
// (I5), requirements and designs must be structured (I2, I3), and Gate 3
// follows the team rules: required reviewers, several approvals, separation
// of duties, scope budgets (I3, I4).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { asAgent, asReviewer } from './helpers/auth.js'
import { NEEDS_PG, freshDb } from './helpers/db.js'
import { FP } from './helpers/evidence.js'

const SHA = 'c'.repeat(64)
const REQS = 'REQ-1: Limit each merchant to 60 calls a minute.\nREQ-2: Answer 429 with Retry-After.'
const DESIGN = '## Files\n- `app/throttle.py` (create) [REQ-1, REQ-2]\n- `tests/test_throttle.py` (create) [REQ-1, REQ-2]'
const FILES = [
  { path: 'app/throttle.py', status: 'A', add: 20, rem: 0 },
  { path: 'tests/test_throttle.py', status: 'A', add: 30, rem: 0 },
]
const COVERING = {
  fingerprint: FP, status: 'Passed', passed: 2, failed: 0, skipped: 0, total: 2, duration_ms: 900, output: '2 passed',
  cases: [
    { name: 'test_req_1_limit', file: 'tests/test_throttle.py', outcome: 'passed', new: true },
    { name: 'test_req_2_retry_after', file: 'tests/test_throttle.py', outcome: 'passed', new: true },
  ],
  missing_existing: [],
}

async function setup() {
  const db = await freshDb()
  const server = createApp(db).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, headers = {}, body) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const ctx = {
    db, call, close: () => server.close(),
    requester: await asReviewer(db, 'Engineer', 'rae'),
    planner: await asReviewer(db, 'Planner', 'pat'),
    eli: await asReviewer(db, 'Engineer', 'eli'),
    erin: await asReviewer(db, 'Engineer', 'erin'),
    bob: await asReviewer(db, 'Engineer', 'bob'),
    alice: await asReviewer(db, 'Engineer', 'alice'),
    admin: await asReviewer(db, 'Admin', 'ada'),
    agent: await asAgent(db, 'mcp'),
  }
  assert.equal((await call('POST', '/runs', ctx.requester, { runId: 'RUN-6', brief: 'rate limit' })).status, 201)
  return ctx
}

const R = '/runs/RUN-6'
const policyBody = (content) => (content === null ? { found: false } : { found: true, sha256: SHA, content })
const act = (ctx, action, body = {}) => ctx.call('POST', `${R}/actions/${action}`, ctx.agent, body)
const decide = (ctx, who, body) => ctx.call('POST', `${R}/decide`, who, body)
const getRun = async (ctx) => (await ctx.call('GET', R, ctx.eli)).body

// Requirements and design approved, the run at Code, the policy recorded.
async function toCode(ctx, { policy = null, design = DESIGN } = {}) {
  assert.equal((await ctx.call('PUT', `${R}/policy`, ctx.agent, policyBody(policy))).status, 200)
  assert.equal((await act(ctx, 'submit_requirements', { artifacts: { requirements: REQS } })).status, 200)
  assert.equal((await decide(ctx, ctx.planner, { decision: 'approve' })).status, 200)
  assert.equal((await act(ctx, 'submit_design', { artifacts: { design } })).status, 200)
  assert.equal((await decide(ctx, ctx.eli, { decision: 'approve' })).status, 200)
}

async function handOver(ctx, { files = FILES, testRun = COVERING } = {}) {
  assert.equal((await ctx.call('POST', `${R}/test-runs`, ctx.agent, testRun)).status, 201)
  return act(ctx, 'request_review', { fingerprint: FP, artifacts: { files, diff: [], summary: { headline: 'ok' } } })
}

async function toGate3(ctx, opts = {}) {
  await toCode(ctx, opts)
  const out = await handOver(ctx, opts)
  assert.equal(out.status, 200, JSON.stringify(out.body))
}

// ── I5: recording the policy ─────────────────────────────────────────────

test('the agent records the project policy once; the run shows it (I5)', async () => {
  const ctx = await setup()
  try {
    const out = await ctx.call('PUT', `${R}/policy`, ctx.agent, policyBody({ forbidden_paths: ['infra/**'] }))
    assert.equal(out.status, 200)
    const run = await getRun(ctx)
    assert.equal(run.policy.status, 'loaded')
    assert.equal(run.policy.sha256, SHA)
    assert.deepEqual(run.policy.rules.forbidden_paths, ['infra/**'])
    const entry = run.auditChain.find((e) => e.event === 'policy.recorded')
    assert.equal(entry.actor, 'agent:mcp')
    assert.equal(entry.payload.status, 'loaded')
    // The same file again is a no-op; a different one is refused.
    assert.equal((await ctx.call('PUT', `${R}/policy`, ctx.agent, policyBody({ forbidden_paths: ['infra/**'] }))).status, 200)
    const swap = await ctx.call('PUT', `${R}/policy`, ctx.agent, { found: true, sha256: 'd'.repeat(64), content: {} })
    assert.equal(swap.status, 409)
    assert.equal(swap.body.reason, 'policy_locked')
    assert.equal((await getRun(ctx)).auditChain.filter((e) => e.event === 'policy.recorded').length, 1)
  } finally { ctx.close() }
})

test('only an agent can record the policy, and nobody can fake its audit entry (I5)', async () => {
  const ctx = await setup()
  try {
    assert.equal((await ctx.call('PUT', `${R}/policy`, ctx.eli, policyBody({}))).status, 403)
    assert.equal((await ctx.call('PUT', `${R}/policy`, {}, policyBody({}))).status, 401)
    assert.equal((await ctx.call('POST', `${R}/audit`, ctx.agent, { event: 'policy.recorded', payload: {} })).status, 400)
    assert.equal((await ctx.call('PUT', `${R}/policy`, ctx.agent, { found: true, content: {} })).status, 400, 'sha256 required')
    assert.equal((await ctx.call('PUT', `${R}/policy`, ctx.agent, { found: 'yes' })).status, 400)
  } finally { ctx.close() }
})

test('an invalid gatekeep.yaml stops the run until it is fixed; only cancel works (fail closed, I5)', async () => {
  const ctx = await setup()
  try {
    assert.equal((await ctx.call('PUT', `${R}/policy`, ctx.agent, policyBody({ protect: ['x'] }))).status, 200)
    const run = await getRun(ctx)
    assert.equal(run.policy.status, 'invalid')
    assert.match(run.policy.errors[0], /unknown setting/)
    const refused = await act(ctx, 'submit_requirements', { artifacts: { requirements: REQS } })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.reason, 'policy_invalid')
    assert.equal((await ctx.call('POST', `${R}/cancel`, ctx.eli, {})).status, 200)
  } finally { ctx.close() }
})

test('a YAML syntax error is recorded as an invalid policy (I5)', async () => {
  const ctx = await setup()
  try {
    await ctx.call('PUT', `${R}/policy`, ctx.agent, { found: true, sha256: SHA, error: 'mapping values are not allowed here' })
    const run = await getRun(ctx)
    assert.equal(run.policy.status, 'invalid')
    assert.deepEqual(run.policy.errors, ['mapping values are not allowed here'])
  } finally { ctx.close() }
})

test('the code cannot be handed over before the policy was read (fail closed, I5)', async () => {
  const ctx = await setup()
  try {
    await act(ctx, 'submit_requirements', { artifacts: { requirements: REQS } })
    await decide(ctx, ctx.planner, { decision: 'approve' })
    await act(ctx, 'submit_design', { artifacts: { design: DESIGN } })
    await decide(ctx, ctx.eli, { decision: 'approve' })
    const out = await handOver(ctx)
    assert.equal(out.status, 409)
    assert.equal(out.body.reason, 'policy_unknown')
  } finally { ctx.close() }
})

// ── I2, I3: structured requirements and design ───────────────────────────

test('requirements must carry REQ IDs (I3)', async () => {
  const ctx = await setup()
  try {
    const none = await act(ctx, 'submit_requirements', { artifacts: { requirements: 'Throttle the webhook.' } })
    assert.equal(none.status, 400)
    assert.equal(none.body.reason, 'requirements_ids_missing')
    const dup = await act(ctx, 'submit_requirements', { artifacts: { requirements: 'REQ-1: a\nREQ-1: b' } })
    assert.equal(dup.body.reason, 'requirements_ids_duplicate')
    assert.equal((await getRun(ctx)).step, 'req')
    assert.equal((await act(ctx, 'submit_requirements', { artifacts: { requirements: REQS } })).status, 200)
    assert.deepEqual((await getRun(ctx)).trace.requirements.map((r) => r.id), ['REQ-1', 'REQ-2'])
  } finally { ctx.close() }
})

test('a design must list its files, inside the workspace, linked to known requirements (I2)', async () => {
  const ctx = await setup()
  try {
    await act(ctx, 'submit_requirements', { artifacts: { requirements: REQS } })
    await decide(ctx, ctx.planner, { decision: 'approve' })
    const cases = [
      ['Token bucket in Redis.', 'design_plan_missing'],
      ['## Files\n- `../etc/passwd` (modify) [REQ-1]', 'design_plan_bad_path'],
      ['## Files\n- `app/x.py` (create) [REQ-7]', 'design_unknown_requirement'],
    ]
    for (const [design, reason] of cases) {
      const out = await act(ctx, 'submit_design', { artifacts: { design } })
      assert.equal(out.status, 400, design)
      assert.equal(out.body.reason, reason)
    }
    assert.equal((await act(ctx, 'submit_design', { artifacts: { design: DESIGN } })).status, 200)
    const run = await getRun(ctx)
    assert.deepEqual(run.trace.plan.files.map((f) => f.path), ['app/throttle.py', 'tests/test_throttle.py'])
  } finally { ctx.close() }
})

test('Gate 3 shows the files changed outside the approved design (I2)', async () => {
  const ctx = await setup()
  try {
    const files = [...FILES, { path: 'app/payments.py', status: 'M', add: 2, rem: 1 }]
    await toGate3(ctx, { files })
    const run = await getRun(ctx)
    assert.deepEqual(run.trace.drift.undeclared, ['app/payments.py'])
    assert.deepEqual(run.trace.drift.untouched, [])
    assert.equal(run.trace.requirements.every((r) => r.status === 'covered'), true)
  } finally { ctx.close() }
})

// ── I3, I5: hand-over guardrails ─────────────────────────────────────────

test('the hand-over is refused while the change breaks a project rule (I3, I5)', async () => {
  const rules = [
    [{ scope: { max_files_changed: 1 } }, 'over_file_budget', /2 files changed; gatekeep.yaml allows 1/],
    [{ scope: { max_lines_changed: 10 } }, 'over_line_budget', /50 lines changed; gatekeep.yaml allows 10/],
    [{ forbidden_paths: ['app/**'] }, 'forbidden_path_changed', /app\/throttle.py/],
    [{ tests: { require_new_tests: true } }, 'no_new_tests', null, { ...COVERING, cases: COVERING.cases.map((c) => ({ ...c, new: false })) }],
    [{ tests: { require_requirement_coverage: true } }, 'requirements_not_covered', /REQ-2/, { ...COVERING, passed: 1, total: 1, cases: COVERING.cases.slice(0, 1) }],
  ]
  for (const [policy, reason, message, testRun] of rules) {
    const ctx = await setup()
    try {
      await toCode(ctx, { policy })
      const out = await handOver(ctx, { testRun })
      assert.equal(out.status, 409, reason)
      assert.equal(out.body.reason, reason)
      if (message) assert.match(out.body.error, message)
      assert.equal((await getRun(ctx)).step, 'code')
    } finally { ctx.close() }
  }
})

test('with design enforcement on, a change outside the plan cannot be handed over (I2, I5)', async () => {
  const ctx = await setup()
  try {
    await toCode(ctx, { policy: { design: { enforce: 'block' } } })
    const out = await handOver(ctx, { files: [...FILES, { path: 'app/payments.py', status: 'M', add: 1, rem: 0 }] })
    assert.equal(out.status, 409)
    assert.equal(out.body.reason, 'undeclared_changes')
    assert.match(out.body.error, /app\/payments.py/)
  } finally { ctx.close() }
})

// ── I4, I5: Gate 3 team rules ────────────────────────────────────────────

test('a protected path needs two approvals; the first is recorded and the run waits (I4, I5)', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { protected_paths: [{ path: 'app/**', approvals: 2 }] } })
    let run = await getRun(ctx)
    assert.deepEqual(run.governance.triggered.map((r) => r.path), ['app/**'])
    const first = await decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })
    assert.equal(first.status, 200)
    assert.equal(first.body.step, 'g3')
    assert.deepEqual(first.body.governance.approvals.map((a) => a.username), ['erin'])
    const again = await decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })
    assert.equal(again.status, 409)
    assert.equal(again.body.reason, 'already_approved')
    const second = await decide(ctx, ctx.bob, { decision: 'approve', gate: 'g3' })
    assert.equal(second.body.step, 'done')
    run = await getRun(ctx)
    const recorded = run.auditChain.filter((e) => e.event === 'g3.approval_recorded')
    assert.equal(recorded.length, 1)
    assert.equal(recorded[0].actor, 'erin')
    const final = run.auditChain.find((e) => e.event === 'g3.approved')
    assert.equal(final.actor, 'bob')
    assert.deepEqual(final.payload.approvals.map((a) => a.username), ['erin', 'bob'])
    assert.equal(final.payload.evidence.fingerprint, FP)
  } finally { ctx.close() }
})

test('named reviewers must be among the approvers (I5)', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { protected_paths: [{ path: 'app/**', approvals: 2, reviewers: ['alice'] }] } })
    await decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })
    const bob = await decide(ctx, ctx.bob, { decision: 'approve', gate: 'g3' })
    assert.equal(bob.body.step, 'g3', 'two approvals, but not alice')
    assert.deepEqual(bob.body.governance.requirements.find((r) => r.label === 'app/**').missingReviewers, ['alice'])
    assert.equal((await decide(ctx, ctx.alice, { decision: 'approve', gate: 'g3' })).body.step, 'done')
  } finally { ctx.close() }
})

test('the requester never approves Gate 3, even when several approvals are needed (I4)', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { team: { min_approvals: 2 } } })
    const out = await decide(ctx, ctx.requester, { decision: 'approve', gate: 'g3' })
    assert.equal(out.status, 403)
    assert.equal(out.body.reason, 'requester')
    assert.deepEqual((await getRun(ctx)).governance.approvals, [])
  } finally { ctx.close() }
})

test('with distinct approvers on, whoever approved the design cannot approve the code (I4)', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { team: { distinct_gate_approvers: true } } })
    const run = await getRun(ctx)
    assert.deepEqual(run.governance.excluded, [
      { username: 'rae', reason: 'requester' },
      { username: 'pat', reason: 'approved Gate 1' },
      { username: 'eli', reason: 'approved Gate 2' },
    ])
    const out = await decide(ctx, ctx.eli, { decision: 'approve', gate: 'g3' })
    assert.equal(out.status, 403)
    assert.equal(out.body.reason, 'same_approver')
    assert.equal((await decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })).body.step, 'done')
  } finally { ctx.close() }
})

test('without the rule, the design approver may approve the code (default stays as before)', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx)
    assert.equal((await decide(ctx, ctx.eli, { decision: 'approve', gate: 'g3' })).body.step, 'done')
  } finally { ctx.close() }
})

test('sending the work back clears the approvals of that review round (I4)', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { team: { min_approvals: 2 } } })
    await decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })
    assert.equal((await decide(ctx, ctx.bob, { decision: 'reject', target: 'code', gate: 'g3' })).body.step, 'code')
    assert.equal((await handOver(ctx)).status, 200)
    const run = await getRun(ctx)
    assert.deepEqual(run.governance.approvals, [])
    assert.equal((await decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })).body.step, 'g3')
  } finally { ctx.close() }
})

test('an Admin counts as an approver for the default rules (I4)', async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { team: { min_approvals: 2 } } })
    await decide(ctx, ctx.admin, { decision: 'approve', gate: 'g3' })
    assert.equal((await decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })).body.step, 'done')
  } finally { ctx.close() }
})

// ── I4 on real Postgres: approvals at the same moment ───────────────────

test('two reviewers approving at the same moment: both counted once, one move to Done (I4)', { skip: NEEDS_PG }, async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { team: { min_approvals: 2 } } })
    const outs = await Promise.all([
      decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' }),
      decide(ctx, ctx.bob, { decision: 'approve', gate: 'g3' }),
    ])
    assert.deepEqual(outs.map((o) => o.status), [200, 200])
    const run = await getRun(ctx)
    assert.equal(run.step, 'done')
    assert.equal(run.auditChain.filter((e) => e.event === 'g3.approval_recorded').length, 1)
    assert.equal(run.auditChain.filter((e) => e.event === 'g3.approved').length, 1)
    assert.equal(run.verified, true)
  } finally { ctx.close() }
})

test('a double click by one reviewer is one approval (I4)', { skip: NEEDS_PG }, async () => {
  const ctx = await setup()
  try {
    await toGate3(ctx, { policy: { team: { min_approvals: 2 } } })
    const outs = await Promise.all([1, 2, 3].map(() => decide(ctx, ctx.erin, { decision: 'approve', gate: 'g3' })))
    assert.equal(outs.filter((o) => o.status === 200).length, 1, JSON.stringify(outs.map((o) => o.body?.reason)))
    const run = await getRun(ctx)
    assert.equal(run.step, 'g3')
    assert.deepEqual(run.governance.approvals.map((a) => a.username), ['erin'])
  } finally { ctx.close() }
})

test('requirements stored before the hand-over are checked too (review)', async () => {
  const ctx = await setup()
  try {
    assert.equal((await ctx.call('PUT', `${R}/artifacts`, ctx.agent, { requirements: 'no ids here' })).status, 200)
    const out = await act(ctx, 'submit_requirements')
    assert.equal(out.status, 400)
    assert.equal(out.body.reason, 'requirements_ids_missing')
  } finally { ctx.close() }
})
