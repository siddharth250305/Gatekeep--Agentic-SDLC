// Requirements, design, code and tests linked together (I2, I3).
//
// Requirements carry IDs: a line that starts with "REQ-<n>:" defines one.
// The design lists its files under a "## Files" heading, one per list item,
// with the requirement IDs each file serves:
//     - `app/throttle.py` (create): the bucket [REQ-1, REQ-2]
// and optionally its interfaces under "## Interfaces". A test is linked to a
// requirement by its name: test_req_<n>_... (pytest names cannot hold '-').
//
// Everything is parsed here, on the server, from the exact text the reviewer
// approved, so the plan GateKeep checks against is the plan the human saw.

import { globMatch, hasGlob, normalizePath } from '../policy/glob.js'

const REQ_DEFINITION = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)?\[?(REQ-(\d+))\]?\s*[:.)\-–—]\s*(.+)$/i
const REQ_REF = /\bREQ-0*(\d+)\b/gi
const TEST_REF = /(?:^|[^a-z0-9])req[-_]?0*(\d+)(?![0-9])/gi
const REFUSAL = /^\s*NO_ACTIONABLE_FEATURE:/m
const HEADING = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/
const FILES_HEADING = /^(?:files|file plan|planned files|files to change)$/i
const INTERFACES_HEADING = /^interfaces?$/i

const reqId = (n) => `REQ-${Number(n)}`
const unique = (list) => [...new Set(list)]
const stripEmphasis = (s) => s.replace(/\*\*|__/g, '')

// Requirement IDs mentioned anywhere in a text, in order, once each.
export function requirementRefs(text) {
  return unique([...String(text ?? '').matchAll(REQ_REF)].map((m) => reqId(m[1])))
}

// The requirement IDs a test names (test_req_1_..., test_REQ2, req-12).
export function testRequirementIds(name) {
  return unique([...String(name ?? '').matchAll(TEST_REF)].map((m) => reqId(m[1])))
}

// { items: [{ id, text }] } or { items, error: 'requirements_ids_missing' |
// 'requirements_ids_duplicate', duplicates }. A requirements agent that found
// no real feature (NO_ACTIONABLE_FEATURE) needs no IDs: Gate 1 shows its answer.
export function parseRequirements(text) {
  const items = []
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = stripEmphasis(raw).match(REQ_DEFINITION)
    if (m) items.push({ id: reqId(m[2]), text: m[3].trim() })
  }
  const seen = new Set()
  const duplicates = unique(items.filter((r) => (seen.has(r.id) ? true : (seen.add(r.id), false))).map((r) => r.id))
  if (duplicates.length) return { items, error: 'requirements_ids_duplicate', duplicates }
  if (!items.length && !REFUSAL.test(String(text ?? ''))) return { items, error: 'requirements_ids_missing' }
  return { items }
}

const CHANGE_WORDS = [
  [/\b(create|created|new|add|added)\b/i, 'create'],
  [/\b(delete|deleted|remove|removed)\b/i, 'delete'],
]

function changeOf(rest) {
  for (const [re, change] of CHANGE_WORDS) if (re.test(rest)) return change
  return 'modify'
}

// The agent writes the plan, so a planned pattern must stay narrow: it starts
// with a plain folder or file name and has at most one '**'. '**', '*' or
// '**/*.py' would plan everything (and empty design enforcement), and stacked
// '**' could make matching slow (ECC review).
function badPlanPath(path) {
  const raw = String(path).replace(/\\/g, '/')
  if (!raw || raw.length > 300 || raw.startsWith('/') || /^[a-z]:\//i.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return true
  const parts = raw.split('/')
  if (parts.includes('..') || parts.some((p) => p.toLowerCase() === '.git')) return true
  if (!hasGlob(raw)) return false
  return hasGlob(parts[0]) || (raw.match(/\*\*/g) || []).length > 1
}

function itemPath(body) {
  const code = body.match(/`([^`]+)`/)
  if (code) return { path: code[1].trim(), rest: body.replace(code[0], ' ') }
  const [first = '', ...rest] = stripEmphasis(body).trim().split(/\s+/)
  return { path: first.replace(/[:,;]+$/, ''), rest: rest.join(' ') }
}

function planFromObject(design) {
  const files = []
  const add = (list, change) => {
    for (const item of Array.isArray(list) ? list : list ? [list] : []) {
      const path = typeof item === 'string' ? item : item?.path ?? item?.name
      if (typeof path === 'string' && path.trim()) {
        files.push({ path: normalizePath(path), change, reqs: requirementRefs(typeof item === 'string' ? '' : JSON.stringify(item)) })
      }
    }
  }
  add(design.files_to_create, 'create')
  add(design.files_to_modify, 'modify')
  return files.length ? { files, interfaces: [] } : null
}

// The structured plan of a design: { files: [{ path, change, reqs }],
// interfaces: [{ name, reqs }] }, null when the design lists no files, or
// { error: 'design_plan_bad_path', path } for a file outside the workspace.
export function parseDesignPlan(design) {
  if (design && typeof design === 'object' && !Array.isArray(design)) return planFromObject(design)
  if (typeof design !== 'string') return null
  const files = []
  const interfaces = []
  let section = null
  let level = 0
  for (const line of design.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(HEADING)
    if (heading) {
      const title = stripEmphasis(heading[2]).replace(/:$/, '').trim()
      if (FILES_HEADING.test(title)) { section = 'files'; level = heading[1].length; continue }
      if (INTERFACES_HEADING.test(title)) { section = 'interfaces'; level = heading[1].length; continue }
      if (section && heading[1].length <= level) section = null
      continue
    }
    const item = section && line.match(LIST_ITEM)
    if (!item) continue
    if (section === 'files') {
      const { path, rest } = itemPath(item[1])
      if (!path) continue
      if (badPlanPath(path)) return { error: 'design_plan_bad_path', path }
      files.push({ path: normalizePath(path), change: changeOf(rest), reqs: requirementRefs(rest) })
    } else {
      const code = item[1].match(/`([^`]+)`/)
      const name = code ? code[1].trim() : stripEmphasis(item[1]).split(':')[0].trim()
      if (name) interfaces.push({ name, reqs: requirementRefs(code ? item[1].replace(code[0], ' ') : item[1].slice(name.length)) })
    }
  }
  return files.length ? { files, interfaces } : null
}

