#!/usr/bin/env node
// Verify a GateKeep evidence bundle (I6), offline, with GateKeep's public key.
// This file has no dependencies beyond Node itself, so a CI job can copy it
// and run it as the "GateKeep" required check:
//
//   node verify.js .gatekeep/evidence/RUN-1.json --public-key gatekeep.pub.pem [--tree .]
//
// Exit 0 and "PASS" only when every check passes; otherwise exit 1 and "FAIL".
//
// What it proves:
//   signature        the bundle was signed by the key it names, and not changed since
//   signer_key       that key is the GateKeep key you pinned (--public-key)
//   chain_links      the audit entries form one unbroken chain up to the sealed head
//   server_hmac      GateKeep's own HMAC check of the chain passed when it exported
//                    (the HMAC key never leaves the server; the signature covers this result)
//   gates_in_order   the run went through the steps in order and ended at Done
//   human_approvals  every gate approval was made by a person, never the agent,
//                    and the person who asked for the work did not approve the code
//   approved_code    Gate 3 approved this exact code fingerprint and this test run
//   tests_passed     that test run passed
//   team_rules       the project's Gate 3 rules (approvals, reviewers, gatekeep.yaml) were met
//   tree (optional)  the checked-out code (--tree) is exactly the approved code

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FORMAT = 'gatekeep-evidence/1'
const GENESIS = '0'.repeat(64)
// The one skip rule for "what counts as the code" (agents/app/fingerprint.py):
// these folders at any depth, and .gatekeep (the evidence) only at the top.
export const SKIP_DIRS = new Set(['.git', '__pycache__', '.pytest_cache'])
export const TOP_SKIP_DIRS = new Set(['.gatekeep'])
// The audit events that move a run (written only by the backend state
// machine). Work events an agent records can carry any payload, so they are
// never read as moves (ECC review).
export const MOVE_EVENTS = new Set([
  'run.created', 'requirements.submitted', 'design.submitted', 'code.review_requested',
  'g1.approved', 'g1.rejected', 'g2.approved', 'g2.rejected', 'g3.approved', 'g3.rejected', 'g3.approval_recorded',
  'run.cancelled',
])
const ROBOT_EVENTS = new Set(['requirements.submitted', 'design.submitted', 'code.review_requested'])
const HUMAN_EVENTS = /^(g[123]\.(approved|rejected|approval_recorded)|run\.cancelled)$/

// Deterministic JSON: object keys sorted at every level. What is signed.
export function canonicalJson(value) {
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canon(v[k])]))
    }
    return v
  }
  return JSON.stringify(canon(value))
}

// The bytes a signature covers: the bundle without its signature.
export function signedBytes(bundle) {
  const { signature, ...rest } = bundle
  return Buffer.from(canonicalJson(rest), 'utf8')
}

const samePem = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.replace(/\s+/g, '') === b.replace(/\s+/g, '')

// SHA-256 over every file's path and contents (and every shortcut's target),
// in path order: the same fingerprint the agent side computes (B7).
export function treeFingerprint(dir) {
  const entries = []
  const walk = (here) => {
    for (const name of readdirSync(here)) {
      const full = join(here, name)
      const rel = relative(dir, full).split(sep).join('/')
      const st = lstatSync(full)
      if (st.isSymbolicLink()) entries.push([rel, 'L', Buffer.from(readlinkSync(full))])
      else if (st.isDirectory()) { if (!SKIP_DIRS.has(name) && !(here === dir && TOP_SKIP_DIRS.has(name))) walk(full) }
      else if (st.isFile()) entries.push([rel, 'F', readFileSync(full)])
    }
  }
  walk(dir)
  // UTF-8 byte order = Python's code-point order (UTF-16 order differs for emoji).
  entries.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])))
  const h = createHash('sha256')
  for (const [rel, kind, data] of entries) {
    h.update(`${kind}\0${rel}\0${createHash('sha256').update(data).digest('hex')}\n`)
  }
  return h.digest('hex')
}

function check(name, fn) {
  try {
    const detail = fn()
    return { name, ok: detail === true || typeof detail === 'string' ? true : Boolean(detail), detail: typeof detail === 'string' ? detail : undefined }
  } catch (err) {
    return { name, ok: false, detail: err.message }
  }
}

const fail = (msg) => { throw new Error(msg) }
const isHuman = (actor) => typeof actor === 'string' && actor !== '' && !actor.startsWith('agent:') && actor !== 'system'

