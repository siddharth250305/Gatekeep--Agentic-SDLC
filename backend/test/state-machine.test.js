// Milestone 2 (B2, B3, B4, B5, B8): the run state machine.
//
// The expected table below is copied from organised.md (Milestone 2, "The
// allowed moves table for B2"), independently of src/runs/machine.js, so the
// test fails if the code's table drifts from the design.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACTIONS, STEPS, planMove } from '../src/runs/machine.js'
import { cancelRun, createRun, decideGate, getRun, robotAction } from '../src/runs/service.js'
import { freshDb } from './helpers/db.js'
import { FP, handOver } from './helpers/evidence.js'

const ROBOT = 'Robot'
// [from, action, to, who]
const EXPECTED = [
  ['req', 'submit_requirements', 'g1', [ROBOT]],
  ['g1', 'approve', 'design', ['Planner']],
  ['g1', 'reject', 'req', ['Planner']],
  ['design', 'submit_design', 'g2', [ROBOT]],
  ['g2', 'approve', 'code', ['Engineer']],
  ['g2', 'reject', 'design', ['Engineer']],
  ['code', 'request_review', 'g3', [ROBOT]],
  ['g3', 'approve', 'done', ['Engineer']], // and not the requester
  ['g3', 'reject_to_code', 'code', ['Engineer']],
  ['g3', 'reject_to_design', 'design', ['Engineer']],
  ...['req', 'g1', 'design', 'g2', 'code', 'g3'].map((from) => [from, 'cancel', 'cancelled', ['Planner', 'Engineer']]),
]

const ALL_STEPS = ['req', 'g1', 'design', 'g2', 'code', 'g3', 'done', 'cancelled']
const ALL_ACTIONS = ['submit_requirements', 'approve', 'reject', 'submit_design', 'request_review', 'reject_to_code', 'reject_to_design', 'cancel']
// Admin may act for any human role (the rule from Milestone 1), never as the robot.
const ACTORS = {
  Robot: { kind: 'agent', name: 'mcp' },
  Planner: { kind: 'human', role: 'Planner', userId: 1 },
  Engineer: { kind: 'human', role: 'Engineer', userId: 2 },
  Admin: { kind: 'human', role: 'Admin', userId: 3 },
}

function expectedOutcome(from, action, who) {
  const row = EXPECTED.find(([f, a]) => f === from && a === action)
  if (!row) return null
  const [, , to, roles] = row
  const allowed = roles.includes(who) || (who === 'Admin' && !roles.includes(ROBOT))
  return allowed ? to : null
}

test('the machine knows exactly the steps and actions of the design table', () => {
  assert.deepEqual(STEPS.map((s) => s.key), ['req', 'g1', 'design', 'g2', 'code', 'g3', 'done'])
  assert.deepEqual([...ACTIONS].sort(), [...ALL_ACTIONS].sort())
})

test('every (step, action, actor) combination matches the allowed moves table', () => {
  let allowed = 0
  for (const from of ALL_STEPS) {
    for (const action of ALL_ACTIONS) {
      for (const [who, actor] of Object.entries(ACTORS)) {
        const want = expectedOutcome(from, action, who)
        const got = planMove({ step: from, createdBy: 99 }, action, actor)
        if (want) {
          allowed++
          assert.equal(got.to, want, `${from} --${action}--> by ${who} should go to ${want}, got ${JSON.stringify(got)}`)
        } else {
          assert.ok(got.error, `${from} --${action}--> by ${who} must be refused, got ${JSON.stringify(got)}`)
          assert.equal(got.to, undefined)
        }
      }
    }
  }
  // 3 robot rows + 7 human gate rows x (role + Admin) + 6 cancel rows x 3 roles
  assert.equal(allowed, 3 + 7 * 2 + 6 * 3)
})

test('Done and Cancelled refuse every action, from every actor', () => {
  for (const step of ['done', 'cancelled']) {
    for (const action of ALL_ACTIONS) {
      for (const actor of Object.values(ACTORS)) {
        assert.equal(planMove({ step }, action, actor).error, 'finished')
      }
    }
  }
})

test('an unknown or missing step refuses everything (fail closed)', () => {
  for (const step of [null, undefined, 'out', 'Requirements', '']) {
    assert.equal(planMove({ step }, 'approve', ACTORS.Engineer).error, 'unknown_step')
    assert.equal(planMove({ step }, 'submit_requirements', ACTORS.Robot).error, 'unknown_step')
  }
})

