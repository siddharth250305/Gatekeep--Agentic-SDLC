// Milestone 6, I6: a finished run exports a signed evidence bundle that anyone
// can verify offline with GateKeep's public key (CLI and CI check), and a Pull
// Request with the full approval history in its description.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createApp } from '../src/app.js'
import { publicKeyPem, signBundle } from '../src/evidence/bundle.js'
import { treeFingerprint, verifyBundle } from '../src/evidence/verify.js'
import { asAgent, asReviewer } from './helpers/auth.js'
import { freshDb } from './helpers/db.js'
import { FP } from './helpers/evidence.js'

const run = promisify(execFile)
const VERIFY = fileURLToPath(new URL('../src/evidence/verify.js', import.meta.url))
const REQS = 'REQ-1: Limit each merchant to 60 calls a minute.'
const DESIGN = '## Files\n- `app/throttle.py` (create) [REQ-1]'
const TEST_RUN = {
  fingerprint: FP, status: 'Passed', passed: 1, failed: 0, skipped: 0, total: 1, duration_ms: 500, output: '1 passed',
  cases: [{ name: 'test_req_1_limit', file: 'tests/test_t.py', outcome: 'passed', new: true }], missing_existing: [],
}

async function mockPipeline(respond) {
  const calls = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      calls.push({ url: req.url, body: JSON.parse(raw || '{}') })
      const { status = 200, json = {} } = respond()
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() }
}

async function setup({ finish = true } = {}) {
  const db = await freshDb()
  const server = createApp(db).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, headers = {}, body) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { parsed = text }
    return { status: res.status, body: parsed }
  }
  const requester = await asReviewer(db, 'Engineer', 'rae')
  const planner = await asReviewer(db, 'Planner', 'pat')
  const eli = await asReviewer(db, 'Engineer', 'eli')
  const erin = await asReviewer(db, 'Engineer', 'erin')
  const agent = await asAgent(db, 'mcp')
  const R = '/runs/RUN-E'
  await call('POST', '/runs', requester, { runId: 'RUN-E', brief: 'rate limit', repo: 'acme/shop', branch: 'main' })
  await call('PUT', `${R}/policy`, agent, { found: false })
  await call('POST', `${R}/actions/submit_requirements`, agent, { artifacts: { requirements: REQS } })
  await call('POST', `${R}/decide`, planner, { decision: 'approve' })
  await call('POST', `${R}/actions/submit_design`, agent, { artifacts: { design: DESIGN } })
  await call('POST', `${R}/decide`, eli, { decision: 'approve' })
  await call('POST', `${R}/test-runs`, agent, TEST_RUN)
  await call('POST', `${R}/actions/request_review`, agent, {
    fingerprint: FP, artifacts: { files: [{ path: 'app/throttle.py', status: 'A', add: 9, rem: 0 }], diff: [], summary: { headline: 'ok' } },
  })
  if (finish) assert.equal((await call('POST', `${R}/decide`, erin, { decision: 'approve' })).body.step, 'done')
  return { db, call, R, requester, eli, erin, agent, close: () => server.close() }
}

const tmp = () => mkdtempSync(join(tmpdir(), 'gk-evidence-'))
// Computed independently (agents/tests/test_m6_policy.py has the same constant).
const EXPECTED_WITH_NESTED = 'c55a8d8579bfe7a56d6d3ecebc2f76f27c9adcb5e8c806f8f96ed73c3d7ba56a'

test('only a finished run exports evidence (fail closed, I6)', async () => {
  const ctx = await setup({ finish: false })
  try {
    const out = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    assert.equal(out.status, 409)
    assert.equal(out.body.reason, 'not_finished')
  } finally { ctx.close() }
})

