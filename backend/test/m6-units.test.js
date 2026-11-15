// Milestone 6, the pure rules: gatekeep.yaml patterns and validation (I5),
// requirement IDs and the structured design plan (I2, I3), and the Gate 3
// governance check (I3 scope budgets, I4 team rules, I5 required reviewers).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { globMatch } from '../src/policy/glob.js'
import { ROBOT_TOOLS, validatePolicy } from '../src/policy/policy.js'
import { blockingIssues, governance } from '../src/policy/governance.js'
import { parseDesignPlan, parseRequirements, testRequirementIds, traceability } from '../src/runs/trace.js'

const GLOBS = JSON.parse(readFileSync(new URL('./fixtures/glob-cases.json', import.meta.url), 'utf8')).cases

// ── I5: path patterns ────────────────────────────────────────────────────

test('gatekeep.yaml path patterns follow the shared definition (I5)', () => {
  for (const [pattern, path, expected] of GLOBS) {
    assert.equal(globMatch(pattern, path), expected, `${pattern} vs ${path}`)
  }
})

// ── I5: validation ───────────────────────────────────────────────────────

const FULL = {
  version: 1,
  forbidden_paths: ['infra/**', '*.pem'],
  protected_paths: [{ path: 'src/payments/**', approvals: 2, reviewers: ['alice'], roles: ['Engineer'] }],
  tools: { deny: ['search_code'] },
  design: { enforce: 'block' },
  scope: { max_files_changed: 5, max_lines_changed: 200 },
  tests: { require_new_tests: true, require_requirement_coverage: true },
  team: { min_approvals: 1, distinct_gate_approvers: true },
}

test('a complete gatekeep.yaml is accepted and normalized (I5)', () => {
  const { rules, errors } = validatePolicy(FULL)
  assert.deepEqual(errors, [])
  assert.deepEqual(rules.forbidden_paths, ['infra/**', '*.pem'])
  assert.deepEqual(rules.protected_paths, [{ path: 'src/payments/**', approvals: 2, reviewers: ['alice'], roles: ['Engineer'] }])
  assert.equal(rules.design.enforce, 'block')
  assert.equal(rules.scope.max_files_changed, 5)
  assert.equal(rules.team.distinct_gate_approvers, true)
})

test('an empty gatekeep.yaml gets safe defaults (I5)', () => {
  const { rules, errors } = validatePolicy({})
  assert.deepEqual(errors, [])
  assert.deepEqual(rules.forbidden_paths, [])
  assert.deepEqual(rules.protected_paths, [])
  assert.deepEqual(rules.tools.deny, [])
  assert.equal(rules.design.enforce, 'warn')
  assert.equal(rules.scope.max_files_changed, null)
  assert.equal(rules.team.min_approvals, 1)
  assert.equal(rules.team.distinct_gate_approvers, false)
})

test('a protected rule defaults to one approval by an Engineer or Admin (I5)', () => {
  const { rules } = validatePolicy({ protected_paths: [{ path: 'db/**' }] })
  assert.deepEqual(rules.protected_paths, [{ path: 'db/**', approvals: 1, reviewers: [], roles: ['Engineer', 'Admin'] }])
})

test('mistakes in gatekeep.yaml are errors, never silently ignored (fail closed, I5)', () => {
  const bad = [
    ['not a mapping', ['a', 'b']],
    ['unknown setting', { protect: ['src/**'] }],
    ['version', { version: 2 }],
    ['forbidden_paths', { forbidden_paths: 'infra/**' }],
    ['forbidden_paths', { forbidden_paths: [''] }],
    ['..', { forbidden_paths: ['../etc/**'] }],
    ['protected_paths', { protected_paths: [{ approvals: 2 }] }],
    ['approvals', { protected_paths: [{ path: 'a/**', approvals: 0 }] }],
    ['approvals', { protected_paths: [{ path: 'a/**', approvals: 1.5 }] }],
    ['roles', { protected_paths: [{ path: 'a/**', roles: ['Planner'] }] }],
    ['reviewers', { protected_paths: [{ path: 'a/**', reviewers: [42] }] }],
    ['unknown setting', { protected_paths: [{ path: 'a/**', approver: 'x' }] }],
    ['tools.deny', { tools: { deny: ['rm_rf'] } }],
    ['design.enforce', { design: { enforce: 'maybe' } }],
    ['max_files_changed', { scope: { max_files_changed: -1 } }],
    ['require_new_tests', { tests: { require_new_tests: 'yes' } }],
    ['min_approvals', { team: { min_approvals: 0 } }],
  ]
  for (const [hint, content] of bad) {
    const { errors } = validatePolicy(content)
    assert.ok(errors.length > 0, `expected an error for ${JSON.stringify(content)}`)
    assert.ok(errors.some((e) => e.includes(hint)), `${JSON.stringify(errors)} should mention ${hint}`)
  }
})

