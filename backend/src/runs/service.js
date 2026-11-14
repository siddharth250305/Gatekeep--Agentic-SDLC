// Run state: runs, pipeline phases (with cost/token metrics), and test results.
// Assembles the full run view the frontend consumes, including the audit chain
// and its verification result from the audit layer. Step changes go only
// through transition(), which applies the allowed-moves table in machine.js.

import { randomUUID } from 'node:crypto'
import { appendEvent, getChain, verifyRun } from '../audit/service.js'
import { withTransaction } from '../db.js'
import { GATES, MOVES, ROBOT_ACTIONS, STEPS, planMove, robotTarget, statusFor } from './machine.js'


const fmtCost = (n) => (n == null ? null : `$${Number(n).toFixed(2)}`)
const fmtTokens = (n) => (n == null ? null : Number(n).toLocaleString('en-US'))
const fmtDuration = (ms) => {
  if (!ms) return '—' // em-dash-free: use figure dash placeholder
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m ? `${m}m ${r}s` : `${r}s`
}

async function touchRun(db, runId) {
  await db.query('UPDATE runs SET updated_at = now() WHERE run_id = $1', [runId])
}

// The run row, its phases and its "run.created" audit event are written in one
// transaction, so a failure can never leave a run without phases. A new run
// starts at Requirements. createdBy is the logged-in reviewer who asked for the
// work ({ id, username }); they may not give the final approval at Gate 3.
// Generated ids retry on collision.
export async function createRun(db, { runId, brief, description = '', repo = '', branch = '', commit = '', createdBy = null } = {}) {
  if (!brief) throw new Error('brief is required')
  for (let attempt = 0; ; attempt++) {
    try {
      const id = await withTransaction(db, async (tx) => {
        let id = runId
        if (!id) {
          const c = await tx.query('SELECT count(*)::int AS n FROM runs')
          id = `RUN-${1000 + c.rows[0].n + attempt}`
        }
        const { status, gate } = statusFor('req')
        await tx.query(
          `INSERT INTO runs (run_id, brief, description, repo, branch, commit, status, gate, step, created_by, created_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'req', $9, $10)`,
          [id, brief, description, repo, branch, commit, status, gate, createdBy?.id ?? null, createdBy?.username ?? null],
        )
        for (let i = 0; i < STEPS.length; i++) {
          const p = STEPS[i]
          const first = i === 0
          await tx.query(
            `INSERT INTO run_phases (run_id, seq, key, label, role, state, status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, i + 1, p.key, p.label, p.role, first ? 'active' : 'pending', first ? 'In progress' : 'Not started'],
          )
        }
        await appendEvent(tx, {
          runId: id, event: 'run.created', actor: createdBy?.username || 'system', payload: { to: 'req' },
        })
        return id
      })
      return getRun(db, id)
    } catch (err) {
      const duplicate = err.code === '23505' || /duplicate key|already exists/i.test(err.message)
      if (runId || !duplicate || attempt >= 4) throw err
    }
  }
}

export async function listRuns(db) {
  const { rows } = await db.query(
    `SELECT r.run_id, r.brief, r.status, r.repo, r.branch, r.updated_at,
            COALESCE(SUM(p.cost_usd), 0) AS cost
     FROM runs r
     LEFT JOIN run_phases p ON p.run_id = r.run_id
     GROUP BY r.run_id
     ORDER BY r.created_at DESC`,
  )
  return rows.map((r) => ({
    id: r.run_id,
    brief: r.brief,
    status: r.status,
    repo: r.repo,
    branch: r.branch,
    updatedAt: r.updated_at,
    totals: { cost: fmtCost(r.cost) },
  }))
}

export async function getRun(db, runId) {
  const runRes = await db.query('SELECT * FROM runs WHERE run_id = $1', [runId])
  const run = runRes.rows[0]
  if (!run) return null

  const phaseRes = await db.query(
    'SELECT * FROM run_phases WHERE run_id = $1 ORDER BY seq ASC',
    [runId],
  )

  let costSum = 0
  let tokSum = 0
  let durSum = 0
  const steps = phaseRes.rows.map((p) => {
    const tokens =
      p.input_tokens != null || p.output_tokens != null
        ? (p.input_tokens || 0) + (p.output_tokens || 0)
        : null
    if (p.cost_usd != null) costSum += Number(p.cost_usd)
    if (tokens != null) tokSum += tokens
    if (p.duration_ms != null) durSum += p.duration_ms
    return {
      key: p.key,
      label: p.label,
      role: p.role,
      state: p.state,
      status: p.status,
      at: p.at || null,
      num: p.seq,
      cost: fmtCost(p.cost_usd),
      tokens: fmtTokens(tokens),
    }
  })

  const trRes = await db.query('SELECT * FROM test_results WHERE run_id = $1', [runId])
  const tr = trRes.rows[0]
  const latest = await latestTestRun(db, runId)
  const sandbox = tr || latest
    ? { status: latest?.status ?? null, image: tr?.image ?? null, network: tr?.network ?? null, memory: tr?.memory ?? null, cpu: tr?.cpu ?? null, timeout: tr?.timeout ?? null }
    : null
  // The latest recorded test run is the only source of test results (C2).
  const tests = latest
    ? {
        id: latest.id, status: latest.status, passed: latest.passed, failed: latest.failed, skipped: latest.skipped,
        total: latest.total, iterations: latest.iterations, duration: fmtDuration(latest.duration_ms),
        output: latest.output ?? null, fingerprint: latest.fingerprint, cases: latest.cases ?? [],
        missingExisting: latest.missing_existing ?? [], at: latest.created_at,
      }
    : null

  const artRes = await db.query('SELECT files, diff, summary, requirements, design, comments FROM run_artifacts WHERE run_id = $1', [runId])
  const art = artRes.rows[0]

  const ctxRes = await db.query('SELECT context FROM run_repo_context WHERE run_id = $1', [runId])
  const repoContext = ctxRes.rows[0]?.context ?? null

  const chain = await getChain(db, runId)
  let verify = await verifyRun(db, runId)
  // Every run starts with a "run.created" entry, so an empty diary means it was wiped.
  if (verify.valid && chain.length === 0) verify = { runId, valid: false, brokenAt: 1, reason: 'truncated' }

  return {
    id: run.run_id,
    files: art?.files ?? null,
    diff: art?.diff ?? null,
    summary: art?.summary ?? null,
    requirements: art?.requirements ?? null,
    design: art?.design ?? null,
    comments: art?.comments ?? [],
    repositoryContext: repoContext,
    brief: run.brief,
    description: run.description,
    repo: run.repo,
    branch: run.branch,
    commit: run.commit,
    // step is the state machine's position (req, g1, design, g2, code, g3,
    // done, cancelled); status and gate are derived from it for the dashboard.
    step: run.step ?? null,
    status: run.status,
    gate: run.gate,
    awaiting: run.status === 'awaiting_gate',
    createdBy: run.created_by_name ?? null,
    // At Gate 3: which code was handed over, the test run it is judged on,
    // and whether approval is possible (B7). Same rule the approve uses.
    review: run.step === 'g3' ? reviewEvidence(run.review_fingerprint, latest) : null,
    started: run.started_at != null,
    updatedAt: run.updated_at,
    steps,
    totals: {
      cost: `$${costSum.toFixed(2)}`,
      tokens: tokSum.toLocaleString('en-US'),
      wall: fmtDuration(durSum),
    },
    sandbox,
    tests,
    auditChain: chain,
    verified: verify.valid,
    verify, // full result incl brokenAt / reason for the tamper demo
  }
}


// Phase rows hold the run's cost and token metrics. Their state, status and
// time belong to the state machine, so the agents may only report metrics.
const METRIC_FIELDS = ['cost_usd', 'input_tokens', 'output_tokens', 'model', 'duration_ms']
const STATE_FIELDS = ['state', 'status', 'at']

export class PhaseStateError extends Error {}

export async function recordPhaseMetrics(db, runId, key, fields = {}) {
  const forbidden = STATE_FIELDS.filter((f) => fields[f] !== undefined)
  if (forbidden.length) {
    throw new PhaseStateError(`${forbidden.join(', ')} can only change through a gate decision or a robot action`)
  }
  const sets = []
  const vals = []
  let i = 1
  for (const col of METRIC_FIELDS) {
    if (fields[col] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(fields[col]) }
  }
  if (!sets.length) return null
  vals.push(runId, key)
  const res = await db.query(
    `UPDATE run_phases SET ${sets.join(', ')} WHERE run_id = $${i++} AND key = $${i} RETURNING *`,
    vals,
  )
  if (!res.rows[0]) return null
  await touchRun(db, runId)
  return res.rows[0]
}

function nowLabel() {
  return (
    new Date().toLocaleString('en-US', {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'UTC',
    }) + ' UTC'
  )
}

async function setPhase(db, runId, key, state, status, at = null) {
  await db.query(
    'UPDATE run_phases SET state = $1, status = $2, at = COALESCE($3, at) WHERE run_id = $4 AND key = $5',
    [state, status, at, runId, key],
  )
}

// Make the phase rows show where the run is after moving from -> to.
// Earlier steps keep their result, the new step is active, later steps go back
// to pending, and a gate that just sent work back shows "Changes requested"
// until the run moves on.
async function showStep(db, runId, from, to) {
  const at = nowLabel()
  const phases = (await db.query('SELECT key, seq FROM run_phases WHERE run_id = $1 ORDER BY seq ASC', [runId])).rows
  const seqOf = (k) => phases.find((p) => p.key === k)?.seq
  if (to === 'cancelled') return setPhase(db, runId, from, 'cancelled', 'Cancelled', at)
  if (to === 'done') {
    for (const p of phases) {
      if (p.key === from) await setPhase(db, runId, p.key, 'approved', 'Approved', at)
      else if (p.key === 'done') await setPhase(db, runId, p.key, 'approved', 'Complete', at)
    }
    return
  }
  const back = seqOf(to) < seqOf(from)
  for (const p of phases) {
    if (p.key === to) {
      const status = GATES.has(to) ? 'Ready for review' : back ? 'Rework requested' : 'In progress'
      await setPhase(db, runId, p.key, 'active', status)
    } else if (p.key === from) {
      if (back) await setPhase(db, runId, p.key, 'rejected', 'Changes requested', at)
      else await setPhase(db, runId, p.key, 'approved', GATES.has(from) ? 'Approved' : 'Complete', at)
    } else if (p.seq > seqOf(to)) {
      await setPhase(db, runId, p.key, 'pending', 'Not started')
    }
  }
}

// The only function that changes a run's step. In one transaction it locks the
// run row, checks the move against the table in machine.js, updates the run
// and its phases, and writes exactly one audit event. Two callers deciding at
// the same moment are handled one after the other; the second sees the new step.
//
// pick(run) returns the action to try for the run as it is now (or { error }).
// actor: { kind, role, userId } for planMove; name: who the audit log records.
// details: what a robot wants recorded with its move (e.g. the files changed).
// artifacts: what a robot hands over with its move, stored only if the move is allowed.
// expectedStep: refuse with 'stale' if the run is no longer at this step.
// sameAs: for robot actions, a step at which the action already happened, so a
// repeat returns { unchanged: true } instead of an error.
// guard(tx, run, plan): after the move is allowed by the table, a last check
// (Gate 3 evidence, B7). Returns { error } to refuse, or { payload } with
// fields to add to the move's audit entry.
async function transition(db, runId, { pick, actor, name, feedback, details, artifacts, expectedStep, sameAs, guard }) {
  const out = await withTransaction(db, async (tx) => {
    const run = (await tx.query('SELECT * FROM runs WHERE run_id = $1 FOR UPDATE', [runId])).rows[0]
    if (!run) return { error: 'not_found' }
    if (expectedStep != null && expectedStep !== run.step) return { error: 'stale', step: run.step }
    if (sameAs && run.step === sameAs) return { unchanged: true }

    const action = pick(run)
    if (action.error) return action
    const plan = planMove({ step: run.step, createdBy: run.created_by }, action, actor)
    if (plan.error) return { ...plan, step: run.step }
    const guarded = guard ? await guard(tx, run, plan) : {}
    if (guarded.error) return { ...guarded, step: run.step }

    const { status, gate } = statusFor(plan.to)
    await tx.query(
      'UPDATE runs SET step = $1, status = $2, gate = $3, updated_at = now() WHERE run_id = $4',
      [plan.to, status, gate, runId],
    )
    await showStep(tx, runId, run.step, plan.to)
    if (artifacts) await upsertArtifacts(tx, runId, artifacts)
    const payload = { from: run.step, to: plan.to, ...guarded.payload }
    if (typeof feedback === 'string' && feedback.trim()) payload.feedback = feedback
    if (details) payload.details = details
    await appendEvent(tx, { runId, event: plan.move.event, actor: name, payload })
    return { from: run.step, to: plan.to }
  })
  if (out.error) return out
  return { ...out, run: await getRun(db, runId) }
}

const humanActor = (user) => ({ kind: 'human', role: user?.role, userId: user?.id })

// A human gate decision. decision: 'approve' | 'reject'. At Gate 3 a reject
// must say where the work goes back to: target 'code' or 'design'.
// user is the logged-in reviewer ({ id, username, role }); 'Admin' may decide
// any gate. Returns { run, from, to } or { error, ... }.
export async function decideGate(db, runId, { decision, target, feedback, expectedStep, user } = {}) {
  if (decision !== 'approve' && decision !== 'reject') return { error: 'bad_decision' }
  const pick = (run) => {
    if (decision === 'approve') return 'approve'
    if (run.step !== 'g3') return 'reject'
    if (target === 'code') return 'reject_to_code'
    if (target === 'design') return 'reject_to_design'
    return { error: 'target_required' }
  }
  // B7: Gate 3 approves only the exact code that was handed over, and only
  // when the latest test run passed on that same code.
  const guard = async (tx, run, plan) => {
    if (plan.to !== 'done') return {}
    const evidence = reviewEvidence(run.review_fingerprint, await latestTestRun(tx, runId))
    if (!evidence.approvable) return { error: evidence.reason }
    return { payload: { evidence: { fingerprint: evidence.fingerprint, testRun: evidence.testRunId } } }
  }
  return transition(db, runId, {
    pick, actor: humanActor(user), name: user?.username, feedback, expectedStep, guard,
  })
}

// Cancel a run from any active step (Planner, Engineer or Admin).
export async function cancelRun(db, runId, { user, feedback, expectedStep } = {}) {
  return transition(db, runId, {
    pick: () => 'cancel', actor: humanActor(user), name: user?.username, feedback, expectedStep,
  })
}

// A robot finished its step: submit_requirements | submit_design | request_review.
// Repeating one that already went through returns { run, unchanged: true }
// and stores nothing. details (optional plain object) is stored inside that
// move's audit entry. artifacts (optional) is the work being handed over; each
// action may only carry its own kind (see ACTION_ARTIFACTS).
// The artifacts each robot step produces. A robot can only write the ones of
// the step the run is at, so what a reviewer is looking at a gate (or approved
// at Done) cannot be swapped afterwards.
const STEP_ARTIFACTS = {
  req: ['requirements'],
  design: ['design'],
  code: ['files', 'diff', 'summary'],
}
const ACTION_ARTIFACTS = Object.fromEntries(
  MOVES.filter((m) => ROBOT_ACTIONS.has(m.action)).map((m) => [m.action, STEP_ARTIFACTS[m.from]]),
)

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export async function robotAction(db, runId, action, { agent, details, artifacts, fingerprint } = {}) {
  if (!ROBOT_ACTIONS.has(action)) return { error: 'bad_action' }
  // B7: review is always of one exact version of the code.
  const review = action === 'request_review'
  if (review && !(typeof fingerprint === 'string' && FINGERPRINT.test(fingerprint))) return { error: 'fingerprint_required' }
  if (details !== undefined && !isPlainObject(details)) return { error: 'bad_details' }
  if (artifacts !== undefined) {
    if (!isPlainObject(artifacts)) return { error: 'bad_artifacts' }
    if (Object.keys(artifacts).some((k) => !ACTION_ARTIFACTS[action].includes(k))) return { error: 'bad_artifacts' }
  }
  const guard = review
    ? async (tx) => {
        await tx.query('UPDATE runs SET review_fingerprint = $1 WHERE run_id = $2', [fingerprint, runId])
        return { payload: { fingerprint, testRun: (await latestTestRun(tx, runId))?.id ?? null } }
      }
    : undefined
  const out = await transition(db, runId, {
    pick: () => action, actor: { kind: 'agent' }, name: `agent:${agent}`, details, artifacts, sameAs: robotTarget(action), guard,
  })
  if (out.unchanged) return { unchanged: true, run: await getRun(db, runId) }
  return out
}

// An agent stores work in progress for the step the run is at (B1). Returns
// { ok: true } or { error: 'not_found' | 'bad_artifacts' | 'wrong_step', step }.
export async function writeStepArtifacts(db, runId, artifacts) {
  if (!isPlainObject(artifacts)) return { error: 'bad_artifacts' }
  return withTransaction(db, async (tx) => {
    const run = (await tx.query('SELECT step FROM runs WHERE run_id = $1 FOR UPDATE', [runId])).rows[0]
    if (!run) return { error: 'not_found' }
    const allowed = STEP_ARTIFACTS[run.step] || []
    if (!Object.keys(artifacts).every((k) => allowed.includes(k))) return { error: 'wrong_step', step: run.step }
    await upsertArtifacts(tx, runId, artifacts)
    return { ok: true }
  })
}

// Start is safe to repeat: the first call claims the run (only a run still at
// Requirements that was never started), later calls get { error: 'started' }.
// releaseStart() undoes the claim when the pipeline could not be reached.
export async function claimStart(db, runId) {
  const res = await db.query(
    `UPDATE runs SET started_at = now() WHERE run_id = $1 AND started_at IS NULL AND step = 'req' RETURNING run_id`,
    [runId],
  )
  if (res.rows[0]) return { ok: true }
  const run = (await db.query('SELECT step, started_at FROM runs WHERE run_id = $1', [runId])).rows[0]
  if (!run) return { error: 'not_found' }
  return { error: run.started_at ? 'started' : 'not_allowed', step: run.step }
}

export async function releaseStart(db, runId) {
  await db.query('UPDATE runs SET started_at = NULL WHERE run_id = $1', [runId])
}

// Store the artifacts the coding agent produced (files / diff / summary / requirements / design / comments).
export async function upsertArtifacts(db, runId, { files, diff, summary, requirements, design, comments } = {}) {
  const exists = await db.query('SELECT 1 FROM run_artifacts WHERE run_id = $1', [runId])
  if (exists.rows[0]) {
    const sets = []
    const vals = []
    let i = 1
    if (files !== undefined) { sets.push(`files = $${i++}`); vals.push(JSON.stringify(files)) }
    if (diff !== undefined) { sets.push(`diff = $${i++}`); vals.push(JSON.stringify(diff)) }
    if (summary !== undefined) { sets.push(`summary = $${i++}`); vals.push(JSON.stringify(summary)) }
    if (requirements !== undefined) { sets.push(`requirements = $${i++}`); vals.push(requirements) }
    if (design !== undefined) { sets.push(`design = $${i++}`); vals.push(JSON.stringify(design)) }
    if (comments !== undefined) { sets.push(`comments = $${i++}`); vals.push(JSON.stringify(comments)) }
    if (sets.length) {
      vals.push(runId)
      await db.query(`UPDATE run_artifacts SET ${sets.join(', ')} WHERE run_id = $${i}`, vals)
    }
  } else {
    await db.query(
      `INSERT INTO run_artifacts (run_id, files, diff, summary, requirements, design, comments)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        runId,
        JSON.stringify(files ?? null),
        JSON.stringify(diff ?? null),
        JSON.stringify(summary ?? null),
        requirements ?? null,
        JSON.stringify(design ?? null),
        JSON.stringify(comments ?? []),
      ],
    )
  }
  await touchRun(db, runId)
}

// Comments live in one JSONB array, so add/delete lock the artifacts row to
// stop two concurrent writers from overwriting each other's change.
export async function addComment(db, runId, comment) {
  return withTransaction(db, (tx) => addCommentLocked(tx, runId, comment))
}

// A run gets its artifacts row from the agents, so the first comment can come
// before it exists. Create it first, so there is always a row to lock (two
// first comments would otherwise both try to insert it).
async function lockComments(db, runId) {
  await db.query(
    `INSERT INTO run_artifacts (run_id, comments) VALUES ($1, $2)
     ON CONFLICT (run_id) DO NOTHING`,
    [runId, JSON.stringify([])],
  )
  return db.query('SELECT comments FROM run_artifacts WHERE run_id = $1 FOR UPDATE', [runId])
}

async function addCommentLocked(db, runId, comment) {
  const art = await lockComments(db, runId)
  const existing = Array.isArray(art.rows[0]?.comments) ? art.rows[0].comments : []
  const newComment = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    file: comment.file || '',
    line: comment.line ?? null,
    text: comment.text || '',
    author: comment.author || 'Reviewer',
    authorId: comment.authorId ?? null,
    role: comment.role || 'Engineer',
    phase: comment.phase || 'code',
    createdAt: new Date().toISOString(),
  }
  const updated = [...existing, newComment]
  await upsertArtifacts(db, runId, { comments: updated })
  return newComment
}

// Only the comment's author or an Admin may delete it. Comments from before
// logins existed have no authorId, so only an Admin can remove those.
// Returns { ok: true } or { error: 'not_found' | 'forbidden' }.
export async function deleteComment(db, runId, commentId, { userId, isAdmin = false } = {}) {
  return withTransaction(db, (tx) => deleteCommentLocked(tx, runId, commentId, { userId, isAdmin }))
}

async function deleteCommentLocked(db, runId, commentId, { userId, isAdmin }) {
  const art = await db.query('SELECT comments FROM run_artifacts WHERE run_id = $1 FOR UPDATE', [runId])
  const existing = Array.isArray(art.rows[0]?.comments) ? art.rows[0].comments : []
  const target = existing.find((c) => c.id === commentId)
  if (!target) return { error: 'not_found' }
  const isAuthor = target.authorId != null && userId != null && Number(target.authorId) === Number(userId)
  if (!isAuthor && !isAdmin) return { error: 'forbidden' }
  await upsertArtifacts(db, runId, { comments: existing.filter((c) => c.id !== commentId) })
  return { ok: true }
}

// Store the UI-safe repository context (paths/reasons/languages only).
export async function upsertRepoContext(db, runId, context) {
  const exists = await db.query('SELECT 1 FROM run_repo_context WHERE run_id = $1', [runId])
  if (exists.rows[0]) {
    await db.query('UPDATE run_repo_context SET context = $1 WHERE run_id = $2', [JSON.stringify(context ?? null), runId])
  } else {
    await db.query('INSERT INTO run_repo_context (run_id, context) VALUES ($1, $2)', [runId, JSON.stringify(context ?? null)])
  }
  await touchRun(db, runId)
}

// ── Test runs and Gate 3 evidence (C2, C3, B6, B7) ───────────────────────

const FINGERPRINT = /^[0-9a-f]{64}$/
// The verdicts the sandbox can give (agents/app/sandbox.py verdict()).
const VERDICTS = new Set(['Passed', 'Failed', 'No tests ran', 'Timed out', 'Sandbox unavailable'])
const OUTCOMES = new Set(['passed', 'failed', 'error', 'skipped'])
const MAX_CASES = 2000
const MAX_TEXT = 1000
// What PUT /runs/:id/tests may still set: the sandbox profile, never results.
export const SANDBOX_FIELDS = ['image', 'network', 'memory', 'cpu', 'timeout']

const isCount = (n) => Number.isInteger(n) && n >= 0
const isText = (v) => typeof v === 'string' && v.length <= MAX_TEXT

function validTestRun(f) {
  if (!isPlainObject(f) || typeof f.fingerprint !== 'string' || !FINGERPRINT.test(f.fingerprint)) return false
  if (!VERDICTS.has(f.status)) return false
  if (![f.passed, f.failed, f.total].every(isCount)) return false
  if (f.skipped !== undefined && !isCount(f.skipped)) return false
  for (const k of ['iterations', 'duration_ms']) if (f[k] !== undefined && f[k] !== null && !isCount(f[k])) return false
  if (f.output !== undefined && typeof f.output !== 'string') return false
  for (const k of SANDBOX_FIELDS) if (f[k] !== undefined && !isText(f[k])) return false
  const cases = f.cases ?? []
  if (!Array.isArray(cases) || cases.length > MAX_CASES) return false
  const goodCase = (c) => isPlainObject(c) && isText(c.name) && isText(c.file) && OUTCOMES.has(c.outcome) && typeof c.new === 'boolean'
  if (!cases.every(goodCase)) return false
  const missing = f.missing_existing ?? []
  if (!(Array.isArray(missing) && missing.length <= MAX_CASES && missing.every(isText))) return false
  // The counts must add up, and "Passed" must agree with them: the same rule
  // the sandbox applies (agents/app/sandbox.py verdict()), checked again here
  // because this is where Gate 3's decision is made.
  if (f.total !== f.passed + f.failed) return false
  if (f.status === 'Passed') {
    if (f.failed !== 0 || f.passed === 0 || missing.length) return false
    if (cases.some((c) => c.outcome === 'failed' || c.outcome === 'error')) return false
  }
  return true
}

export async function latestTestRun(db, runId) {
  const res = await db.query('SELECT * FROM test_runs WHERE run_id = $1 ORDER BY seq DESC LIMIT 1', [runId])
  return res.rows[0] ?? null
}

// The one rule for approving Gate 3 (B7), used by the dashboard view and by
// the approve itself: the latest test run must have run on the exact code
// that was handed over for review, and passed.
export function reviewEvidence(fingerprint, latest) {
  let reason = null
  if (!fingerprint) reason = 'no_fingerprint'
  else if (!latest) reason = 'untested'
  else if (latest.fingerprint !== fingerprint) reason = 'code_changed'
  else if (latest.status !== 'Passed') reason = 'tests_not_passed'
  return { fingerprint: fingerprint ?? null, testRunId: latest?.id ?? null, approvable: reason === null, reason }
}

// Store one test run. Only while the run is at Code: once the code is handed
// over for review the evidence is frozen (B6), so nothing can be slipped in
// at Gate 3. Returns { id, seq } or { error: 'bad_test_run' | 'not_found' | 'wrong_step' }.
export async function recordTestRun(db, runId, fields = {}, { agent } = {}) {
  if (!validTestRun(fields)) return { error: 'bad_test_run' }
  return withTransaction(db, async (tx) => {
    const run = (await tx.query('SELECT step FROM runs WHERE run_id = $1 FOR UPDATE', [runId])).rows[0]
    if (!run) return { error: 'not_found' }
    if (run.step !== 'code') return { error: 'wrong_step', step: run.step }
    const seq = (await tx.query('SELECT count(*)::int AS n FROM test_runs WHERE run_id = $1', [runId])).rows[0].n + 1
    const id = randomUUID()
    await tx.query(
      `INSERT INTO test_runs (id, run_id, seq, fingerprint, status, passed, failed, skipped, total, iterations,
                              duration_ms, output, cases, missing_existing, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, runId, seq, fields.fingerprint, fields.status, fields.passed, fields.failed, fields.skipped ?? 0,
        fields.total, fields.iterations ?? null, fields.duration_ms ?? null, fields.output ?? null,
        JSON.stringify(fields.cases ?? []), JSON.stringify(fields.missing_existing ?? []), agent ? `agent:${agent}` : null],
    )
    const profile = Object.fromEntries(SANDBOX_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]]))
    if (Object.keys(profile).length) await upsertTests(tx, runId, profile)
    else await touchRun(tx, runId)
    return { id, seq }
  })
}

// Upsert the run's sandbox profile (manual upsert for pg-mem). Results are
// never stored here; they are test runs (recordTestRun).
export async function upsertTests(db, runId, fields = {}) {
  const cols = ['status', 'image', 'network', 'memory', 'cpu', 'timeout', 'passed', 'failed', 'total', 'iterations', 'duration_ms', 'output']
  const exists = await db.query('SELECT 1 FROM test_results WHERE run_id = $1', [runId])
  if (exists.rows[0]) {
    const sets = []
    const vals = []
    let i = 1
    for (const col of cols) {
      if (fields[col] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(fields[col]) }
    }
    if (!sets.length) return
    vals.push(runId)
    await db.query(`UPDATE test_results SET ${sets.join(', ')} WHERE run_id = $${i}`, vals)
  } else {
    const present = cols.filter((c) => fields[c] !== undefined)
    const names = ['run_id', ...present]
    const placeholders = names.map((_, idx) => `$${idx + 1}`)
    const vals = [runId, ...present.map((c) => fields[c])]
    await db.query(
      `INSERT INTO test_results (${names.join(', ')}) VALUES (${placeholders.join(', ')})`,
      vals,
    )
  }
  await touchRun(db, runId)
}

