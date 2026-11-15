// The project policy file, gatekeep.yaml (I5). The agent service reads the
// file from the run's base commit and sends its parsed content; this module is
// the one place that decides what a valid policy is. Anything it does not
// understand is an error, never silently ignored (fail closed): a typo must
// not quietly switch a rule off.
//
//   version: 1
//   forbidden_paths: [glob]          # the robot may never write these
//   protected_paths:                 # may change, but Gate 3 needs more
//     - path: glob
//       approvals: 2                 # distinct Gate 3 approvals (default 1)
//       reviewers: [username]        # each of them must approve
//       roles: [Engineer, Admin]     # whose approvals count (default both)
//   tools: { deny: [tool] }          # GateKeep workspace tools not allowed here
//   design: { enforce: warn|block }  # block: only planned files may change
//   scope: { max_files_changed: n, max_lines_changed: n }
//   tests: { require_new_tests: bool, require_requirement_coverage: bool }
//   team: { min_approvals: n, distinct_gate_approvers: bool }

// Workspace tools a project may switch off. Moves (submit_*, request_approval),
// run_tests and status tools are not listed: a policy cannot remove a gate or
// the evidence Gate 3 needs. agents/tests/test_m6_policy.py checks that each
// name is a real tool of agents/app/mcp/policy.py.
export const ROBOT_TOOLS = ['list_files', 'read_file', 'search_code', 'get_repository_context', 'get_diff', 'write_file', 'apply_patch']

// Roles that may approve Gate 3 (runs/machine.js).
export const GATE3_ROLES = ['Engineer', 'Admin']

const TOP = ['version', 'forbidden_paths', 'protected_paths', 'tools', 'design', 'scope', 'tests', 'team']
const SECTIONS = {
  tools: ['deny'],
  design: ['enforce'],
  scope: ['max_files_changed', 'max_lines_changed'],
  tests: ['require_new_tests', 'require_requirement_coverage'],
  team: ['min_approvals', 'distinct_gate_approvers'],
}
const RULE_KEYS = ['path', 'approvals', 'reviewers', 'roles']
const MAX_LIST = 200
const MAX_APPROVALS = 10

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isWhole = (n, min) => Number.isInteger(n) && n >= min

export const DEFAULT_RULES = Object.freeze({
  forbidden_paths: [],
  protected_paths: [],
  tools: { deny: [] },
  design: { enforce: 'warn' },
  scope: { max_files_changed: null, max_lines_changed: null },
  tests: { require_new_tests: false, require_requirement_coverage: false },
  team: { min_approvals: 1, distinct_gate_approvers: false },
})

function patternError(where, p) {
  if (typeof p !== 'string' || !p.trim()) return `${where} must be a non-empty path pattern`
  if (p.replace(/\\/g, '/').split('/').includes('..')) return `${where} '${p}' may not contain '..'`
  return null
}

function patternList(value, where, errors) {
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    errors.push(`${where} must be a list of path patterns (at most ${MAX_LIST})`)
    return []
  }
  const out = []
  value.forEach((p, i) => {
    const err = patternError(`${where}[${i}]`, p)
    if (err) errors.push(err)
    else out.push(p.trim())
  })
  return out
}

function unknownKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`unknown setting '${where ? `${where}.` : ''}${k}'`)
  }
}

function protectedRule(rule, i, errors) {
  const where = `protected_paths[${i}]`
  if (!isObject(rule)) { errors.push(`${where} must be a mapping with a path`); return null }
  unknownKeys(rule, RULE_KEYS, where, errors)
  const err = patternError(`${where}.path`, rule.path)
  if (err) { errors.push(err); return null }
  const approvals = rule.approvals ?? 1
  if (!isWhole(approvals, 1) || approvals > MAX_APPROVALS) errors.push(`${where}.approvals must be a whole number from 1 to ${MAX_APPROVALS}`)
  const reviewers = rule.reviewers ?? []
  if (!Array.isArray(reviewers) || !reviewers.every((u) => typeof u === 'string' && u.trim())) {
    errors.push(`${where}.reviewers must be a list of usernames`)
  }
  const roles = rule.roles ?? GATE3_ROLES
  if (!Array.isArray(roles) || !roles.length || !roles.every((r) => GATE3_ROLES.includes(r))) {
    errors.push(`${where}.roles must list roles that can approve Gate 3: ${GATE3_ROLES.join(', ')}`)
  }
  return { path: rule.path.trim(), approvals, reviewers: Array.isArray(reviewers) ? reviewers : [], roles: Array.isArray(roles) ? roles : GATE3_ROLES }
}