test('only workspace tools can be denied, so a policy cannot switch off a gate (I5)', () => {
  assert.ok(ROBOT_TOOLS.includes('write_file'))
  for (const t of ['submit_requirements', 'submit_design', 'request_approval', 'run_tests', 'get_run']) {
    assert.ok(!ROBOT_TOOLS.includes(t), t)
  }
})

// ── I3: requirement IDs ──────────────────────────────────────────────────

const REQS = `## Injection Check
Status: NONE

## Requirements
- **REQ-1**: Limit each merchant to 60 webhook calls per minute.
- REQ-2: Return HTTP 429 with a Retry-After header when over the limit.
### REQ-3 - Internal reconciliation traffic is exempt.
This line mentions REQ-1 but does not define anything.`

test('requirement IDs are read from the approved requirements (I3)', () => {
  const { items, error } = parseRequirements(REQS)
  assert.equal(error, undefined)
  assert.deepEqual(items.map((r) => r.id), ['REQ-1', 'REQ-2', 'REQ-3'])
  assert.equal(items[0].text, 'Limit each merchant to 60 webhook calls per minute.')
  assert.equal(items[2].text, 'Internal reconciliation traffic is exempt.')
})

test('requirements without IDs, or with a repeated ID, are refused (I3)', () => {
  assert.equal(parseRequirements('Throttle the webhook.').error, 'requirements_ids_missing')
  assert.equal(parseRequirements('REQ-1: a\nREQ-1: b').error, 'requirements_ids_duplicate')
})

test('a "no actionable feature" answer needs no IDs, so the reviewer can see it at Gate 1', () => {
  const out = parseRequirements('## Injection Check\nStatus: DETECTED\n## Result\nNO_ACTIONABLE_FEATURE: the brief asks for nothing')
  assert.equal(out.error, undefined)
  assert.deepEqual(out.items, [])
})

test('a test is linked to a requirement by its name: test_req_<n>_... (I3)', () => {
  assert.deepEqual(testRequirementIds('test_req_1_allows_60_per_minute'), ['REQ-1'])
  assert.deepEqual(testRequirementIds('test_REQ2_and_req_3'), ['REQ-2', 'REQ-3'])
  assert.deepEqual(testRequirementIds('TestLimit::test_req-12_x'), ['REQ-12'])
  assert.deepEqual(testRequirementIds('test_frequency_2'), [])
  assert.deepEqual(testRequirementIds('test_requests_are_counted'), [])
})

// ── I2: the structured design ────────────────────────────────────────────

const DESIGN = `## Approach
Token bucket in Redis.

## Files
- \`app/throttle.py\` (create): the bucket [REQ-1, REQ-2]
- \`app/routes/webhook.py\` (modify): wire it in. REQ-3
- \`tests/test_throttle.py\` (create) [REQ-1]
- \`docs/**\` (modify): any docs page

## Interfaces
- \`is_allowed(merchant_id) -> bool\`: REQ-1

## Risks
- \`app/not_a_plan_file.py\` is only mentioned here.`

test('the design plan lists files, how they change, and which requirements they serve (I2)', () => {
  const plan = parseDesignPlan(DESIGN)
  assert.deepEqual(plan.files, [
    { path: 'app/throttle.py', change: 'create', reqs: ['REQ-1', 'REQ-2'] },
    { path: 'app/routes/webhook.py', change: 'modify', reqs: ['REQ-3'] },
    { path: 'tests/test_throttle.py', change: 'create', reqs: ['REQ-1'] },
    { path: 'docs/**', change: 'modify', reqs: [] },
  ])
  assert.deepEqual(plan.interfaces, [{ name: 'is_allowed(merchant_id) -> bool', reqs: ['REQ-1'] }])
})

test('a design with no Files section has no plan (I2)', () => {
  assert.equal(parseDesignPlan('Token bucket in Redis.'), null)
  assert.equal(parseDesignPlan('## Files\n\nnothing listed'), null)
})

test('older object designs keep working (files_to_create / files_to_modify)', () => {
  const plan = parseDesignPlan({ files_to_create: ['a.py'], files_to_modify: [{ path: 'b.py' }] })
  assert.deepEqual(plan.files, [
    { path: 'a.py', change: 'create', reqs: [] },
    { path: 'b.py', change: 'modify', reqs: [] },
  ])
})

test('a plan file outside the workspace is marked bad (I2)', () => {
  for (const bad of ['../x.py', '/etc/passwd', '.git/config', 'a/../../b']) {
    assert.equal(parseDesignPlan(`## Files\n- \`${bad}\` (modify)`).error, 'design_plan_bad_path', bad)
  }
})