test('the evidence bundle holds the whole story of the run, signed (I6)', async () => {
  const ctx = await setup()
  try {
    const { status, body: b } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    assert.equal(status, 200)
    assert.equal(b.format, 'gatekeep-evidence/1')
    assert.equal(b.run.id, 'RUN-E')
    assert.equal(b.run.createdBy, 'rae')
    assert.deepEqual(b.requirements.items.map((r) => r.id), ['REQ-1'])
    assert.deepEqual(b.design.plan.files.map((f) => f.path), ['app/throttle.py'])
    assert.equal(b.policy.status, 'none')
    assert.equal(b.code.fingerprint, FP)
    assert.equal(b.tests.status, 'Passed')
    assert.equal(b.tests.fingerprint, FP)
    assert.equal(b.trace.requirements[0].status, 'covered')
    const events = b.audit.events.map((e) => e.event)
    for (const e of ['run.created', 'g1.approved', 'g2.approved', 'code.review_requested', 'g3.approved']) assert.ok(events.includes(e), e)
    assert.equal(b.audit.head.seq, b.audit.events.length)
    assert.equal(b.audit.serverVerification.valid, true)
    assert.deepEqual(b.approvals.map((a) => [a.gate, a.by]), [['g1', 'pat'], ['g2', 'eli'], ['g3', 'erin']])
    assert.equal(b.signer.alg, 'Ed25519')
    assert.match(b.signature, /^[A-Za-z0-9+/=]+$/)
  } finally { ctx.close() }
})

test('the public key is published, and an external check passes with it (I6)', async () => {
  const ctx = await setup()
  try {
    const key = await ctx.call('GET', '/evidence/public-key')
    assert.equal(key.status, 200, 'no login needed for a public key')
    assert.match(key.body.publicKey, /BEGIN PUBLIC KEY/)
    const { body: bundle } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    assert.equal(bundle.signer.publicKey, key.body.publicKey)
    const result = verifyBundle(bundle, { publicKey: key.body.publicKey })
    assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => !c.ok)))
    assert.deepEqual(result.checks.map((c) => c.name), [
      'signature', 'signer_key', 'chain_links', 'server_hmac', 'gates_in_order', 'human_approvals', 'approved_code', 'tests_passed', 'team_rules',
    ])
  } finally { ctx.close() }
})

test('any change to a signed bundle is detected (I6)', async () => {
  const ctx = await setup()
  try {
    const { body: bundle } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    const publicKey = publicKeyPem()
    const failed = (b, opts = { publicKey }) => verifyBundle(b, opts).checks.filter((c) => !c.ok).map((c) => c.name)

    const edited = structuredClone(bundle)
    edited.requirements.text = 'REQ-1: anything goes'
    assert.deepEqual(failed(edited), ['signature'])

    const dropped = structuredClone(bundle)
    dropped.audit.events.splice(2, 1)
    assert.ok(failed(dropped).includes('chain_links'))

    // Signed by someone else's key: the signature is fine, the key is not GateKeep's.
    const { generateKeyPairSync } = await import('node:crypto')
    const other = generateKeyPairSync('ed25519')
    const forged = signBundle({ ...structuredClone(bundle), signature: undefined }, other.privateKey)
    assert.deepEqual(failed(forged), ['signer_key'])

    // No pinned key: the check refuses to trust the key the bundle brought along.
    assert.deepEqual(failed(bundle, {}), ['signer_key'])
  } finally { ctx.close() }
})