test('an unknown action or actor is refused', () => {
  assert.equal(planMove({ step: 'g1' }, 'skip', ACTORS.Planner).error, 'bad_action')
  assert.ok(planMove({ step: 'g1' }, 'approve', null).error)
  assert.ok(planMove({ step: 'g1' }, 'approve', { kind: 'human', role: 'Visitor' }).error)
})

test('B5: robot steps cannot be approved or rejected by anyone', () => {
  for (const step of ['req', 'design', 'code']) {
    for (const action of ['approve', 'reject', 'reject_to_code', 'reject_to_design']) {
      for (const who of ['Planner', 'Engineer', 'Admin']) {
        assert.equal(planMove({ step }, action, ACTORS[who]).error, 'not_allowed', `${who} ${action} at ${step}`)
      }
    }
  }
})

test('the robot can never approve, reject or cancel', () => {
  for (const step of ALL_STEPS) {
    for (const action of ['approve', 'reject', 'reject_to_code', 'reject_to_design', 'cancel']) {
      assert.ok(planMove({ step }, action, ACTORS.Robot).error)
    }
  }
})

test('the person who asked for the work cannot approve it at Gate 3', () => {
  const run = { step: 'g3', createdBy: 2 }
  assert.equal(planMove(run, 'approve', ACTORS.Engineer).error, 'requester')
  assert.equal(planMove(run, 'approve', { kind: 'human', role: 'Admin', userId: 2 }).error, 'requester')
  // Sending it back is still allowed: only the final approval is restricted.
  assert.equal(planMove(run, 'reject_to_code', ACTORS.Engineer).to, 'code')
  assert.equal(planMove({ step: 'g3', createdBy: 7 }, 'approve', ACTORS.Engineer).to, 'done')
})

// ---- the same table, driven through the database ------------------------

const PLANNER = { id: 11, username: 'pat-planner', role: 'Planner' }
const ENGINEER = { id: 12, username: 'eli-engineer', role: 'Engineer' }
const REQUESTER = { id: 13, username: 'rae-requester', role: 'Engineer' }

async function newRun(db, runId = 'RUN-SM') {
  await createRun(db, { runId, brief: 'state machine', createdBy: REQUESTER })
  return runId
}

const stepOf = async (db, runId) => (await getRun(db, runId)).step
const phaseStates = async (db, runId) => Object.fromEntries((await getRun(db, runId)).steps.map((s) => [s.key, s.state]))

test('a new run starts at Requirements with the Requirements step active', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  const run = await getRun(db, id)
  assert.equal(run.step, 'req')
  assert.equal(run.status, 'running')
  assert.equal(run.awaiting, false)
  assert.deepEqual(await phaseStates(db, id), { req: 'active', g1: 'pending', design: 'pending', g2: 'pending', code: 'pending', g3: 'pending', done: 'pending' })
})

test('the happy path walks every forward row of the table', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  const agent = 'mcp'

  assert.ok((await robotAction(db, id, 'submit_requirements', { agent })).run)
  assert.equal(await stepOf(db, id), 'g1')
  let run = await getRun(db, id)
  assert.equal(run.status, 'awaiting_gate')
  assert.equal(run.gate, 'Planner')

  assert.ok((await decideGate(db, id, { decision: 'approve', user: PLANNER })).run)
  assert.equal(await stepOf(db, id), 'design')

  assert.ok((await robotAction(db, id, 'submit_design', { agent })).run)
  assert.equal(await stepOf(db, id), 'g2')
  assert.equal((await getRun(db, id)).gate, 'Engineer')

  assert.ok((await decideGate(db, id, { decision: 'approve', user: ENGINEER })).run)
  assert.equal(await stepOf(db, id), 'code')

  // B3: "request review" moves the run from Code to a real, human Gate 3.
  assert.ok((await handOver(db, id, { agent })).run)
  run = await getRun(db, id)
  assert.equal(run.step, 'g3')
  assert.equal(run.status, 'awaiting_gate')
  assert.equal(run.gate, 'Engineer')
  assert.equal(run.awaiting, true)
  assert.equal(run.steps.find((s) => s.key === 'g3').state, 'active')

  assert.ok((await decideGate(db, id, { decision: 'approve', user: ENGINEER })).run)
  run = await getRun(db, id)
  assert.equal(run.step, 'done')
  assert.equal(run.status, 'approved')
  assert.equal(run.gate, null)
  assert.ok(run.steps.every((s) => s.state === 'approved'), JSON.stringify(run.steps.map((s) => s.state)))
})

