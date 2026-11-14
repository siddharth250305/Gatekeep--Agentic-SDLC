import { Router } from 'express'
import {
  createRun, listRuns, getRun, recordPhaseMetrics, PhaseStateError, upsertTests, decideGate, cancelRun, robotAction,
  claimStart, releaseStart, writeStepArtifacts, upsertRepoContext, addComment, deleteComment, recordTestRun, SANDBOX_FIELDS,
} from '../runs/service.js'
import { actorName, requireAgent, requireAny, requireHuman } from '../auth/middleware.js'
import { connectionRefused, pipelineHeaders, pipelineUrl } from '../runs/pipeline.js'

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// HTTP status and message for each refusal from the state machine.
const REFUSALS = {
  not_found: [404, () => 'run not found'],
  bad_decision: [400, () => 'decision must be approve or reject'],
  bad_action: [400, () => 'unknown action'],
  bad_details: [400, () => 'details must be a JSON object'],
  bad_artifacts: [400, () => 'artifacts must be an object holding only what this action hands over (requirements | design | files, diff, summary)'],
  target_required: [400, () => 'at Gate 3, reject needs a target: code or design'],
  wrong_role: [403, (o) => `this step is assigned to ${o.gate}`],
  requester: [403, () => 'the person who asked for this work cannot give the final approval'],
  not_allowed: [409, (o) => `that move is not allowed while the run is at '${o.step}'`],
  finished: [409, (o) => `the run is ${o.step === 'done' ? 'finished' : 'cancelled'} and cannot change`],
  stale: [409, (o) => `this gate was already decided; the run is now at '${o.step}'`],
  unknown_step: [409, () => 'the run has no known step, so nothing can move it'],
  bad_actor: [403, () => 'forbidden'],
  wrong_step: [409, (o) => `only the work of the current step can be written (the run is at '${o.step}')`],
  fingerprint_required: [400, () => 'request_review needs the fingerprint (64 hex characters) of the code being handed over'],
  bad_test_run: [400, () => 'a test run needs a fingerprint, a known status, whole-number counts, and well-formed cases'],
  no_fingerprint: [409, () => 'Gate 3 cannot approve: no code fingerprint was handed over with the review request'],
  untested: [409, () => 'Gate 3 cannot approve: no test run was recorded for this code'],
  code_changed: [409, () => 'Gate 3 cannot approve: the code changed after the last test run'],
  tests_not_passed: [409, () => 'Gate 3 cannot approve: the last test run on this code did not pass'],
}

function refuse(res, out) {
  const [status, message] = REFUSALS[out.error] || [409, () => 'refused']
  return res.status(status).json({ error: message(out), reason: out.error, step: out.step })
}

