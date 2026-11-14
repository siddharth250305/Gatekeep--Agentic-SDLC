// What the reviewer must know about a run's checkpoint: which gate it is at,
// who must act, and whether this user may act (F4). These mirror the server's
// rules (backend/src/runs/machine.js) so the dashboard only offers what the
// server will accept; the server still decides every action.

export const GATES = {
  g1: { num: 1, name: 'Requirements review', role: 'Planner', phases: ['requirements', 'req'], review: { tab: 'specs', section: 'requirements', label: 'Open the requirements' } },
  g2: { num: 2, name: 'Design review', role: 'Engineer', phases: ['design'], review: { tab: 'specs', section: 'design', label: 'Open the design' } },
  g3: { num: 3, name: 'Code review', role: 'Engineer', phases: ['code'], review: { tab: 'code', section: null, label: 'Open the code changes' } },
}

const AGENT_STEPS = { req: 'Requirements', design: 'Design', code: 'Code & Tests' }

// Where "Request changes" sends the work from each gate (B4). Gate 3 lets the
// reviewer choose; the first entry is the default.
export const REWORK_TARGETS = {
  g1: [{ value: undefined, label: 'Requirements', hint: 'The agent rewrites the requirements and asks for Gate 1 again.' }],
  g2: [{ value: undefined, label: 'Design', hint: 'The agent redoes the design and asks for Gate 2 again.' }],
  g3: [
    { value: 'code', label: 'Code', hint: 'Fix the implementation; the approved design stands.' },
    { value: 'design', label: 'Design', hint: 'The approach is wrong; redo the design and pass Gate 2 again.' },
  ],
}

// Why Gate 3 cannot be approved right now, or null when it can (B7). The
// server sends the evidence as run.review; missing evidence never approves.
const REVIEW_BLOCKS = {
  no_fingerprint: 'No code fingerprint was handed over with the review request',
  untested: 'No test run was recorded for this code',
  code_changed: 'The code changed after the last test run',
  tests_not_passed: 'The last test run on this code did not pass',
}

export function approvalBlockReason(run) {
  if (run?.step !== 'g3') return null
  if (run.review?.approvable === true) return null
  return REVIEW_BLOCKS[run.review?.reason] || 'There is no tested version of this code to approve'
}

const article = (word) => (/^[AEIOU]/i.test(word) ? 'an' : 'a')

// The banner's view of a run for this user.
// kind: 'gate' | 'agent' | 'not_started' | 'done' | 'cancelled' | 'unknown'.
// For a gate: canApprove / canReject, with approveBlock / rejectBlock reasons.
export function gateView(run, user) {
  const step = run?.step
  const gate = GATES[step]
  if (gate) {
    const mayAct = user?.role === gate.role || user?.role === 'Admin'
    const roleBlock = mayAct ? null : `Only ${article(gate.role)} ${gate.role} can decide Gate ${gate.num}. You are signed in as ${user?.role || 'nobody'}`
    const requesterBlock = step === 'g3' && run.createdBy && user?.username === run.createdBy
      ? 'You asked for this work, so someone else must give the final approval'
      : null
    const approveBlock = roleBlock || requesterBlock || approvalBlockReason(run)
    return {
      kind: 'gate',
      step,
      gate,
      title: `Gate ${gate.num} of 3: ${gate.name}`,
      waitingFor: gate.role,
      approveLabel: `Approve Gate ${gate.num}`,
      canApprove: !approveBlock,
      approveBlock,
      canReject: !roleBlock,
      rejectBlock: roleBlock,
    }
  }
  if (step === 'done') return { kind: 'done', title: 'Run complete', waitingFor: 'Nobody, all three gates are approved' }
  if (step === 'cancelled') return { kind: 'cancelled', title: 'Run cancelled', waitingFor: 'Nobody, a cancelled run cannot be reopened' }
  if (step === 'req' && !run.started) return { kind: 'not_started', title: 'Not started yet', waitingFor: 'Someone to start the pipeline (Overview)' }
  if (AGENT_STEPS[step]) return { kind: 'agent', title: `Agent working: ${AGENT_STEPS[step]}`, waitingFor: 'Agent' }
  return { kind: 'unknown', title: 'This run has no known step, so no decision can be made.', waitingFor: 'Nobody' }
}

// The comments that belong to this gate's review round (F6): only this gate's
// phase, and only those written after the gate's last decision. A rejection
// already sent the older ones; an approval closed their round. A comment with
// no readable time is kept, so it is shown in the window rather than lost.
export function gateComments(run) {
  const gate = GATES[run?.step]
  if (!gate) return []
  const decided = new Set([`${run.step}.rejected`, `${run.step}.approved`])
  const lastDecision = (run.auditChain || [])
    .filter((e) => decided.has(e.event))
    .map((e) => Date.parse(e.createdAt))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), -Infinity)
  return (run.comments || []).filter((c) => {
    if (!gate.phases.includes(c.phase || 'code')) return false
    const written = Date.parse(c.createdAt)
    return lastDecision === -Infinity || !Number.isFinite(written) || written > lastDecision
  })
}

// The feedback text sent to the agent with a rework.
export function reworkFeedback(comments, guidance) {
  let text = ''
  if (comments.length > 0) {
    text += 'Review Comments:\n'
    comments.forEach((c) => {
      const loc = c.line != null ? `${c.file}:${c.line}` : (c.file || c.phase || 'general')
      text += `- [${loc}] (${c.role}): ${c.text}\n`
    })
    text += '\n'
  }
  if (guidance.trim()) text += `Overall Guidance:\n${guidance.trim()}`
  return text.trim() || 'Please review and rework the latest phase according to standard conventions.'
}