test('even a correctly signed bundle fails if the history is not a legitimate pass (I6)', async () => {
  const ctx = await setup()
  try {
    const { body: bundle } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    const publicKey = publicKeyPem()
    const resigned = (mutate) => {
      const b = structuredClone(bundle)
      mutate(b)
      return verifyBundle(signBundle({ ...b, signature: undefined }), { publicKey }).checks.filter((c) => !c.ok).map((c) => c.name)
    }
    const g3 = (b) => b.audit.events.find((e) => e.event === 'g3.approved')
    assert.deepEqual(resigned((b) => { g3(b).actor = 'agent:mcp' }), ['human_approvals'])
    assert.deepEqual(resigned((b) => { g3(b).actor = 'rae' }), ['human_approvals'], 'the requester approved')
    assert.deepEqual(resigned((b) => { b.tests.status = 'Failed' }), ['tests_passed'])
    assert.deepEqual(resigned((b) => { b.code.fingerprint = 'e'.repeat(64) }), ['approved_code'])
    assert.deepEqual(resigned((b) => { b.audit.serverVerification = { valid: false, reason: 'hash_mismatch' } }), ['server_hmac'])
    assert.deepEqual(resigned((b) => { g3(b).payload.from = 'code' }), ['gates_in_order'])
  } finally { ctx.close() }
})

test('the verify CLI is the CI check: exit 0 only for a valid bundle with the pinned key (I6)', async () => {
  const ctx = await setup()
  try {
    const { body: bundle } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    const dir = tmp()
    writeFileSync(join(dir, 'key.pem'), publicKeyPem())
    writeFileSync(join(dir, 'good.json'), JSON.stringify(bundle))
    const ok = await run(process.execPath, [VERIFY, join(dir, 'good.json'), '--public-key', join(dir, 'key.pem')])
    assert.match(ok.stdout, /PASS/)

    const bad = structuredClone(bundle)
    bad.tests.passed = 99
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad))
    await assert.rejects(run(process.execPath, [VERIFY, join(dir, 'bad.json'), '--public-key', join(dir, 'key.pem')]), (err) => {
      assert.equal(err.code, 1)
      assert.match(err.stdout, /FAIL.*signature/s)
      return true
    })
    await assert.rejects(run(process.execPath, [VERIFY, join(dir, 'good.json')]), (err) => err.code === 1)
  } finally { ctx.close() }
})

test('a robot work event that claims a step move neither breaks the check nor reaches the PR history (review)', async () => {
  const ctx = await setup()
  try {
    const spoof = { from: 'done', to: 'req', feedback: 'SPOOFED-BY-AGENT', approvals: [{ username: 'mallory' }] }
    assert.equal((await ctx.call('POST', `${ctx.R}/audit`, ctx.agent, { event: 'mcp.note', payload: spoof })).status, 201)
    const { body: bundle } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    const result = verifyBundle(bundle, { publicKey: publicKeyPem() })
    assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => !c.ok)))
    const { body: pr } = await ctx.call('GET', `${ctx.R}/pr`, ctx.eli)
    assert.ok(!pr.body.includes('SPOOFED-BY-AGENT'))
  } finally { ctx.close() }
})

test('the check also requires the team rules to have been met (review)', async () => {
  const ctx = await setup()
  try {
    const { body: bundle } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    assert.ok(verifyBundle(bundle, { publicKey: publicKeyPem() }).checks.some((c) => c.name === 'team_rules' && c.ok))
    const b = structuredClone(bundle)
    b.governance.complete = false
    const failed = verifyBundle(signBundle({ ...b, signature: undefined }), { publicKey: publicKeyPem() }).checks.filter((c) => !c.ok).map((c) => c.name)
    assert.deepEqual(failed, ['team_rules'])
  } finally { ctx.close() }
})

