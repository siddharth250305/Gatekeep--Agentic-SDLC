import { Router } from 'express'
import { appendEvent, getChain, verifyRun, tamperEvent } from '../audit/service.js'
import { actorName, requireAdmin, requireAgent, requireAny } from '../auth/middleware.js'

// Wrap async handlers so rejections hit Express error handling.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Event names an agent may record: its own work, never a step change.
const AGENT_EVENT = /^(mcp|repo|workspace|sandbox|pipeline)\.[a-z0-9_.-]{1,80}$/

export function auditRouter(db, broadcast = () => {}, { demoMode = false } = {}) {
  const r = Router()
  const touched = (runId) => broadcast({ type: 'run.updated', runId })

  // An agent records work it did (a file written, tests run, a tool refused).
  // The server writes the entry: the actor is the agent token's name and the
  // time is the server clock, so neither can be forged (E2). Step changes
  // (approvals, submissions, cancels) are never written here; the state
  // machine records those itself, so only work events are accepted.
  r.post(
    '/runs/:runId/audit',
    requireAgent,
    wrap(async (req, res) => {
      const { event, payload, ...rest } = req.body || {}
      const extra = Object.keys(rest)
      if (extra.length) return res.status(400).json({ error: `the server sets ${extra.join(', ')}; do not send it` })
      if (typeof event !== 'string' || !AGENT_EVENT.test(event)) {
        return res.status(400).json({ error: 'agents may only record work events (mcp.*, repo.*, workspace.*, sandbox.*, pipeline.*)' })
      }
      const row = await appendEvent(db, {
        runId: req.params.runId,
        event,
        actor: actorName(req.principal),
        payload,
      })
      touched(req.params.runId)
      res.status(201).json(row)
    }),
  )

  // List a run's chain.
  r.get(
    '/runs/:runId/audit',
    requireAny,
    wrap(async (req, res) => {
      res.json(await getChain(db, req.params.runId))
    }),
  )

  // Verify chain integrity. 200 with { valid: true } or { valid: false, brokenAt, ... }.
  r.post(
    '/runs/:runId/audit/verify',
    requireAny,
    wrap(async (req, res) => {
      res.json(await verifyRun(db, req.params.runId))
    }),
  )

  // Everything below is demo-only and is not mounted outside demo mode.
  if (!demoMode) return r

  // DEMO: real DB mutation of a past event's payload (does not fix the hash).
  r.post(
    '/runs/:runId/audit/:seq/tamper',
    requireAdmin,
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
