import { Router } from 'express'
import { appendEvent, getChain, verifyRun, tamperEvent } from '../audit/service.js'

// Wrap async handlers so rejections hit Express error handling.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export function auditRouter(db, broadcast = () => {}) {
  const r = Router()
  const touched = (runId) => broadcast({ type: 'run.updated', runId })

  // Append an event to a run's audit chain.
  r.post(
    '/runs/:runId/audit',
    wrap(async (req, res) => {
      const { event, actor, payload, createdAt } = req.body || {}
      const row = await appendEvent(db, {
        runId: req.params.runId,
        event,
        actor,
        payload,
        createdAt,
      })
      touched(req.params.runId)
      res.status(201).json(row)
    }),
  )

  // List a run's chain.
  r.get(
    '/runs/:runId/audit',
    wrap(async (req, res) => {
      res.json(await getChain(db, req.params.runId))
    }),
  )

  // Verify chain integrity. 200 with { valid: true } or { valid: false, brokenAt, ... }.
  r.post(
    '/runs/:runId/audit/verify',
    wrap(async (req, res) => {
      res.json(await verifyRun(db, req.params.runId))
    }),
  )

  // DEMO: real DB mutation of a past event's payload (does not fix the hash).
  r.post(
    '/runs/:runId/audit/:seq/tamper',
    wrap(async (req, res) => {
      const row = await tamperEvent(
        db,
        req.params.runId,
        req.params.seq,
        req.body?.payload,
      )
      if (!row) return res.status(404).json({ error: 'event not found' })
      touched(req.params.runId)
      res.json(row)
    }),
  )

  return r
}