// Verify a bundle. publicKey: the pinned GateKeep public key (PEM). tree: a
// directory whose code must be the approved code. Returns { ok, checks }.
export function verifyBundle(bundle, { publicKey, tree } = {}) {
  const b = bundle && typeof bundle === 'object' ? bundle : {}
  const events = Array.isArray(b.audit?.events) ? b.audit.events : []
  const g3 = [...events].reverse().find((e) => e.event === 'g3.approved')

  const checks = [
    check('signature', () => {
      if (b.format !== FORMAT) fail(`unknown format ${b.format}`)
      if (b.signer?.alg !== 'Ed25519' || typeof b.signature !== 'string') fail('no Ed25519 signature')
      const key = createPublicKey(b.signer.publicKey)
      return verifySignature(null, signedBytes(b), key, Buffer.from(b.signature, 'base64')) || fail('signature does not match the content')
    }),
    check('signer_key', () => {
      if (!publicKey) fail('no GateKeep public key was pinned (--public-key); the key inside the bundle is not trusted on its own')
      return samePem(b.signer?.publicKey, publicKey) || fail('signed by a key that is not the pinned GateKeep key')
    }),
    check('chain_links', () => {
      if (!events.length) fail('no audit entries')
      events.forEach((e, i) => {
        if (e.seq !== i + 1) fail(`entry ${i + 1} has seq ${e.seq}`)
        const prev = i === 0 ? GENESIS : events[i - 1].hash
        if (e.prevHash !== prev) fail(`entry ${e.seq} does not link to the one before it`)
      })
      const last = events.at(-1)
      if (b.audit?.head?.seq !== last.seq || b.audit?.head?.hash !== last.hash) fail('the sealed head is not the last entry')
      return `${events.length} entries`
    }),
    check('server_hmac', () => b.audit?.serverVerification?.valid === true
      || fail(`GateKeep's HMAC check failed: ${b.audit?.serverVerification?.reason || 'unknown'}`)),
    check('gates_in_order', () => {
      let step = null
      for (const e of events) {
        const to = e.payload?.to
        if (!MOVE_EVENTS.has(e.event) || typeof to !== 'string') continue
        if (e.event === 'run.created') { step = to; continue }
        if (e.payload.from !== step) fail(`${e.event} (seq ${e.seq}) moves from '${e.payload.from}' but the run was at '${step}'`)
        step = to
      }
      if (step !== 'done') fail(`the run ended at '${step}', not done`)
      for (const gate of ['g1', 'g2', 'g3']) {
        if (!events.some((e) => e.event === `${gate}.approved` && e.payload?.from === gate)) fail(`no ${gate} approval`)
      }
      return true
    }),
    check('human_approvals', () => {
      for (const e of events) {
        if (HUMAN_EVENTS.test(e.event) && !isHuman(e.actor)) fail(`${e.event} (seq ${e.seq}) was made by ${e.actor}`)
        if (ROBOT_EVENTS.has(e.event) && isHuman(e.actor)) fail(`${e.event} (seq ${e.seq}) claims a person did the agent's step`)
      }
      if (!g3) fail('no Gate 3 approval')
      const approvers = new Set([g3.actor, ...(g3.payload?.approvals || []).map((a) => a.username)])
      if (b.run?.createdBy && approvers.has(b.run.createdBy)) fail(`the requester ${b.run.createdBy} approved the code`)
      return `Gate 3 approved by ${[...approvers].join(', ')}`
    }),
    check('approved_code', () => {
      const fp = b.code?.fingerprint
      if (!/^[0-9a-f]{64}$/.test(fp || '')) fail('no code fingerprint')
      if (g3?.payload?.evidence?.fingerprint !== fp) fail('Gate 3 approved a different fingerprint')
      if (b.tests?.fingerprint !== fp) fail('the test run was on different code')
      if (g3?.payload?.evidence?.testRun !== b.tests?.id) fail('Gate 3 approved a different test run')
      const review = [...events].reverse().find((e) => e.event === 'code.review_requested')
      if (review?.payload?.fingerprint !== fp) fail('the code handed over for review has a different fingerprint')
      return fp
    }),
    check('tests_passed', () => {
      const t = b.tests || {}
      return (t.status === 'Passed' && t.failed === 0 && t.passed > 0) || fail(`tests: ${t.status}, ${t.passed} passed, ${t.failed} failed`)
    }),
    check('team_rules', () => {
      const g = b.governance
      if (g?.complete === true) return true
      const open = (g?.requirements || []).filter((r) => !r.satisfied).map((r) => r.label)
      return fail(`Gate 3 rules not met: ${[...(g?.blocking || []).map((x) => x.message), ...open].join('; ') || 'no governance record'}`)
    }),
  ]
  if (tree) {
    checks.push(check('tree', () => {
      const fp = treeFingerprint(tree)
      return fp === b.code?.fingerprint || fail(`the code in ${tree} (${fp.slice(0, 12)}…) is not the approved code`)
    }))
  }
  return { ok: checks.every((c) => c.ok), checks }
}

function main(argv) {
  const args = { files: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--public-key') args.publicKey = argv[++i]
    else if (argv[i] === '--tree') args.tree = argv[++i]
    else args.files.push(argv[i])
  }
  if (!args.files.length) {
    console.log('usage: verify.js <bundle.json>... --public-key <gatekeep.pub.pem> [--tree <dir>]')
    return 1
  }
  let publicKey
  try {
    publicKey = args.publicKey ? readFileSync(args.publicKey, 'utf8') : undefined
  } catch (err) {
    console.log(`FAIL cannot read the public key: ${err.message}`)
    return 1
  }
  let ok = true
  for (const file of args.files) {
    let bundle
    try {
      bundle = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      console.log(`FAIL ${file}: not a readable bundle (${err.message})`)
      ok = false
      continue
    }
    const result = verifyBundle(bundle, { publicKey, tree: args.tree })
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${file} (${bundle.run?.id ?? 'unknown run'})`)
    for (const c of result.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`)
    ok &&= result.ok
  }
  return ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2))
}
