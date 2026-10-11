import { Router } from 'express'
import {
  createRun, listRuns, getRun, updateRun, upsertPhase, upsertTests, decideGate, upsertArtifacts, upsertRepoContext, addComment, deleteComment,
} from '../runs/service.js'

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export function runsRouter(db, broadcast = () => {}) {
  const r = Router()
  const touched = (runId) => broadcast({ type: 'run.updated', runId })

  r.get('/runs', wrap(async (_req, res) => {
    res.json(await listRuns(db))
  }))

  r.post('/runs', wrap(async (req, res) => {
    const run = await createRun(db, req.body || {})
    touched(run.id)
    res.status(201).json(run)
  }))

  r.get('/runs/:runId', wrap(async (req, res) => {
    const run = await getRun(db, req.params.runId)
    if (!run) return res.status(404).json({ error: 'run not found' })
    res.json(run)
  }))

  r.patch('/runs/:runId', wrap(async (req, res) => {
    const run = await updateRun(db, req.params.runId, req.body || {})
    if (!run) return res.status(404).json({ error: 'run not found' })
    touched(run.id)
    res.json(run)
  }))

  // Kick off the LangGraph pipeline for a run (forwards to the agent service).
  r.post('/runs/:runId/start', wrap(async (req, res) => {
    const pipelineUrl = process.env.PIPELINE_URL || 'http://localhost:8077'
    const run = await getRun(db, req.params.runId)
    if (!run) return res.status(404).json({ error: 'run not found' })
    const resp = await fetch(`${pipelineUrl}/pipeline/${req.params.runId}/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: run.brief, repo: run.repo, branch: run.branch }),
    })
    if (!resp.ok) return res.status(502).json({ error: 'pipeline start failed' })
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  // Human gate decision: approve / reject the run's active gate.
  // When PIPELINE_URL is set, forward to the agent service so the decision
  // resumes the real LangGraph graph (the agent performs the state mutations
  // via its reporter). Falls back to local handling otherwise.
  r.post('/runs/:runId/decide', wrap(async (req, res) => {
    const { decision, actor, role, feedback } = req.body || {}
    if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: 'decision must be approve or reject' })

    const pipelineUrl = process.env.PIPELINE_URL || 'http://localhost:8077'
    if (pipelineUrl) {
      const run = await getRun(db, req.params.runId)
      if (!run) return res.status(404).json({ error: 'run not found' })
      if (run.gate && role && role !== run.gate) return res.status(403).json({ error: `gate is assigned to ${run.gate}` })
      try {
        const resp = await fetch(`${pipelineUrl}/pipeline/${req.params.runId}/resume`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision, feedback: feedback || '' }),
        })
        if (resp.ok) {
          touched(req.params.runId)
          return res.json(await getRun(db, req.params.runId))
        }
        // non-ok (e.g. graph does not know this run) -> local fallback below
      } catch {
        // pipeline unreachable -> local fallback below
      }
    }

    const out = await decideGate(db, req.params.runId, { decision, actor, role, feedback })
    if (out.error === 'not_found') return res.status(404).json({ error: 'run not found' })
    if (out.error === 'bad_decision') return res.status(400).json({ error: 'decision must be approve or reject' })
    if (out.error === 'wrong_role') return res.status(403).json({ error: `gate is assigned to ${out.gate}` })
    if (out.error === 'no_active_gate') return res.status(409).json({ error: 'no active gate to decide' })
    touched(req.params.runId)
    res.json(out.run)
  }))

  r.put('/runs/:runId/phases/:key', wrap(async (req, res) => {
    const row = await upsertPhase(db, req.params.runId, req.params.key, req.body || {})
    if (!row) return res.status(404).json({ error: 'phase not found or no fields' })
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  r.put('/runs/:runId/tests', wrap(async (req, res) => {
    await upsertTests(db, req.params.runId, req.body || {})
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  r.put('/runs/:runId/artifacts', wrap(async (req, res) => {
    await upsertArtifacts(db, req.params.runId, req.body || {})
    touched(req.params.runId)
    res.json(await getRun(db, req.params.runId))
  }))

  r.post('/runs/:runId/comments', wrap(async (req, res) => {
    const comment = await addComment(db, req.params.runId, req.body || {})
    touched(req.params.runId)
    res.status(201).json(comment)
  }))

  r.delete('/runs/:runId/comments/:commentId', wrap(async (req, res) => {
    await deleteComment(db, req.params.runId, req.params.commentId)
    touched(req.params.runId)
    res.json({ ok: true })
  }))

  // UI-safe repository context (paths/reasons only).
  r.put('/runs/:runId/context', wrap(async (req, res) => {
    await upsertRepoContext(db, req.params.runId, req.body || {})
    touched(req.params.runId)
    res.json({ ok: true })
  }))

  // Transient event: broadcast only, not persisted (e.g. repo.context.scanning).
  r.post('/runs/:runId/event', wrap(async (req, res) => {
    const { type, data } = req.body || {}
    if (type) broadcast({ type, runId: req.params.runId, ...(data || {}) })
    res.json({ ok: true })
  }))

  return r
}
