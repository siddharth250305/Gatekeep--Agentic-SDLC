// Talking to the agent pipeline (pipeline mode). The pipeline keeps no run
// state (ADR 0001, G9): each call only wakes it, and it reads the run back
// from this backend to see which step to do. So after a restart of either
// service nothing is lost; recoverPipelineRuns() wakes it for every run it
// started that is waiting at a robot step.

// Calls from the backend to the agent pipeline carry a shared secret, so only
// the backend (after checking the reviewer's login) can wake or resume it.
export function pipelineHeaders() {
  return {
    'content-type': 'application/json',
    'x-gatekeep-pipeline-secret': process.env.GATEKEEP_PIPELINE_SECRET || '',
  }
}

export const pipelineUrl = () => process.env.PIPELINE_URL || 'http://localhost:8077'

// True when fetch failed because nothing listens at the pipeline address, the
// one failure where the call certainly never reached the pipeline. (With
// localhost resolving to IPv4 and IPv6, Node reports one error per address.)
export function connectionRefused(err) {
  const cause = err?.cause
  if (cause?.code === 'ECONNREFUSED') return true
  return Array.isArray(cause?.errors) && cause.errors.length > 0
    && cause.errors.every((e) => e.code === 'ECONNREFUSED')
}

// Wake the pipeline for every run it started that is at a robot step (req,
// design, code): sitting there without the pipeline, it would wait forever.
// Returns { woken, failed } (run ids). Never throws: a pipeline that is not
// running picks the runs up itself when it starts. Each wake-up gives up after
// timeoutMs, so a pipeline that hangs cannot stall the loop.
export async function recoverPipelineRuns(db, { timeoutMs = 5000 } = {}) {
  const { rows } = await db.query(
    `SELECT run_id FROM runs WHERE started_at IS NOT NULL AND step IN ('req', 'design', 'code') ORDER BY created_at`,
  )
  const woken = []
  const failed = []
  for (const { run_id: runId } of rows) {
    try {
      const resp = await fetch(`${pipelineUrl()}/pipeline/${encodeURIComponent(runId)}/work`, {
        method: 'POST', headers: pipelineHeaders(), body: '{}', signal: AbortSignal.timeout(timeoutMs),
      })
      ;(resp.ok ? woken : failed).push(runId)
    } catch {
      failed.push(runId)
    }
  }
  return { woken, failed }
}
