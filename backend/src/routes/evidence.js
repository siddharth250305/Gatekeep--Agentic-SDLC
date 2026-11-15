import { Router } from 'express'
import { appendEvent, getChain } from '../audit/service.js'
import { requireAny, requireHuman } from '../auth/middleware.js'
import { buildBundle, keyId, prBranch, prMarkdown, prTitle, publicKeyPem } from '../evidence/bundle.js'
import { connectionRefused, pipelineHeaders, pipelineUrl } from '../runs/pipeline.js'

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function refuseBundle(res, out) {
  if (out.error === 'not_found') return res.status(404).json({ error: 'run not found', reason: 'not_found' })
  return res.status(409).json({ error: `only a finished run has evidence (the run is at '${out.step}')`, reason: 'not_finished', step: out.step })
}

// Evidence export and the Pull Request (I6).
export function evidenceRouter(db, broadcast = () => {}) {
  const r = Router()
  const creating = new Set()

  // Public on purpose: anyone checking a bundle needs the key, and it gives
  // nothing away.
  r.get('/evidence/public-key', (_req, res) => {
    const publicKey = publicKeyPem()
    res.json({ alg: 'Ed25519', keyId: keyId(publicKey), publicKey })
  })

  r.get('/runs/:runId/evidence', requireAny, wrap(async (req, res) => {
    const out = await buildBundle(db, req.params.runId)
    if (out.error) return refuseBundle(res, out)
    res.json(out.bundle)
  }))

  r.get('/runs/:runId/pr', requireAny, wrap(async (req, res) => {
    const out = await buildBundle(db, req.params.runId)
    if (out.error) return refuseBundle(res, out)
    res.json({ title: prTitle(out.bundle), branch: prBranch(req.params.runId), body: prMarkdown(out.bundle) })
  }))

  // A person asks for the PR. The agent service (which holds the workspace
  // and the GitHub token) pushes the approved code with the evidence file and
  // opens the PR; it refuses if the code is no longer the approved code. The
  // PR is recorded in the audit chain, once.
  r.post('/runs/:runId/pull-request', requireHuman, wrap(async (req, res) => {
    const { runId } = req.params
    // The PR is opened with the service's GitHub token: the code reviewers only.
    if (!['Engineer', 'Admin'].includes(req.principal.user.role)) {
      return res.status(403).json({ error: 'only an Engineer or Admin can open the pull request', reason: 'wrong_role' })
    }
    if (creating.has(runId)) return res.status(409).json({ error: 'a pull request for this run is already being created', reason: 'in_progress' })
    creating.add(runId)
    try {
      const made = (await getChain(db, runId)).find((e) => e.event === 'run.pr_created')
      if (made) return res.status(409).json({ error: 'a pull request was already created for this run', reason: 'pr_exists', url: made.payload.url })
      const out = await buildBundle(db, runId)
      if (out.error) return refuseBundle(res, out)
      const { bundle } = out
      let resp
      try {
        resp = await fetch(`${pipelineUrl()}/pipeline/${encodeURIComponent(runId)}/pull-request`, {
          method: 'POST', headers: pipelineHeaders(), signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({ title: prTitle(bundle), body: prMarkdown(bundle), evidence: bundle, repo: bundle.run.repo, base: bundle.run.branch }),
        })
      } catch (err) {
        const why = connectionRefused(err) ? 'the agent service is not running; start it and try again' : 'the agent service could not be reached'
        return res.status(502).json({ error: why, reason: 'agent_unreachable' })
      }
      const answer = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        const status = resp.status === 400 || resp.status === 409 ? resp.status : 502
        return res.status(status).json({ error: answer.error || `the agent service answered ${resp.status}`, reason: answer.reason || 'agent_refused' })
      }
      if (typeof answer.url !== 'string' || !/^https:\/\//.test(answer.url)) {
        return res.status(502).json({ error: 'the agent service did not return a pull request link', reason: 'agent_refused' })
      }
      const pr = { url: answer.url, number: Number(answer.number) || null, branch: answer.branch ?? prBranch(runId) }
      await appendEvent(db, { runId, event: 'run.pr_created', actor: req.principal.user.username, payload: { ...pr, fingerprint: bundle.code.fingerprint } })
      broadcast({ type: 'run.updated', runId })
      res.status(201).json(pr)
    } finally {
      creating.delete(runId)
    }
  }))

  return r
}