// ── I2 + I3: traceability ────────────────────────────────────────────────

const CHANGED = [
  { path: 'app/throttle.py', status: 'A', add: 40, rem: 0 },
  { path: 'tests/test_throttle.py', status: 'A', add: 30, rem: 0 },
  { path: 'docs/limits.md', status: 'M', add: 3, rem: 1 },
  { path: 'app/payments.py', status: 'M', add: 5, rem: 2 },
]
const TESTS = {
  status: 'Failed',
  cases: [
    { name: 'test_req_1_allows_60', file: 'tests/test_throttle.py', outcome: 'passed', new: true },
    { name: 'test_req_1_blocks_61', file: 'tests/test_throttle.py', outcome: 'passed', new: true },
    { name: 'test_req_2_retry_after', file: 'tests/test_throttle.py', outcome: 'failed', new: true },
    { name: 'test_req_9_ghost', file: 'tests/test_throttle.py', outcome: 'passed', new: true },
    { name: 'test_old_behaviour', file: 'tests/test_app.py', outcome: 'passed', new: false },
  ],
}

test('every requirement shows its planned files, changed files and tests, with a status (I3)', () => {
  const t = traceability({ requirements: REQS, design: DESIGN, files: CHANGED, tests: TESTS })
  const byId = Object.fromEntries(t.requirements.map((r) => [r.id, r]))
  assert.deepEqual(byId['REQ-1'].planned, ['app/throttle.py', 'tests/test_throttle.py'])
  assert.deepEqual(byId['REQ-1'].changed, ['app/throttle.py', 'tests/test_throttle.py'])
  assert.deepEqual(byId['REQ-1'].tests.map((c) => c.name), ['test_req_1_allows_60', 'test_req_1_blocks_61'])
  assert.equal(byId['REQ-1'].status, 'covered')
  assert.equal(byId['REQ-2'].status, 'failing')
  assert.equal(byId['REQ-3'].status, 'uncovered')
  assert.deepEqual(byId['REQ-3'].changed, [])
  assert.deepEqual(t.unknownRefs, [{ id: 'REQ-9', in: 'tests' }])
  assert.deepEqual(t.summary, { requirements: 3, covered: 1, failing: 1, uncovered: 1, undeclared: 1, untouched: 1 })
})

test('files changed outside the approved design, and planned files left alone, are flagged (I2)', () => {
  const t = traceability({ requirements: REQS, design: DESIGN, files: CHANGED, tests: TESTS })
  assert.deepEqual(t.drift.undeclared, ['app/payments.py'])
  assert.deepEqual(t.drift.untouched, ['app/routes/webhook.py'])
  const docs = t.drift.planned.find((p) => p.path === 'docs/**')
  assert.deepEqual(docs.changed, ['docs/limits.md'])
})

test('with no structured design, every changed file is undeclared (fail closed, I2)', () => {
  const t = traceability({ requirements: REQS, design: 'free text, no plan', files: CHANGED, tests: TESTS })
  assert.equal(t.plan, null)
  assert.deepEqual(t.drift.undeclared, CHANGED.map((f) => f.path))
})

test('a skipped test does not cover a requirement (I3)', () => {
  const t = traceability({
    requirements: 'REQ-1: x', design: null, files: [],
    tests: { cases: [{ name: 'test_req_1_x', file: 't.py', outcome: 'skipped', new: true }] },
  })
  assert.equal(t.requirements[0].status, 'uncovered')
})

// ── I3, I4, I5: what Gate 3 needs ────────────────────────────────────────

const loaded = (content) => ({ status: 'loaded', rules: validatePolicy(content).rules })
const trace = (files, tests = TESTS, design = DESIGN) => traceability({ requirements: REQS, design, files, tests })

test('without a project policy Gate 3 needs one approval and nothing blocks', () => {
  const g = governance({ policy: { status: 'none' }, trace: trace(CHANGED), files: CHANGED, tests: TESTS, approvals: [] })
  assert.equal(g.complete, false)
  assert.deepEqual(g.blocking, [])
  assert.deepEqual(g.requirements.map((r) => [r.label, r.approvals, r.have]), [['Gate 3', 1, 0]])
  const one = governance({ policy: { status: 'none' }, trace: trace(CHANGED), files: CHANGED, tests: TESTS, approvals: [{ username: 'eli', role: 'Engineer' }] })
  assert.equal(one.complete, true)
})

