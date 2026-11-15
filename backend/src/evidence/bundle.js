// The evidence bundle of a finished run (I6): requirements, design, policy,
// traceability, the approved code fingerprint, the test run, every approval
// and the whole audit chain, signed with GateKeep's Ed25519 key. Anyone with
// the public key can check it offline (evidence/verify.js), so a CI job can
// make "GateKeep approved this exact code" a required check.
//
// The signing key is derived from GATEKEEP_AUDIT_KEY (HKDF), so there is no
// second secret to manage, and the HMAC audit key itself never leaves the
// server: the bundle carries the server's HMAC verification result, covered
// by the signature.

import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign } from 'node:crypto'
import { auditKey } from '../audit/chain.js'
import { governance } from '../policy/governance.js'
import { getRun, latestTestRun } from '../runs/service.js'
import { parseRequirements } from '../runs/trace.js'
import { FORMAT, MOVE_EVENTS, signedBytes } from './verify.js'

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410).
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function gatekeepPrivateKey() {
  const seed = Buffer.from(hkdfSync('sha256', auditKey(), 'gatekeep-evidence', 'ed25519-signing-key-v1', 32))
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

export function publicKeyPem(privateKey = gatekeepPrivateKey()) {
  return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
}

export function keyId(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

// Sign bundle content (any signature field is replaced).
export function signBundle(content, privateKey = gatekeepPrivateKey()) {
  const publicKey = publicKeyPem(privateKey)
  const { signature: _drop, ...rest } = content
  const unsigned = { ...rest, signer: { alg: 'Ed25519', keyId: keyId(publicKey), publicKey } }
  return { ...unsigned, signature: sign(null, signedBytes(unsigned), privateKey).toString('base64') }
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null)

// Build and sign the bundle of a finished run. Returns { bundle } or
// { error: 'not_found' | 'not_finished', step }.
export async function buildBundle(db, runId) {
  const run = await getRun(db, runId)
  if (!run) return { error: 'not_found' }
  if (run.step !== 'done') return { error: 'not_finished', step: run.step }
  const row = (await db.query('SELECT review_fingerprint FROM runs WHERE run_id = $1', [runId])).rows[0]
  const head = (await db.query('SELECT seq, hash, mac FROM audit_heads WHERE run_id = $1', [runId])).rows[0] ?? null
  const latest = await latestTestRun(db, runId)
  const events = run.auditChain.map((e) => ({
    seq: e.seq, event: e.event, actor: e.actor, payload: e.payload, createdAt: e.createdAt, prevHash: e.prevHash, hash: e.hash,
  }))
  const g3 = [...events].reverse().find((e) => e.event === 'g3.approved')
  const tests = latest
    ? {
        id: latest.id, status: latest.status, passed: latest.passed, failed: latest.failed, skipped: latest.skipped,
        total: latest.total, fingerprint: latest.fingerprint, at: iso(latest.created_at), cases: latest.cases ?? [],
      }
    : null
  const approvals = events.filter((e) => /^g[123]\.approved$/.test(e.event)).map((e) => ({
    gate: e.event.slice(0, 2),
    by: e.actor,
    at: e.createdAt,
    seq: e.seq,
    ...(e.payload?.approvals ? { approvers: e.payload.approvals.map((a) => a.username) } : {}),
  }))
  const content = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    run: { id: run.id, brief: run.brief, repo: run.repo, branch: run.branch, commit: run.commit, createdBy: run.createdBy, step: run.step },
    requirements: { text: run.requirements, items: parseRequirements(run.requirements).items },
    design: { text: run.design, plan: run.trace.plan },
    policy: run.policy,
    trace: run.trace,
    governance: governance({
      policy: run.policy, trace: run.trace, files: run.files, tests: latest, approvals: g3?.payload?.approvals ?? [],
      createdBy: run.createdBy,
    }),
    code: { fingerprint: row?.review_fingerprint ?? null, files: run.files ?? [] },
    tests,
    approvals,
    audit: {
      events,
      head: head ? { seq: Number(head.seq), hash: head.hash, mac: head.mac } : null,
      serverVerification: { valid: run.verify.valid, reason: run.verify.reason ?? null, brokenAt: run.verify.brokenAt ?? null },
    },
  }
  return { bundle: signBundle(content) }
}

// ── The Pull Request description ─────────────────────────────────────────

// Text in the PR description comes partly from the agent (requirements, test
// names, paths): escape it so it cannot @mention people, add links or HTML,
// or break the tables (ECC review).
const cell = (v) => String(v ?? '')
  .replace(/\r?\n|\r/g, ' ')
  .replace(/[\\`*_[\]#!~]/g, '\\$&')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '&#64;')
  .replace(/\|/g, '\\|')
const mono = (v) => `\`${String(v ?? '').replace(/[`\r\n]/g, '').replace(/\|/g, '\\|')}\``
const STATUS = { covered: 'Covered', failing: 'Failing', uncovered: '**Not covered**' }
// Only server-written events: moves, the policy record, the PR record.
const HISTORY = (e) => MOVE_EVENTS.has(e.event) || e.event === 'policy.recorded' || e.event === 'run.pr_created'