test('robot-written text cannot mention people or inject markup into the PR description (review)', async () => {
  const db = await freshDb()
  const server = createApp(db).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, headers = {}, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  try {
    const rae = await asReviewer(db, 'Engineer', 'rae2'); const pat = await asReviewer(db, 'Planner', 'pat2')
    const eli = await asReviewer(db, 'Engineer', 'eli2'); const erin = await asReviewer(db, 'Engineer', 'erin2'); const agent = await asAgent(db, 'mcp2')
    const R = '/runs/RUN-X'
    await call('POST', '/runs', rae, { runId: 'RUN-X', brief: 'x' })
    await call('PUT', `${R}/policy`, agent, { found: false })
    await call('POST', `${R}/actions/submit_requirements`, agent, { artifacts: { requirements: 'REQ-1: ping @octocat <img src=x onerror=alert(1)> [click](https://evil.example)' } })
    await call('POST', `${R}/decide`, pat, { decision: 'approve' })
    await call('POST', `${R}/actions/submit_design`, agent, { artifacts: { design: '## Files\n- `app/x.py` (create) [REQ-1]' } })
    await call('POST', `${R}/decide`, eli, { decision: 'approve' })
    await call('POST', `${R}/test-runs`, agent, TEST_RUN)
    await call('POST', `${R}/actions/request_review`, agent, { fingerprint: FP, artifacts: { files: [{ path: 'app/x.py', status: 'A', add: 1, rem: 0 }], diff: [], summary: {} } })
    await call('POST', `${R}/decide`, erin, { decision: 'approve' })
    const { body } = await call('GET', `${R}/pr`, eli)
    assert.ok(!body.body.includes('@octocat'), 'no live @mention')
    assert.ok(!body.body.includes('<img'), 'no raw HTML')
    assert.ok(!body.body.includes('[click](https://evil.example)'), 'no live link')
  } finally { server.close() }
})

test('only an Engineer or Admin can open the Pull Request (review)', async () => {
  const ctx = await setup()
  try {
    const planner = await asReviewer(ctx.db, 'Planner', 'pat-pr')
    const out = await ctx.call('POST', `${ctx.R}/pull-request`, planner, {})
    assert.equal(out.status, 403)
  } finally { ctx.close() }
})

test('the code fingerprint is computed the same way as the Python side (I6, B7)', () => {
  const dir = tmp()
  const put = (rel, data) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), data) }
  put('a.py', 'print(1)\n')
  put('pkg/b.txt', 'hé\n')
  put('pkg/sub/c.md', '# c\n')
  put('__pycache__/x.pyc', 'junk')
  put('.gatekeep/evidence/r.json', '{}')
  put('.git/HEAD', 'ref: refs/heads/main\n')
  // Same constant as agents/tests/test_m6_policy.py (computed independently).
  assert.equal(treeFingerprint(dir), 'c3564b6308bf05e4b1af33e023d0176703d87939c77b406ae2f6da2298ed8f87')
  // Review: only the top-level .gatekeep/ (the evidence) is left out; a nested
  // one is code like any other. Paths sort by UTF-8 bytes, like Python.
  put('pkg/.gatekeep/payload.py', 'evil = 1\n')
  put('\u{1F600}.txt', 'a\n')
  put('\uFFFD.txt', 'b\n')
  assert.equal(treeFingerprint(dir), EXPECTED_WITH_NESTED)
})

test('the CI check can also prove the checked-out code is the approved code (I6)', async () => {
  const ctx = await setup()
  try {
    const { body: bundle } = await ctx.call('GET', `${ctx.R}/evidence`, ctx.eli)
    const dir = tmp()
    writeFileSync(join(dir, 'key.pem'), publicKeyPem())
    writeFileSync(join(dir, 'b.json'), JSON.stringify(bundle))
    const tree = join(dir, 'tree')
    mkdirSync(tree)
    writeFileSync(join(tree, 'other.py'), 'x = 1\n')
    await assert.rejects(
      run(process.execPath, [VERIFY, join(dir, 'b.json'), '--public-key', join(dir, 'key.pem'), '--tree', tree]),
      (err) => err.code === 1 && /tree/.test(err.stdout),
    )
  } finally { ctx.close() }
})

