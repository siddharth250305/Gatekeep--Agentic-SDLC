// The run state machine (B2): the one place that says which step a run can
// move to, on which action, and who may do it. Everything here is pure; the
// database side (locking, writing the move and its audit event) lives in
// runs/service.js. See organised.md, Milestone 2, "The allowed moves table".

// The steps of a run, in order. Gate steps have a human role; the others
// belong to the robot. 'done' is the finished state. 'cancelled' is the other
// final state; it is not a step of its own because it can follow any step.
export const STEPS = [
  { key: 'req', label: 'Requirements', role: 'Agent' },
  { key: 'g1', label: 'Gate 1', role: 'Planner' },
  { key: 'design', label: 'Design', role: 'Agent' },
  { key: 'g2', label: 'Gate 2', role: 'Engineer' },
  { key: 'code', label: 'Code & Tests', role: 'Agent' },
  { key: 'g3', label: 'Gate 3', role: 'Engineer' },
  { key: 'done', label: 'Done', role: 'Branch' },
]

export const GATES = new Set(['g1', 'g2', 'g3'])
export const FINAL = new Set(['done', 'cancelled'])
const ACTIVE = ['req', 'g1', 'design', 'g2', 'code', 'g3']
const KNOWN = new Set([...ACTIVE, ...FINAL])

const ROBOT = 'robot'

// Every allowed move. Anything not listed is refused.
// by: ROBOT, or the human roles that may do it (an Admin may act for any of them).
export const MOVES = [
  { from: 'req', action: 'submit_requirements', to: 'g1', by: ROBOT, event: 'requirements.submitted' },
  { from: 'g1', action: 'approve', to: 'design', by: ['Planner'], event: 'g1.approved' },
  { from: 'g1', action: 'reject', to: 'req', by: ['Planner'], event: 'g1.rejected' },
  { from: 'design', action: 'submit_design', to: 'g2', by: ROBOT, event: 'design.submitted' },
  { from: 'g2', action: 'approve', to: 'code', by: ['Engineer'], event: 'g2.approved' },
  { from: 'g2', action: 'reject', to: 'design', by: ['Engineer'], event: 'g2.rejected' },
  { from: 'code', action: 'request_review', to: 'g3', by: ROBOT, event: 'code.review_requested' },
  { from: 'g3', action: 'approve', to: 'done', by: ['Engineer'], notRequester: true, event: 'g3.approved' },
  { from: 'g3', action: 'reject_to_code', to: 'code', by: ['Engineer'], event: 'g3.rejected' },
  { from: 'g3', action: 'reject_to_design', to: 'design', by: ['Engineer'], event: 'g3.rejected' },
  ...ACTIVE.map((from) => ({ from, action: 'cancel', to: 'cancelled', by: ['Planner', 'Engineer'], event: 'run.cancelled' })),
]

export const ACTIONS = new Set(MOVES.map((m) => m.action))
export const ROBOT_ACTIONS = new Set(MOVES.filter((m) => m.by === ROBOT).map((m) => m.action))

// Run status and assigned role that the dashboard reads for each step.
export function statusFor(step) {
  if (step === 'done') return { status: 'approved', gate: null }
  if (step === 'cancelled') return { status: 'cancelled', gate: null }
  if (GATES.has(step)) return { status: 'awaiting_gate', gate: STEPS.find((s) => s.key === step).role }
  return { status: 'running', gate: null }
}

function mayAct(move, actor) {
  if (move.by === ROBOT) return actor.kind === 'agent'
  if (actor.kind !== 'human') return false
  return actor.role === 'Admin' || move.by.includes(actor.role)
}

// Decide one move. run: { step, createdBy }. actor: { kind: 'agent' } or
// { kind: 'human', role, userId }. Returns { to, move } when allowed, or
// { error } with one of: unknown_step, finished, bad_action, bad_actor,
// not_allowed, wrong_role, requester.
export function planMove(run, action, actor) {
  const step = run?.step
  if (!KNOWN.has(step)) return { error: 'unknown_step' }
  if (FINAL.has(step)) return { error: 'finished' }
  if (!ACTIONS.has(action)) return { error: 'bad_action' }
  if (!actor || (actor.kind !== 'agent' && actor.kind !== 'human')) return { error: 'bad_actor' }

  const move = MOVES.find((m) => m.from === step && m.action === action)
  if (!move) return { error: 'not_allowed' }
  if (!mayAct(move, actor)) {
    return move.by === ROBOT || actor.kind === 'agent'
      ? { error: 'not_allowed' }
      : { error: 'wrong_role', gate: move.by.join(' or ') }
  }
  if (move.notRequester && run.createdBy != null && Number(run.createdBy) === Number(actor.userId)) {
    return { error: 'requester' }
  }
  return { to: move.to, move }
}

// Where a robot action leads, wherever the run is now. A repeated robot
// submission is a no-op when the run already sits there (the first one went
// through).
export function robotTarget(action) {
  return MOVES.find((m) => m.by === ROBOT && m.action === action)?.to ?? null
}