// Returns { rules, errors }. rules are complete (defaults filled in); when
// errors is not empty the policy must be treated as invalid.
export function validatePolicy(content) {
  const errors = []
  const rules = structuredClone(DEFAULT_RULES)
  if (!isObject(content)) return { rules, errors: ['gatekeep.yaml must be a mapping of settings (not a mapping)'] }
  unknownKeys(content, TOP, '', errors)

  if (content.version !== undefined && content.version !== 1) errors.push('version must be 1')
  if (content.forbidden_paths !== undefined) rules.forbidden_paths = patternList(content.forbidden_paths, 'forbidden_paths', errors)
  if (content.protected_paths !== undefined) {
    if (!Array.isArray(content.protected_paths) || content.protected_paths.length > MAX_LIST) {
      errors.push('protected_paths must be a list of rules')
    } else {
      rules.protected_paths = content.protected_paths.map((r, i) => protectedRule(r, i, errors)).filter(Boolean)
    }
  }

  for (const [section, keys] of Object.entries(SECTIONS)) {
    const value = content[section]
    if (value === undefined || value === null) continue
    if (!isObject(value)) { errors.push(`${section} must be a mapping`); continue }
    unknownKeys(value, keys, section, errors)
  }
  const tools = content.tools ?? {}
  if (tools.deny !== undefined) {
    if (!Array.isArray(tools.deny) || !tools.deny.every((t) => ROBOT_TOOLS.includes(t))) {
      errors.push(`tools.deny may only list: ${ROBOT_TOOLS.join(', ')}`)
    } else rules.tools.deny = [...tools.deny]
  }
  const enforce = content.design?.enforce
  if (enforce !== undefined) {
    if (enforce !== 'warn' && enforce !== 'block') errors.push("design.enforce must be 'warn' or 'block'")
    else rules.design.enforce = enforce
  }
  for (const k of SECTIONS.scope) {
    const v = content.scope?.[k]
    if (v === undefined || v === null) continue
    if (!isWhole(v, 1)) errors.push(`scope.${k} must be a whole number of at least 1`)
    else rules.scope[k] = v
  }
  for (const k of SECTIONS.tests) {
    const v = content.tests?.[k]
    if (v === undefined) continue
    if (typeof v !== 'boolean') errors.push(`tests.${k} must be true or false`)
    else rules.tests[k] = v
  }
  const min = content.team?.min_approvals
  if (min !== undefined) {
    if (!isWhole(min, 1) || min > MAX_APPROVALS) errors.push(`team.min_approvals must be a whole number from 1 to ${MAX_APPROVALS}`)
    else rules.team.min_approvals = min
  }
  const distinct = content.team?.distinct_gate_approvers
  if (distinct !== undefined) {
    if (typeof distinct !== 'boolean') errors.push('team.distinct_gate_approvers must be true or false')
    else rules.team.distinct_gate_approvers = distinct
  }
  return { rules, errors }
}

const SHA256 = /^[0-9a-f]{64}$/

// What the agent sends (PUT /runs/:id/policy) -> what the run stores, or
// { error: 'bad_policy' } for a malformed request.
//   { found: false }                          no gatekeep.yaml in the project
//   { found: true, sha256, content }          the parsed file
//   { found: true, sha256, error }            the file could not be parsed
export function policyRecord(body) {
  if (!isObject(body) || typeof body.found !== 'boolean') return { error: 'bad_policy' }
  if (!body.found) return { status: 'none' }
  if (typeof body.sha256 !== 'string' || !SHA256.test(body.sha256)) return { error: 'bad_policy' }
  if (typeof body.error === 'string') {
    return { status: 'invalid', sha256: body.sha256, errors: [body.error.slice(0, 500)] }
  }
  if (!('content' in body)) return { error: 'bad_policy' }
  const { rules, errors } = validatePolicy(body.content)
  return errors.length
    ? { status: 'invalid', sha256: body.sha256, errors }
    : { status: 'loaded', sha256: body.sha256, rules }
}

// The rules in force for a recorded policy (none recorded or no file: defaults).
export function rulesOf(policy) {
  return policy?.status === 'loaded' ? policy.rules : DEFAULT_RULES
}