test('the Pull Request description carries the full approval history (I6)', async () => {
  const ctx = await setup()
  try {
    const { status, body } = await ctx.call('GET', `${ctx.R}/pr`, ctx.eli)
    assert.equal(status, 200)
    assert.equal(body.title, 'GateKeep RUN-E: rate limit')
    assert.equal(body.branch, 'gatekeep/RUN-E')
    const md = body.body
    assert.match(md, /## Approval history/)
    for (const who of ['rae', 'pat', 'eli', 'erin', 'agent:mcp']) assert.ok(md.includes(who), who)
    assert.match(md, /g1\.approved/)
    assert.match(md, /g3\.approved/)
    assert.match(md, /REQ-1/)
    assert.match(md, /test_req_1_limit/)
    assert.ok(md.includes(FP))
    assert.match(md, /verify\.js .*--public-key/)
  } finally { ctx.close() }
})

test('creating the Pull Request goes through the agent service and is recorded once (I6)', async () => {
  const ctx = await setup()
  const pipeline = await mockPipeline(() => ({ json: { url: 'https://github.com/acme/shop/pull/7', number: 7, branch: 'gatekeep/RUN-E' } }))
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = pipeline.url
  try {
    assert.equal((await ctx.call('POST', `${ctx.R}/pull-request`, ctx.agent, {})).status, 403, 'a person asks for the PR')
    const out = await ctx.call('POST', `${ctx.R}/pull-request`, ctx.eli, {})
    assert.equal(out.status, 201)
    assert.equal(out.body.url, 'https://github.com/acme/shop/pull/7')
    assert.equal(pipeline.calls.length, 1)
    const sent = pipeline.calls[0]
    assert.equal(sent.url, '/pipeline/RUN-E/pull-request')
    assert.equal(sent.body.repo, 'acme/shop')
    assert.equal(sent.body.base, 'main')
    assert.equal(sent.body.evidence.code.fingerprint, FP)
    assert.match(sent.body.body, /Approval history/)
    const { body: run } = await ctx.call('GET', ctx.R, ctx.eli)
    const entry = run.auditChain.find((e) => e.event === 'run.pr_created')
    assert.equal(entry.actor, 'eli')
    assert.equal(entry.payload.url, 'https://github.com/acme/shop/pull/7')
    assert.equal(run.verified, true)
    const again = await ctx.call('POST', `${ctx.R}/pull-request`, ctx.eli, {})
    assert.equal(again.status, 409)
    assert.equal(again.body.reason, 'pr_exists')
    assert.equal(pipeline.calls.length, 1)
  } finally {
    process.env.PIPELINE_URL = saved
    pipeline.close()
    ctx.close()
  }
})

test('a refused or unreachable agent service creates no PR record (I6)', async () => {
  const ctx = await setup()
  const pipeline = await mockPipeline(() => ({ status: 409, json: { error: 'the code changed since approval', reason: 'code_changed' } }))
  const saved = process.env.PIPELINE_URL
  process.env.PIPELINE_URL = pipeline.url
  try {
    const out = await ctx.call('POST', `${ctx.R}/pull-request`, ctx.eli, {})
    assert.equal(out.status, 409)
    assert.equal(out.body.reason, 'code_changed')
    process.env.PIPELINE_URL = saved // nothing listens there (helpers/db.js)
    assert.equal((await ctx.call('POST', `${ctx.R}/pull-request`, ctx.eli, {})).status, 502)
    const { body: run } = await ctx.call('GET', ctx.R, ctx.eli)
    assert.equal(run.auditChain.some((e) => e.event === 'run.pr_created'), false)
  } finally {
    process.env.PIPELINE_URL = saved
    pipeline.close()
    ctx.close()
  }
})

test('the signing key comes from the audit key, so it needs no extra secret (I6)', () => {
  const saved = process.env.GATEKEEP_AUDIT_KEY
  try {
    const a = publicKeyPem()
    process.env.GATEKEEP_AUDIT_KEY = 'another-audit-key-0123456789abcdef0123'
    assert.notEqual(publicKeyPem(), a)
    delete process.env.GATEKEEP_AUDIT_KEY
    assert.throws(() => publicKeyPem(), /GATEKEEP_AUDIT_KEY/)
  } finally {
    process.env.GATEKEEP_AUDIT_KEY = saved
  }
})
