// What Gate 3 needs before a run is done (I3, I4, I5): the project policy's
// hard rules (blockingIssues), and enough of the right approvals (governance).
// The same functions decide the hand-over (request_review), the approve, and
// what the dashboard shows, so the screen never offers what the server refuses.

import { globMatch } from './glob.js'
import { GATE3_ROLES, rulesOf } from './policy.js'

const changedPaths = (files) => (Array.isArray(files) ? files : []).map((f) => f.path).filter(Boolean)
const changedLines = (files) => (Array.isArray(files) ? files : []).reduce((n, f) => n + (Number(f.add) || 0) + (Number(f.rem) || 0), 0)
const listOf = (items, max = 5) => (items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', '))

// Rules the change breaks: each { code, message }. Any one blocks the
// hand-over and the approval. An invalid policy blocks everything.
export function blockingIssues({ policy, trace, files, tests }) {
  if (policy?.status === 'invalid') {
    return [{ code: 'policy_invalid', message: `gatekeep.yaml is invalid: ${(policy.errors || []).join('; ')}` }]
  }
  const rules = rulesOf(policy)
  const paths = changedPaths(files)
  const issues = []
  const forbidden = paths.filter((p) => rules.forbidden_paths.some((g) => globMatch(g, p)))
  if (forbidden.length) {
    issues.push({ code: 'forbidden_path_changed', message: `gatekeep.yaml forbids changing ${listOf(forbidden)}` })
  }
  const maxFiles = rules.scope.max_files_changed
  if (maxFiles != null && paths.length > maxFiles) {
    issues.push({ code: 'over_file_budget', message: `${paths.length} files changed; gatekeep.yaml allows ${maxFiles}` })
  }
  const maxLines = rules.scope.max_lines_changed
  const lines = changedLines(files)
  if (maxLines != null && lines > maxLines) {
    issues.push({ code: 'over_line_budget', message: `${lines} lines changed; gatekeep.yaml allows ${maxLines}` })
  }
  const undeclared = trace?.drift?.undeclared ?? paths
  if (rules.design.enforce === 'block' && undeclared.length) {
    issues.push({ code: 'undeclared_changes', message: `changed outside the approved design: ${listOf(undeclared)}` })
  }
  if (rules.tests.require_requirement_coverage) {
    const open = (trace?.requirements ?? []).filter((r) => r.status !== 'covered').map((r) => r.id)
    if (open.length) issues.push({ code: 'requirements_not_covered', message: `no passing test for ${listOf(open)}` })
  }
  if (rules.tests.require_new_tests) {
    const fresh = (tests?.cases ?? []).some((c) => c.new && c.outcome === 'passed')
    if (!fresh) issues.push({ code: 'no_new_tests', message: 'gatekeep.yaml requires at least one new passing test' })
  }
  return issues
}

// Who may not count at Gate 3 (I4): the requester always; with
// team.distinct_gate_approvers, whoever approved Gate 1 or Gate 2.
// gateApprovers: { g1: username, g2: username } (latest approvals).
export function excludedApprovers({ policy, createdBy, gateApprovers = {} }) {
  const out = []
  if (createdBy) out.push({ username: createdBy, reason: 'requester' })
  if (rulesOf(policy).team.distinct_gate_approvers) {
    for (const gate of ['g1', 'g2']) {
      const who = gateApprovers[gate]
      if (who && !out.some((e) => e.username === who)) out.push({ username: who, reason: `approved Gate ${gate.slice(1)}` })
    }
  }
  return out
}

// The approvals Gate 3 needs and has. approvals: [{ username, role }] for the
// current review round.
export function governance({ policy, trace, files, tests, approvals = [], createdBy = null, gateApprovers = {} }) {
  const rules = rulesOf(policy)
  const paths = changedPaths(files)
  const triggered = rules.protected_paths
    .map((r) => ({ ...r, files: paths.filter((p) => globMatch(r.path, p)) }))
    .filter((r) => r.files.length)
  const needs = [
    { label: 'Gate 3', approvals: rules.team.min_approvals, roles: GATE3_ROLES, reviewers: [] },
    ...triggered.map((r) => ({ label: r.path, approvals: Math.max(r.approvals, r.reviewers.length), roles: r.roles, reviewers: r.reviewers })),
  ]
  const requirements = needs.map((n) => {
    const have = approvals.filter((a) => n.roles.includes(a.role)).length
    const missingReviewers = n.reviewers.filter((u) => !approvals.some((a) => a.username === u))
    return { ...n, have, missingReviewers, satisfied: have >= n.approvals && !missingReviewers.length }
  })
  const blocking = blockingIssues({ policy, trace, files, tests })
  return {
    policyStatus: policy?.status ?? 'unknown',
    triggered,
    requirements,
    approvals,
    excluded: excludedApprovers({ policy, createdBy, gateApprovers }),
    blocking,
    budget: {
      files: { used: paths.length, max: rules.scope.max_files_changed },
      lines: { used: changedLines(files), max: rules.scope.max_lines_changed },
    },
    complete: !blocking.length && requirements.every((r) => r.satisfied),
  }
}