test('B4: each reject sends the run back to the right step', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  const agent = 'mcp'

  await robotAction(db, id, 'submit_requirements', { agent })
  assert.ok((await decideGate(db, id, { decision: 'reject', user: PLANNER, feedback: 'too vague' })).run)
  assert.equal(await stepOf(db, id), 'req')
  assert.equal((await getRun(db, id)).steps.find((s) => s.key === 'req').state, 'active')

  await robotAction(db, id, 'submit_requirements', { agent })
  await decideGate(db, id, { decision: 'approve', user: PLANNER })
  await robotAction(db, id, 'submit_design', { agent })
  assert.ok((await decideGate(db, id, { decision: 'reject', user: ENGINEER })).run)
  assert.equal(await stepOf(db, id), 'design')

  await robotAction(db, id, 'submit_design', { agent })
  await decideGate(db, id, { decision: 'approve', user: ENGINEER })
  await handOver(db, id, { agent })
  assert.ok((await decideGate(db, id, { decision: 'reject', target: 'code', user: ENGINEER })).run)
  assert.equal(await stepOf(db, id), 'code')

  await handOver(db, id, { agent })
  assert.ok((await decideGate(db, id, { decision: 'reject', target: 'design', user: ENGINEER })).run)
  assert.equal(await stepOf(db, id), 'design')
  const states = await phaseStates(db, id)
  assert.equal(states.design, 'active')
  assert.equal(states.code, 'pending')
  // The gate that sent the work back shows "Changes requested" until the run moves on.
  assert.equal(states.g3, 'rejected')
  await robotAction(db, id, 'submit_design', { agent })
  assert.equal((await phaseStates(db, id)).g3, 'pending')
})

test('B4: rejecting at Gate 3 needs a target (code or design)', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: PLANNER })
  await robotAction(db, id, 'submit_design', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: ENGINEER })
  await handOver(db, id, { agent: 'mcp' })
  assert.equal((await decideGate(db, id, { decision: 'reject', user: ENGINEER })).error, 'target_required')
  assert.equal((await decideGate(db, id, { decision: 'reject', target: 'req', user: ENGINEER })).error, 'target_required')
  assert.equal(await stepOf(db, id), 'g3')
})

test('B4 regression: reject at Gate 2, resubmit requirements, can never jump to Code', async () => {
  // drawback.md 2.3: after a Gate 2 reject the server guessed "Requirements";
  // resubmitting requirements and approving Gate 1 then skipped the rejected
  // design and landed on Code.
  const db = await freshDb()
  const id = await newRun(db)
  await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: PLANNER })
  await robotAction(db, id, 'submit_design', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'reject', user: ENGINEER, feedback: 'wrong approach' })
  assert.equal(await stepOf(db, id), 'design')

  // The robot tries to restart from requirements: refused.
  assert.equal((await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })).error, 'not_allowed')
  // Nobody can approve Gate 1 or Gate 2 now: the run is at the robot's Design step.
  assert.equal((await decideGate(db, id, { decision: 'approve', user: PLANNER })).error, 'not_allowed')
  assert.equal((await decideGate(db, id, { decision: 'approve', user: ENGINEER })).error, 'not_allowed')
  // Asking for code review from Design is refused too.
  assert.equal((await robotAction(db, id, 'request_review', { agent: 'mcp', fingerprint: FP })).error, 'not_allowed')

  assert.equal(await stepOf(db, id), 'design')
  const states = await phaseStates(db, id)
  assert.equal(states.code, 'pending')
  assert.equal(states.design, 'active')

  // The only way forward is a new design, reviewed again at Gate 2.
  await robotAction(db, id, 'submit_design', { agent: 'mcp' })
  assert.equal(await stepOf(db, id), 'g2')
})

test('a finished (Done) run cannot be reopened by anyone', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: PLANNER })
  await robotAction(db, id, 'submit_design', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: ENGINEER })
  await handOver(db, id, { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: ENGINEER })
  const chainBefore = (await getRun(db, id)).auditChain.length

  for (const a of ['submit_requirements', 'submit_design', 'request_review']) {
    assert.equal((await robotAction(db, id, a, { agent: 'mcp', fingerprint: FP })).error, 'finished')
  }
  for (const d of [{ decision: 'approve' }, { decision: 'reject' }, { decision: 'reject', target: 'code' }]) {
    assert.equal((await decideGate(db, id, { ...d, user: ENGINEER })).error, 'finished')
  }
  assert.equal((await cancelRun(db, id, { user: PLANNER })).error, 'finished')

  const run = await getRun(db, id)
  assert.equal(run.step, 'done')
  assert.equal(run.auditChain.length, chainBefore)
})