test('a touched protected path needs its approvals and its named reviewers (I4, I5)', () => {
  const policy = loaded({ protected_paths: [{ path: 'app/payments.py', approvals: 2, reviewers: ['alice'] }] })
  const base = { policy, trace: trace(CHANGED), files: CHANGED, tests: TESTS }
  const g0 = governance({ ...base, approvals: [{ username: 'eli', role: 'Engineer' }] })
  assert.deepEqual(g0.triggered.map((r) => [r.path, r.files]), [['app/payments.py', ['app/payments.py']]])
  const rule = g0.requirements.find((r) => r.label === 'app/payments.py')
  assert.equal(rule.have, 1)
  assert.deepEqual(rule.missingReviewers, ['alice'])
  assert.equal(g0.complete, false)
  const g1 = governance({ ...base, approvals: [{ username: 'eli', role: 'Engineer' }, { username: 'bob', role: 'Engineer' }] })
  assert.equal(g1.complete, false, 'two approvals, but alice has not approved')
  const g2 = governance({ ...base, approvals: [{ username: 'eli', role: 'Engineer' }, { username: 'alice', role: 'Admin' }] })
  assert.equal(g2.complete, true)
})

test('only approvals by the listed roles count for a protected path (I4)', () => {
  const policy = loaded({ protected_paths: [{ path: 'app/payments.py', roles: ['Admin'] }] })
  const g = governance({ policy, trace: trace(CHANGED), files: CHANGED, tests: TESTS, approvals: [{ username: 'eli', role: 'Engineer' }] })
  assert.equal(g.complete, false)
})

test('an untouched protected path asks for nothing extra (I5)', () => {
  const policy = loaded({ protected_paths: [{ path: 'billing/**', approvals: 3 }] })
  const g = governance({ policy, trace: trace(CHANGED), files: CHANGED, tests: TESTS, approvals: [{ username: 'eli', role: 'Engineer' }] })
  assert.deepEqual(g.triggered, [])
  assert.equal(g.complete, true)
})

test('scope budgets, design enforcement and test rules block approval (I2, I3, I5)', () => {
  const codes = (content, files = CHANGED, tests = TESTS) =>
    blockingIssues({ policy: loaded(content), trace: trace(files, tests), files, tests }).map((b) => b.code)
  assert.deepEqual(codes({ scope: { max_files_changed: 3 } }), ['over_file_budget'])
  assert.deepEqual(codes({ scope: { max_lines_changed: 80 } }), ['over_line_budget'])
  assert.deepEqual(codes({ scope: { max_files_changed: 4, max_lines_changed: 81 } }), [])
  assert.deepEqual(codes({ design: { enforce: 'block' } }), ['undeclared_changes'])
  assert.deepEqual(codes({ design: { enforce: 'warn' } }), [])
  assert.deepEqual(codes({ tests: { require_requirement_coverage: true } }), ['requirements_not_covered'])
  const oldOnly = { cases: [{ name: 'test_old', file: 't.py', outcome: 'passed', new: false }] }
  assert.deepEqual(codes({ tests: { require_new_tests: true } }, CHANGED, oldOnly), ['no_new_tests'])
  assert.deepEqual(codes({ forbidden_paths: ['app/payments.py'] }), ['forbidden_path_changed'])
})

test('an invalid policy blocks everything (fail closed, I5)', () => {
  const issues = blockingIssues({ policy: { status: 'invalid', errors: ['bad'] }, trace: trace([]), files: [], tests: TESTS })
  assert.deepEqual(issues.map((b) => b.code), ['policy_invalid'])
})

test('governance reports the change size against the budget (I3)', () => {
  const g = governance({ policy: loaded({ scope: { max_files_changed: 10, max_lines_changed: 500 } }), trace: trace(CHANGED), files: CHANGED, tests: TESTS, approvals: [] })
  assert.deepEqual(g.budget, { files: { used: 4, max: 10 }, lines: { used: 81, max: 500 } })
})

// ── ECC review findings ──────────────────────────────────────────────────

test('robot-written plan patterns stay narrow: no match-everything and no stacked ** (review)', () => {
  for (const bad of ['**', '*', '**/*.py', '*/x.py', '**/**/**/**/x', 'a/**/b/**/c']) {
    assert.equal(parseDesignPlan(`## Files\n- \`${bad}\` (modify)`).error, 'design_plan_bad_path', bad)
  }
  assert.deepEqual(parseDesignPlan('## Files\n- `tests/**` (create)\n- `docs/*.md` (modify)').files.map((f) => f.path), ['tests/**', 'docs/*.md'])
})

test('a long path against a pattern with many ** answers quickly (review: ReDoS)', () => {
  const path = `${'a/'.repeat(2000)}b`
  const t0 = Date.now()
  assert.equal(globMatch('**/**/**/**/**/**/x.py', path), false)
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`)
})