// Why a design cannot be handed over, or null. requirements: the run's
// requirements text (the design may only point at requirements that exist).
export function designProblem(design, requirements) {
  const plan = parseDesignPlan(design)
  if (!plan) return { error: 'design_plan_missing' }
  if (plan.error) return plan
  const known = new Set(parseRequirements(requirements).items.map((r) => r.id))
  const refs = unique([...plan.files, ...plan.interfaces].flatMap((e) => e.reqs))
  const unknown = refs.filter((id) => !known.has(id))
  return unknown.length ? { error: 'design_unknown_requirement', ids: unknown } : null
}

// Does a planned entry cover a changed path? Plain paths must match exactly;
// entries with * or ? are patterns.
export function planCovers(entry, path) {
  return hasGlob(entry.path) ? globMatch(entry.path, path) : normalizePath(entry.path) === normalizePath(path)
}

function statusOf(tests) {
  const ran = tests.filter((t) => t.outcome !== 'skipped')
  if (!ran.length) return 'uncovered'
  return ran.some((t) => t.outcome === 'failed' || t.outcome === 'error') ? 'failing' : 'covered'
}

// The whole picture for Gate 3 (and the evidence bundle).
// files: changed files [{ path, status, add, rem }]; tests: the latest test
// run ({ cases }). Without a plan every changed file is undeclared (fail closed).
export function traceability({ requirements, design, files, tests } = {}) {
  const reqs = parseRequirements(requirements).items
  const parsed = parseDesignPlan(design)
  const plan = parsed && !parsed.error ? parsed : null
  const changed = (Array.isArray(files) ? files : []).map((f) => normalizePath(f.path)).filter(Boolean)
  const cases = Array.isArray(tests?.cases) ? tests.cases : []

  const planned = (plan?.files ?? []).map((e) => ({ ...e, changed: changed.filter((p) => planCovers(e, p)) }))
  const undeclared = changed.filter((p) => !(plan?.files ?? []).some((e) => planCovers(e, p)))
  const untouched = planned.filter((e) => !hasGlob(e.path) && !e.changed.length).map((e) => e.path)
  const caseIds = cases.map((c) => ({ c, ids: testRequirementIds(c.name) }))

  const requirementsOut = reqs.map(({ id, text }) => {
    const entries = planned.filter((e) => e.reqs.includes(id))
    const linked = caseIds.filter(({ ids }) => ids.includes(id))
      .map(({ c }) => ({ name: c.name, file: c.file, outcome: c.outcome, new: c.new }))
    return {
      id,
      text,
      planned: entries.map((e) => e.path),
      changed: unique(entries.flatMap((e) => e.changed)),
      tests: linked,
      status: statusOf(linked),
    }
  })

  const known = new Set(reqs.map((r) => r.id))
  const unknownRefs = [
    ...unique(planned.flatMap((e) => e.reqs).concat((plan?.interfaces ?? []).flatMap((i) => i.reqs)))
      .filter((id) => !known.has(id)).map((id) => ({ id, in: 'design' })),
    ...unique(caseIds.flatMap(({ ids }) => ids)).filter((id) => !known.has(id)).map((id) => ({ id, in: 'tests' })),
  ]
  const count = (s) => requirementsOut.filter((r) => r.status === s).length
  return {
    requirements: requirementsOut,
    plan,
    drift: { planned, undeclared, untouched },
    unknownRefs,
    summary: {
      requirements: requirementsOut.length,
      covered: count('covered'),
      failing: count('failing'),
      uncovered: count('uncovered'),
      undeclared: undeclared.length,
      untouched: untouched.length,
    },
  }
}
