// Run state: runs, pipeline phases (with cost/token metrics), and test results.
// Assembles the full run view the frontend consumes, including the audit chain
// and its verification result from the audit layer.

import { appendEvent, getChain, verifyRun } from '../audit/service.js'

export const DEFAULT_PHASES = [
  { key: 'req', label: 'Requirements', role: 'Agent' },
  { key: 'g1', label: 'Gate 1', role: 'Planner' },
  { key: 'design', label: 'Design', role: 'Agent' },
  { key: 'g2', label: 'Gate 2', role: 'Engineer' },
  { key: 'code', label: 'Code & Tests', role: 'Agent' },
  { key: 'out', label: 'Output', role: 'Branch' },
]

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

export async function createRun(db, { runId, brief, description = '', repo = '', branch = '', commit = '' } = {}) {
  if (!brief) throw new Error('brief is required')
  let id = runId
  if (!id) {
    const c = await db.query('SELECT count(*)::int AS n FROM runs')
    id = `RUN-${1000 + c.rows[0].n}`
  }
  await db.query(
    `INSERT INTO runs (run_id, brief, description, repo, branch, commit)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, brief, description, repo, branch, commit],
  )
  for (let i = 0; i < DEFAULT_PHASES.length; i++) {
    const p = DEFAULT_PHASES[i]
    await db.query(
      `INSERT INTO run_phases (run_id, seq, key, label, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, i + 1, p.key, p.label, p.role],
    )
  }
  return getRun(db, id)
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
  const sandbox = tr
    ? { status: tr.status, image: tr.image, network: tr.network, memory: tr.memory, cpu: tr.cpu, timeout: tr.timeout }
    : null
  const tests =
    tr && tr.total != null
      ? { passed: tr.passed, failed: tr.failed, total: tr.total, iterations: tr.iterations, duration: fmtDuration(tr.duration_ms), output: tr.output ?? null }
      : null

  const artRes = await db.query('SELECT files, diff, summary, requirements, design, comments FROM run_artifacts WHERE run_id = $1', [runId])
  const art = artRes.rows[0]

  const ctxRes = await db.query('SELECT context FROM run_repo_context WHERE run_id = $1', [runId])
  const repoContext = ctxRes.rows[0]?.context ?? null

  const chain = await getChain(db, runId)
  const verify = await verifyRun(db, runId)

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
    status: run.status,
    gate: run.gate,
    awaiting: run.status === 'awaiting_gate',
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

export async function updateRun(db, runId, { status, gate, branch, commit } = {}) {
  const sets = []
  const vals = []
  let i = 1
  if (status !== undefined) { sets.push(`status = $${i++}`); vals.push(status) }
  if (gate !== undefined) { sets.push(`gate = $${i++}`); vals.push(gate) }
  if (branch !== undefined) { sets.push(`branch = $${i++}`); vals.push(branch) }
  if (commit !== undefined) { sets.push(`commit = $${i++}`); vals.push(commit) }
  if (!sets.length) return getRun(db, runId)
  sets.push('updated_at = now()')
  vals.push(runId)
  const res = await db.query(
    `UPDATE runs SET ${sets.join(', ')} WHERE run_id = $${i} RETURNING run_id`,
    vals,
  )
  if (!res.rows[0]) return null
  return getRun(db, runId)
}

// Update a pre-seeded phase (state/status/timestamp + metering).
export async function upsertPhase(db, runId, key, fields = {}) {
  const allowed = ['state', 'status', 'at', 'cost_usd', 'input_tokens', 'output_tokens', 'model', 'duration_ms']
  const sets = []
  const vals = []
  let i = 1
  for (const col of allowed) {
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

const GATE_ROLES = new Set(['Planner', 'Engineer'])

// Human gate decision: approve/reject the run's currently active phase.
// Appends a REAL audit event and advances pipeline state. (In Layer 4 this same
// endpoint will also resume the paused LangGraph via interrupt().)
// Returns { run } on success or { error, ... } for the route to map to a status.
export async function decideGate(db, runId, { decision, actor, role, feedback } = {}) {
  if (decision !== 'approve' && decision !== 'reject') return { error: 'bad_decision' }

  const runRes = await db.query('SELECT * FROM runs WHERE run_id = $1', [runId])
  const run = runRes.rows[0]
  if (!run) return { error: 'not_found' }
  if (run.gate && role && role !== run.gate) return { error: 'wrong_role', gate: run.gate }

  const phaseRes = await db.query(
    'SELECT * FROM run_phases WHERE run_id = $1 ORDER BY seq ASC',
    [runId],
  )
  const phases = phaseRes.rows
  const active = phases.find((p) => p.state === 'active')
  if (!active) return { error: 'no_active_gate' }

  const at = nowLabel()
  const by = actor || role || 'reviewer'

  if (decision === 'approve') {
    await upsertPhase(db, runId, active.key, { state: 'approved', status: 'Approved', at })
    await appendEvent(db, {
      runId, event: `${active.key}.approved`, actor: by,
      payload: feedback ? { feedback } : {},
    })
    const next = phases.find((p) => p.seq > active.seq && p.state === 'pending' && p.key !== 'out')
    if (next) {
      const isGate = GATE_ROLES.has(next.role)
      await upsertPhase(db, runId, next.key, {
        state: 'active', status: isGate ? 'Ready for review' : 'In progress',
      })
      await updateRun(db, runId, { status: isGate ? 'awaiting_gate' : 'running', gate: next.role })
    } else {
      const out = phases.find((p) => p.key === 'out')
      if (out && out.state === 'pending') {
        await upsertPhase(db, runId, 'out', { state: 'approved', status: 'Complete', at })
      }
      await updateRun(db, runId, { status: 'approved', gate: null })
    }
  } else {
    await upsertPhase(db, runId, active.key, { state: 'rejected', status: 'Rejected', at })
    await appendEvent(db, {
      runId, event: `${active.key}.rejected`, actor: by,
      payload: feedback ? { feedback } : {},
    })
    await updateRun(db, runId, { status: 'rejected', gate: null })
  }

  return { run: await getRun(db, runId) }
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

export async function addComment(db, runId, comment) {
  const art = await db.query('SELECT comments FROM run_artifacts WHERE run_id = $1', [runId])
  const existing = Array.isArray(art.rows[0]?.comments) ? art.rows[0].comments : []
  const newComment = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    file: comment.file || '',
    line: comment.line ?? null,
    text: comment.text || '',
    author: comment.author || 'Reviewer',
    role: comment.role || 'Engineer',
    phase: comment.phase || 'code',
    createdAt: new Date().toISOString(),
  }
  const updated = [...existing, newComment]
  await upsertArtifacts(db, runId, { comments: updated })
  return newComment
}

export async function deleteComment(db, runId, commentId) {
  const art = await db.query('SELECT comments FROM run_artifacts WHERE run_id = $1', [runId])
  const existing = Array.isArray(art.rows[0]?.comments) ? art.rows[0].comments : []
  const updated = existing.filter((c) => c.id !== commentId)
  await upsertArtifacts(db, runId, { comments: updated })
  return true
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

// Upsert the run's latest sandbox + test result (manual upsert for pg-mem).
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