test('cancel works from every active step and is final', async () => {
  const agent = 'mcp'
  const reach = {
    req: [],
    g1: [['robot', 'submit_requirements']],
    design: [['robot', 'submit_requirements'], ['human', PLANNER]],
    g2: [['robot', 'submit_requirements'], ['human', PLANNER], ['robot', 'submit_design']],
    code: [['robot', 'submit_requirements'], ['human', PLANNER], ['robot', 'submit_design'], ['human', ENGINEER]],
    g3: [['robot', 'submit_requirements'], ['human', PLANNER], ['robot', 'submit_design'], ['human', ENGINEER], ['robot', 'request_review']],
  }
  for (const [step, path] of Object.entries(reach)) {
    const db = await freshDb()
    const id = await newRun(db, `RUN-C-${step}`)
    for (const [kind, x] of path) {
      const out = kind === 'robot' ? await robotAction(db, id, x, { agent, fingerprint: FP }) : await decideGate(db, id, { decision: 'approve', user: x })
      assert.ok(out.run, JSON.stringify(out))
    }
    assert.equal(await stepOf(db, id), step)
    assert.ok((await cancelRun(db, id, { user: step === 'g1' ? PLANNER : ENGINEER, feedback: 'not needed' })).run)
    const run = await getRun(db, id)
    assert.equal(run.step, 'cancelled')
    assert.equal(run.status, 'cancelled')
    assert.equal(run.awaiting, false)
    assert.equal((await robotAction(db, id, 'submit_requirements', { agent })).error, 'finished')
    assert.equal((await cancelRun(db, id, { user: PLANNER })).error, 'finished')
  }
})

test('wrong role is refused and changes nothing', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  const out = await decideGate(db, id, { decision: 'approve', user: ENGINEER })
  assert.equal(out.error, 'wrong_role')
  assert.equal(out.gate, 'Planner')
  assert.equal(await stepOf(db, id), 'g1')
})

test('the requester cannot approve their own run at Gate 3', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: PLANNER })
  await robotAction(db, id, 'submit_design', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: REQUESTER }) // Gate 2 is fine
  await handOver(db, id, { agent: 'mcp' })
  assert.equal((await decideGate(db, id, { decision: 'approve', user: REQUESTER })).error, 'requester')
  assert.equal(await stepOf(db, id), 'g3')
  assert.ok((await decideGate(db, id, { decision: 'approve', user: ENGINEER })).run)
})

// ---- B8: safe to repeat ---------------------------------------------------

test('B8: approving twice never skips a gate', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  assert.ok((await decideGate(db, id, { decision: 'approve', user: PLANNER, expectedStep: 'g1' })).run)
  const second = await decideGate(db, id, { decision: 'approve', user: PLANNER, expectedStep: 'g1' })
  assert.equal(second.error, 'stale')
  assert.equal(second.step, 'design')
  // Even without the expected step, a repeat lands on the robot's Design step and is refused.
  assert.equal((await decideGate(db, id, { decision: 'approve', user: PLANNER })).error, 'not_allowed')
  assert.equal(await stepOf(db, id), 'design')
  assert.equal((await getRun(db, id)).auditChain.filter((e) => e.event === 'g1.approved').length, 1)
})

test('B8: an approve meant for Gate 2 cannot land on Gate 3', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: PLANNER })
  await robotAction(db, id, 'submit_design', { agent: 'mcp' })
  await decideGate(db, id, { decision: 'approve', user: ENGINEER, expectedStep: 'g2' })
  await handOver(db, id, { agent: 'mcp' })
  // A delayed second click from the Gate 2 screen arrives while the run is at Gate 3.
  const late = await decideGate(db, id, { decision: 'approve', user: ENGINEER, expectedStep: 'g2' })
  assert.equal(late.error, 'stale')
  assert.equal(await stepOf(db, id), 'g3')
})

test('B8: a repeated robot submission is a no-op, not a second move', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  const first = await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  assert.equal(first.unchanged, undefined)
  const again = await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })
  assert.ok(again.run)
  assert.equal(again.unchanged, true)
  assert.equal(await stepOf(db, id), 'g1')
  const events = (await getRun(db, id)).auditChain.map((e) => e.event)
  assert.equal(events.filter((e) => e === 'requirements.submitted').length, 1)
})