export const prBranch = (runId) => `gatekeep/${runId}`
export const evidencePath = (runId) => `.gatekeep/evidence/${runId}.json`

export function prTitle(bundle) {
  return `GateKeep ${bundle.run.id}: ${bundle.run.brief}`.slice(0, 250)
}

export function prMarkdown(bundle) {
  const { run, trace, tests, audit, code, policy, governance: gov } = bundle
  const lines = []
  const out = (s = '') => lines.push(s)
  out(`## GateKeep evidence for ${run.id}`)
  out()
  out('This change was planned, written and tested by an AI agent through GateKeep, and approved by people at all three gates. The full, signed record is in `' + evidencePath(run.id) + '`.')
  out()
  out(`**Brief:** ${cell(run.brief)}`)
  out()
  out('| | |')
  out('|---|---|')
  out(`| Asked for by | ${cell(run.createdBy)} |`)
  out(`| Code fingerprint | \`${code.fingerprint}\` |`)
  if (tests) out(`| Test run | ${tests.status}: ${tests.passed} passed, ${tests.failed} failed (\`${tests.id}\`) |`)
  out(`| Audit chain | ${audit.events.length} entries, head \`${audit.head?.hash ?? 'none'}\`, HMAC check ${audit.serverVerification.valid ? 'passed' : 'FAILED'} |`)
  out(`| Signed by | GateKeep key \`${bundle.signer?.keyId ?? ''}\` (Ed25519) |`)
  out()
  out('## Requirements coverage')
  out()
  if (trace.requirements.length) {
    out('| Requirement | Planned files | Tests | Status |')
    out('|---|---|---|---|')
    for (const r of trace.requirements) {
      const t = r.tests.map((c) => `${mono(c.name)} (${cell(c.outcome)})`).join('<br>') || 'none'
      out(`| **${r.id}** ${cell(r.text)} | ${r.planned.map(mono).join(', ') || 'none'} | ${t} | ${STATUS[r.status]} |`)
    }
  } else out('No requirement IDs were recorded for this run.')
  out()
  out('## Planned vs changed files')
  out()
  out('| File | Result |')
  out('|---|---|')
  for (const p of trace.drift.planned) out(`| ${mono(p.path)} | ${p.changed.length ? 'Changed as planned' : 'Planned, not changed'} |`)
  for (const p of trace.drift.undeclared) out(`| ${mono(p)} | **Not in the approved design** |`)
  out()
  out('## Project policy (gatekeep.yaml)')
  out()
  if (!policy || policy.status === 'none') out('The project has no gatekeep.yaml; the default rules applied (one Gate 3 approval).')
  else {
    out(`Status: ${policy.status} (sha256 \`${policy.sha256}\`).`)
    for (const r of gov?.triggered ?? []) out(`- Protected ${mono(r.path)} (${r.files.length} file(s)): ${r.approvals} approval(s)${r.reviewers.length ? `, reviewers ${cell(r.reviewers.join(', '))}` : ''}`)
  }
  out()
  out('## Approval history')
  out()
  out('| # | When (UTC) | Who | Event | Step | Note |')
  out('|---|---|---|---|---|---|')
  for (const e of audit.events.filter(HISTORY)) {
    const step = typeof e.payload?.to === 'string' ? `${e.payload.from ?? ''} → ${e.payload.to}` : ''
    const note = e.payload?.feedback || (e.payload?.evidence ? `approved ${e.payload.evidence.fingerprint.slice(0, 12)}…` : '')
      || (e.payload?.approvals ? `approvals: ${e.payload.approvals.map((a) => a.username).join(', ')}` : '')
      || (e.event === 'policy.recorded' ? `policy ${e.payload.status}` : '')
    out(`| ${e.seq} | ${cell(e.createdAt)} | ${cell(e.actor)} | ${mono(e.event)} | ${cell(step)} | ${cell(String(note).slice(0, 200))} |`)
  }
  const work = audit.events.filter((e) => !HISTORY(e)).length
  if (work) out(`\n${work} more entries (files written, tests run, tool refusals) are in the evidence file.`)
  out()
  out('## Verify')
  out()
  out('```')
  out(`node verify.js ${evidencePath(run.id)} --public-key gatekeep.pub.pem --tree .`)
  out('```')
  out('The public key is served at `GET /evidence/public-key` on the GateKeep server. Pin it in CI; never trust the key inside the bundle on its own.')
  return lines.join('\n')
}