export function runsRouter(db, broadcast = () => {}) {
  const r = Router()
  const touched = (runId) => broadcast({ type: 'run.updated', runId })

  r.get('/runs', requireAny, wrap(async (_req, res) => {
    res.json(await listRuns(db))
  }))

  r.post('/runs', requireHuman, wrap(async (req, res) => {
    const { runId, brief, description, repo, branch, commit } = req.body || {}
    const { id, username } = req.principal.user
    const run = await createRun(db, { runId, brief, description, repo, branch, commit, createdBy: { id, username } })
    touched(run.id)
    res.status(201).json(run)
  }))

  r.get('/runs/:runId', requireAny, wrap(async (req, res) => {
    const run = await getRun(db, req.params.runId)
    if (!run) return res.status(404).json({ error: 'run not found' })
    res.json(run)
  }))

  // There is no PATCH /runs/:runId. A run's step changes only through
  // /decide, /cancel (humans) and /actions/:action (robot), all of which go
  // through the state machine (B1).

  // Kick off the LangGraph pipeline for a run (forwards to the agent service).
  // Safe to repeat: only the first call for a run still at Requirements starts
  // it; later calls get 409. The claim is released only when nothing listens
  // at the pipeline address; any other failure may have happened after the
  // graph began, so releasing it could launch a second graph for the run.
  r.post('/runs/:runId/start', requireHuman, wrap(async (req, res) => {
    const { runId } = req.params
    const claim = await claimStart(db, runId)
    if (claim.error === 'not_found') return res.status(404).json({ error: 'run not found' })
    if (claim.error) {
      const why = claim.error === 'started' ? 'this run was already started' : `only a run at Requirements can be started (it is at '${claim.step}')`
      return res.status(409).json({ error: why, reason: claim.error, step: claim.step })
    }
    const run = await getRun(db, runId)
    let resp
    try {
      resp = await fetch(`${pipelineUrl()}/pipeline/${encodeURIComponent(runId)}/start`, {
        method: 'POST', headers: pipelineHeaders(),
        body: JSON.stringify({ brief: run.brief, repo: run.repo, branch: run.branch }),
      })
    } catch (err) {
      if (connectionRefused(err)) {
        await releaseStart(db, runId)
        return res.status(502).json({ error: 'the agent pipeline is not running; start it and try again' })
      }
      resp = null
    }
    if (!resp?.ok) {
      return res.status(502).json({ error: 'pipeline start failed part-way; cancel the run if it does not move' })
    }
    touched(runId)
    res.json(await getRun(db, runId))
  }))

  // Runs with a decision in flight in this process. The state machine already
  // serializes decisions with a row lock; this also stops a second click from
  // waiting behind a slow pipeline resume and then being forwarded too.
  const deciding = new Set()

  async function oneAtATime(runId, res, fn) {
    if (deciding.has(runId)) return res.status(409).json({ error: 'a decision for this run is already in progress' })
    deciding.add(runId)
    try {
      await fn()
    } finally {
      deciding.delete(runId)
    }
  }

  // Tell the agent pipeline (if it is running this run) what the human
  // decided, so its paused graph continues. The backend has already recorded
  // the move, so this never changes state: a pipeline that is not running, or
  // does not know the run (MCP mode), is fine; any other failure is reported
  // back as a warning next to the recorded decision.
  async function resumePipeline(runId, body) {
    let resp
    try {
      resp = await fetch(`${pipelineUrl()}/pipeline/${encodeURIComponent(runId)}/resume`, {
        method: 'POST', headers: pipelineHeaders(), body: JSON.stringify(body),
      })
    } catch (err) {
      return connectionRefused(err) ? { resumed: false, reason: 'not_running' } : { resumed: false, reason: 'unreachable' }
    }
    if (resp.ok) return { resumed: true }
    const out = await resp.json().catch(() => ({}))
    if (resp.status === 409 && out.reason === 'not_running') return { resumed: false, reason: 'not_running' }
    return { resumed: false, reason: out.reason || `status_${resp.status}` }
  }

  // Human gate decision: approve / reject the run's current gate.
  // Body: { decision: 'approve'|'reject', target?: 'code'|'design' (Gate 3
  // rejects), gate?: the step the reviewer was looking at, feedback? }.
  // Who decides is taken from the login, never from the request body.
  r.post('/runs/:runId/decide', requireHuman, wrap(async (req, res) => {
    const { runId } = req.params
    const { decision, target, gate, feedback } = req.body || {}
    if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: 'decision must be approve or reject' })
    if (gate !== undefined && gate !== null && typeof gate !== 'string') return res.status(400).json({ error: 'gate must be a step name' })
    await oneAtATime(runId, res, async () => {
      const { user } = req.principal
      const out = await decideGate(db, runId, {
        decision, target, feedback, user, expectedStep: typeof gate === 'string' && gate ? gate : undefined,
      })
      if (out.error) return refuse(res, out)
      touched(runId)
      const pipeline = await resumePipeline(runId, {
        decision, target: out.to, feedback: typeof feedback === 'string' ? feedback : '', actor: actorName(req.principal), gate: out.from,
      })
      // Without a pipeline (MCP mode) not_running is normal. For a run the
      // pipeline started, it means nobody will do the next step: say so.
      const quiet = pipeline.resumed || (pipeline.reason === 'not_running' && !out.run.started)
      res.json(quiet ? out.run : { ...out.run, pipeline })
    })
  }))

  // Cancel a run from any active step (Planner, Engineer or Admin). Final.
  r.post('/runs/:runId/cancel', requireHuman, wrap(async (req, res) => {
    const { runId } = req.params
    const { reason } = req.body || {}
    await oneAtATime(runId, res, async () => {
      const out = await cancelRun(db, runId, { user: req.principal.user, feedback: reason })
      if (out.error) return refuse(res, out)
      touched(runId)
      await resumePipeline(runId, { decision: 'cancel', target: 'cancelled', feedback: '', actor: actorName(req.principal), gate: out.from })
      res.json(out.run)
    })
  }))

  // A robot finished its step and hands it over: submit_requirements,
  // submit_design or request_review. The state machine decides whether that
  // move is allowed from where the run is. Repeating one returns 200 unchanged.
  r.post('/runs/:runId/actions/:action', requireAgent, wrap(async (req, res) => {
    const { runId, action } = req.params
    const { details, artifacts, fingerprint } = req.body || {}
    const out = await robotAction(db, runId, action, { agent: req.principal.name, details, artifacts, fingerprint })
    if (out.error) return refuse(res, out)
    if (!out.unchanged) touched(runId)
    res.json(out.run)
  }))

  // Metrics only (cost, tokens, model, duration). Phase state, status and
  // time can only change through the state machine (B1).
  r.put('/runs/:runId/phases/:key', requireAgent, wrap(async (req, res) => {
    let row
    try {
      row = await recordPhaseMetrics(db, req.params.runId, req.params.key, req.body || {})
    } catch (err) {
      if (err instanceof PhaseStateError) return res.status(403).json({ error: err.message })
      throw err
    }
    if (!row) return res.status(404).json({ error: 'phase not found or no fields' })
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  // The sandbox profile only (image, limits). Results are test runs: they
  // carry the code fingerprint Gate 3 checks, so they cannot be set here (C2, B7).
  r.put('/runs/:runId/tests', requireAgent, wrap(async (req, res) => {
    const body = req.body || {}
    const other = Object.keys(body).filter((k) => !SANDBOX_FIELDS.includes(k))
    if (other.length) {
      return res.status(403).json({ error: `${other.join(', ')} can only be recorded as a test run (POST /runs/:runId/test-runs)` })
    }
    await upsertTests(db, req.params.runId, body)
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  // One test run: results, each test, and the fingerprint of the code it ran
  // on. Only while the run is at Code.
  r.post('/runs/:runId/test-runs', requireAgent, wrap(async (req, res) => {
    const out = await recordTestRun(db, req.params.runId, req.body || {}, { agent: req.principal.name })
    if (out.error) return refuse(res, out)
    touched(req.params.runId)
    res.status(201).json(out)
  }))

  // Comments are reviewer-only (POST /comments), so an agent cannot add, edit
  // or remove them through the artifacts payload.
  r.put('/runs/:runId/artifacts', requireAgent, wrap(async (req, res) => {
    const { comments, ...artifacts } = req.body || {}
    if (comments !== undefined) return res.status(403).json({ error: 'comments can only be written by a logged-in reviewer' })
    const out = await writeStepArtifacts(db, req.params.runId, artifacts)
    if (out.error) return refuse(res, out)
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  r.post('/runs/:runId/comments', requireHuman, wrap(async (req, res) => {
    const { user } = req.principal
    const comment = await addComment(db, req.params.runId, { ...(req.body || {}), author: user.name, authorId: user.id, role: user.role })
    touched(req.params.runId)
    res.status(201).json(comment)
  }))

  r.delete('/runs/:runId/comments/:commentId', requireHuman, wrap(async (req, res) => {
    const { user } = req.principal
    const out = await deleteComment(db, req.params.runId, req.params.commentId, { userId: user.id, isAdmin: user.role === 'Admin' })
    if (out.error === 'not_found') return res.status(404).json({ error: 'comment not found' })
    if (out.error === 'forbidden') return res.status(403).json({ error: 'only the author or an Admin can delete this comment' })
    touched(req.params.runId)
    res.json({ ok: true })
  }))

  // UI-safe repository context (paths/reasons only).
  r.put('/runs/:runId/context', requireAgent, wrap(async (req, res) => {
    await upsertRepoContext(db, req.params.runId, req.body || {})
    touched(req.params.runId)
    res.json({ ok: true })
  }))

  // Transient event: broadcast only, not persisted (e.g. repo.context.scanning).
  r.post('/runs/:runId/event', requireAgent, wrap(async (req, res) => {
    const { type, data } = req.body || {}
    // type and runId are set last so the payload cannot overwrite them.
    if (typeof type === 'string' && type) broadcast({ ...(data || {}), type, runId: req.params.runId })
    res.json({ ok: true })
  }))

  return r
}
