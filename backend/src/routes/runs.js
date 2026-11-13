import { Router } from 'express'
import {
  createRun, listRuns, getRun, updateRun, upsertPhase, upsertTests, decideGate, upsertArtifacts, upsertRepoContext, addComment, deleteComment,
} from '../runs/service.js'
import { actorName, requireAgent, requireAny, requireHuman } from '../auth/middleware.js'

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Calls from the backend to the agent pipeline carry a shared secret, so only
// the backend (after checking the reviewer's login) can resume a paused gate.
function pipelineHeaders() {
  return {
    'content-type': 'application/json',
    'x-gatekeep-pipeline-secret': process.env.GATEKEEP_PIPELINE_SECRET || '',
  }
}

// True when fetch failed because nothing listens at the pipeline address, the
// one failure where the decision certainly never reached the graph. (With
// localhost resolving to IPv4 and IPv6, Node reports one error per address.)
function connectionRefused(err) {
  const cause = err?.cause
  if (cause?.code === 'ECONNREFUSED') return true
  return Array.isArray(cause?.errors) && cause.errors.length > 0
    && cause.errors.every((e) => e.code === 'ECONNREFUSED')
}

export function runsRouter(db, broadcast = () => {}) {
  const r = Router()
  const touched = (runId) => broadcast({ type: 'run.updated', runId })

  r.get('/runs', requireAny, wrap(async (_req, res) => {
    res.json(await listRuns(db))
  }))

  r.post('/runs', requireHuman, wrap(async (req, res) => {
    const run = await createRun(db, req.body || {})
    touched(run.id)
    res.status(201).json(run)
  }))

  r.get('/runs/:runId', requireAny, wrap(async (req, res) => {
    const run = await getRun(db, req.params.runId)
    if (!run) return res.status(404).json({ error: 'run not found' })
    res.json(run)
  }))

  r.patch('/runs/:runId', requireAgent, wrap(async (req, res) => {
    const run = await updateRun(db, req.params.runId, req.body || {})
    if (!run) return res.status(404).json({ error: 'run not found' })
    touched(run.id)
    res.json(run)
  }))

  // Kick off the LangGraph pipeline for a run (forwards to the agent service).
  r.post('/runs/:runId/start', requireHuman, wrap(async (req, res) => {
    const pipelineUrl = process.env.PIPELINE_URL || 'http://localhost:8077'
    const run = await getRun(db, req.params.runId)
    if (!run) return res.status(404).json({ error: 'run not found' })
    const resp = await fetch(`${pipelineUrl}/pipeline/${encodeURIComponent(req.params.runId)}/start`, {
      method: 'POST', headers: pipelineHeaders(),
      body: JSON.stringify({ brief: run.brief, repo: run.repo, branch: run.branch }),
    })
    if (!resp.ok) return res.status(502).json({ error: 'pipeline start failed' })
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  // Runs with a decision in flight. Resuming the pipeline can take minutes (the
  // next agent phase runs before it answers), so a second Approve arriving
  // meanwhile is refused instead of being forwarded too.
  const deciding = new Set()

  // Human gate decision: approve / reject the run's active gate.
  // Who decides is taken from the login, never from the request body.
  // When PIPELINE_URL is set, forward to the agent service so the decision
  // resumes the real LangGraph graph (the agent performs the state mutations
  // via its reporter). Falls back to local handling only when the pipeline is
  // not running or does not know the run, never after a failure that could
  // have happened halfway through a resume.
  r.post('/runs/:runId/decide', requireHuman, wrap(async (req, res) => {
    const { runId } = req.params
    const { decision, feedback } = req.body || {}
    if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: 'decision must be approve or reject' })
    if (deciding.has(runId)) return res.status(409).json({ error: 'a decision for this run is already in progress' })
    deciding.add(runId)
    try {
      await decide(req, res, { decision, feedback })
    } finally {
      deciding.delete(runId)
    }
  }))

  async function decide(req, res, { decision, feedback }) {
    const { runId } = req.params
    const actor = actorName(req.principal)
    const { role } = req.principal.user

    const pipelineUrl = process.env.PIPELINE_URL || 'http://localhost:8077'
    if (pipelineUrl) {
      const run = await getRun(db, runId)
      if (!run) return res.status(404).json({ error: 'run not found' })
      if (!run.awaiting || !run.gate) return res.status(409).json({ error: 'no active gate to decide' })
      if (role !== 'Admin' && role !== run.gate) return res.status(403).json({ error: `gate is assigned to ${run.gate}` })
      // The gate this decision is for. The pipeline refuses it if the run has
      // already moved past that gate, so a late Approve cannot land on the next one.
      const gate = run.steps.find((s) => s.state === 'active')?.key
      let resp
      try {
        resp = await fetch(`${pipelineUrl}/pipeline/${encodeURIComponent(runId)}/resume`, {
          method: 'POST', headers: pipelineHeaders(),
          body: JSON.stringify({ decision, feedback: feedback || '', actor, gate }),
        })
      } catch (err) {
        if (!connectionRefused(err)) return res.status(502).json({ error: 'pipeline resume failed' })
        // nothing listening -> local fallback below
      }
      if (resp?.ok) {
        touched(runId)
        return res.json(await getRun(db, runId))
      }
      if (resp) {
        const body = await resp.json().catch(() => ({}))
        if (resp.status === 409 && body.reason === 'stale_gate') {
          return res.status(409).json({ error: 'this gate was already decided' })
        }
        if (!(resp.status === 409 && body.reason === 'not_running')) {
          return res.status(502).json({ error: `pipeline resume failed (${resp.status})` })
        }
        // the pipeline does not know this run -> local fallback below
      }
    }

    const out = await decideGate(db, runId, { decision, actor, role, feedback })
    if (out.error === 'not_found') return res.status(404).json({ error: 'run not found' })
    if (out.error === 'bad_decision') return res.status(400).json({ error: 'decision must be approve or reject' })
    if (out.error === 'wrong_role') return res.status(403).json({ error: `gate is assigned to ${out.gate}` })
    if (out.error === 'no_active_gate') return res.status(409).json({ error: 'no active gate to decide' })
    touched(runId)
    res.json(out.run)
  }

  r.put('/runs/:runId/phases/:key', requireAgent, wrap(async (req, res) => {
    const row = await upsertPhase(db, req.params.runId, req.params.key, req.body || {})
    if (!row) return res.status(404).json({ error: 'phase not found or no fields' })
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  r.put('/runs/:runId/tests', requireAgent, wrap(async (req, res) => {
    await upsertTests(db, req.params.runId, req.body || {})
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  // Comments are reviewer-only (POST /comments), so an agent cannot add, edit
  // or remove them through the artifacts payload.
  r.put('/runs/:runId/artifacts', requireAgent, wrap(async (req, res) => {
    const { comments, ...artifacts } = req.body || {}
    if (comments !== undefined) return res.status(403).json({ error: 'comments can only be written by a logged-in reviewer' })
    await upsertArtifacts(db, req.params.runId, artifacts)
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