// ---- every step change writes exactly one audit entry ------------------------

test('every step change writes exactly one audit entry with the real actor and server time', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  const moves = [
    () => robotAction(db, id, 'submit_requirements', { agent: 'mcp-agent' }),
    () => decideGate(db, id, { decision: 'reject', user: PLANNER, feedback: 'add limits' }),
    () => robotAction(db, id, 'submit_requirements', { agent: 'mcp-agent' }),
    () => decideGate(db, id, { decision: 'approve', user: PLANNER }),
    () => robotAction(db, id, 'submit_design', { agent: 'mcp-agent' }),
    () => decideGate(db, id, { decision: 'reject', user: ENGINEER }),
    () => robotAction(db, id, 'submit_design', { agent: 'mcp-agent' }),
    () => decideGate(db, id, { decision: 'approve', user: ENGINEER }),
    () => handOver(db, id, { agent: 'mcp-agent' }),
    () => decideGate(db, id, { decision: 'reject', target: 'code', user: ENGINEER }),
    () => handOver(db, id, { agent: 'mcp-agent' }),
    () => decideGate(db, id, { decision: 'approve', user: ENGINEER }),
  ]
  const expected = [
    ['requirements.submitted', 'agent:mcp-agent', 'req', 'g1'],
    ['g1.rejected', 'pat-planner', 'g1', 'req'],
    ['requirements.submitted', 'agent:mcp-agent', 'req', 'g1'],
    ['g1.approved', 'pat-planner', 'g1', 'design'],
    ['design.submitted', 'agent:mcp-agent', 'design', 'g2'],
    ['g2.rejected', 'eli-engineer', 'g2', 'design'],
    ['design.submitted', 'agent:mcp-agent', 'design', 'g2'],
    ['g2.approved', 'eli-engineer', 'g2', 'code'],
    ['code.review_requested', 'agent:mcp-agent', 'code', 'g3'],
    ['g3.rejected', 'eli-engineer', 'g3', 'code'],
    ['code.review_requested', 'agent:mcp-agent', 'code', 'g3'],
    ['g3.approved', 'eli-engineer', 'g3', 'done'],
  ]
  const startLen = (await getRun(db, id)).auditChain.length
  for (let i = 0; i < moves.length; i++) {
    const before = (await getRun(db, id)).auditChain.length
    const t0 = Date.now()
    const out = await moves[i]()
    assert.ok(out.run, `move ${i}: ${JSON.stringify(out)}`)
    const chain = (await getRun(db, id)).auditChain
    assert.equal(chain.length, before + 1, `move ${i} must write exactly one entry`)
    const e = chain.at(-1)
    const [event, actor, from, to] = expected[i]
    assert.equal(e.event, event)
    assert.equal(e.actor, actor)
    assert.equal(e.payload.from, from)
    assert.equal(e.payload.to, to)
    assert.ok(Math.abs(Date.parse(e.createdAt) - t0) < 5000, 'server clock')
  }
  const run = await getRun(db, id)
  assert.equal(run.auditChain.length, startLen + moves.length)
  assert.equal(run.verified, true)
  assert.equal(run.auditChain[startLen + 1].payload.feedback, 'add limits')
})

test('creating a run records who asked for it', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  const run = await getRun(db, id)
  assert.equal(run.createdBy, 'rae-requester')
  assert.deepEqual(run.auditChain.map((e) => [e.event, e.actor, e.payload.to]), [['run.created', 'rae-requester', 'req']])
})

test('a refused move writes nothing to the audit log', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  const before = (await getRun(db, id)).auditChain.length
  await decideGate(db, id, { decision: 'approve', user: PLANNER })
  await robotAction(db, id, 'request_review', { agent: 'mcp', fingerprint: FP })
  await cancelRun(db, id, { user: { id: 50, username: 'x', role: 'Visitor' } })
  assert.equal((await getRun(db, id)).auditChain.length, before)
})

test('a run from before the state machine (no step) is refused, not guessed', async () => {
  const db = await freshDb()
  const id = await newRun(db)
  await db.query('UPDATE runs SET step = NULL WHERE run_id = $1', [id])
  assert.equal((await robotAction(db, id, 'submit_requirements', { agent: 'mcp' })).error, 'unknown_step')
  assert.equal((await decideGate(db, id, { decision: 'approve', user: PLANNER })).error, 'unknown_step')
})
