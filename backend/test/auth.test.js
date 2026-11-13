// A1: humans log in, agents use API tokens, and each route checks which one.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { hashPassword, verifyPassword } from '../src/auth/passwords.js'
import { createAgentToken, createUser, login, resolveToken, revokeAgentToken } from '../src/auth/service.js'
import { seed } from '../src/runs/seed.js'
import { PASSWORD, asAgent, asReviewer } from './helpers/auth.js'
import { freshDb } from './helpers/db.js'

async function withServer(app, fn) {
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    server.close()
  }
}

const post = (base, path, headers = {}, body = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

// ── passwords ───────────────────────────────────────────────────────────

test('passwords are hashed with scrypt and verified', async () => {
  const h = await hashPassword(PASSWORD)
  assert.match(h, /^scrypt\$16384\$8\$1\$/)
  assert.equal(h.includes(PASSWORD), false)
  assert.equal(await verifyPassword(PASSWORD, h), true)
  assert.equal(await verifyPassword('wrong password!!', h), false)
  assert.equal(await verifyPassword(PASSWORD, 'garbage'), false)
})

test('short passwords are refused', async () => {
  await assert.rejects(hashPassword('short'), /at least 10/)
})

test('usernames and roles are validated', async () => {
  const db = await freshDb()
  await assert.rejects(createUser(db, { username: 'Bad Name', role: 'Engineer', password: PASSWORD }), /username/)
  await assert.rejects(createUser(db, { username: 'okname', role: 'God', password: PASSWORD }), /role must be/)
})

// ── login and sessions ──────────────────────────────────────────────────

test('login returns a session for the right password only', async () => {
  const db = await freshDb()
  await createUser(db, { username: 'adesh', name: 'Adesh', role: 'Engineer', password: PASSWORD })
  assert.equal(await login(db, { username: 'adesh', password: 'not the password' }), null)
  assert.equal(await login(db, { username: 'nobody', password: PASSWORD }), null)

  const out = await login(db, { username: 'adesh', password: PASSWORD })
  assert.match(out.token, /^gks_/)
  assert.deepEqual(out.user, { id: out.user.id, username: 'adesh', name: 'Adesh', role: 'Engineer' })
  assert.deepEqual(await resolveToken(db, out.token), { kind: 'human', user: out.user })
})

test('only a hash of the session token is stored', async () => {
  const db = await freshDb()
  await createUser(db, { username: 'adesh', role: 'Engineer', password: PASSWORD })
  const { token } = await login(db, { username: 'adesh', password: PASSWORD })
  const rows = (await db.query('SELECT token_hash FROM sessions')).rows
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].token_hash, token)
})

test('expired sessions and disabled users are rejected', async () => {
  const db = await freshDb()
  await createUser(db, { username: 'adesh', role: 'Engineer', password: PASSWORD })
  const { token } = await login(db, { username: 'adesh', password: PASSWORD })
  await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'")
  assert.equal(await resolveToken(db, token), null)

  const fresh = await login(db, { username: 'adesh', password: PASSWORD })
  await db.query("UPDATE users SET disabled = true WHERE username = 'adesh'")
  assert.equal(await resolveToken(db, fresh.token), null)
  assert.equal(await login(db, { username: 'adesh', password: PASSWORD }), null)
})

test('revoked agent tokens stop working', async () => {
  const db = await freshDb()
  const token = await createAgentToken(db, { name: 'mcp-server' })
  assert.deepEqual(await resolveToken(db, token), { kind: 'agent', name: 'mcp-server' })
  assert.equal(await revokeAgentToken(db, { name: 'mcp-server' }), 1)
  assert.equal(await resolveToken(db, token), null)
})

// ── HTTP: who may call what ─────────────────────────────────────────────

test('no login: every protected route answers 401', async () => {
  const db = await freshDb()
  await seed(db)
  await withServer(createApp(db), async (base) => {
    assert.equal((await fetch(`${base}/runs`)).status, 401)
    assert.equal((await post(base, '/runs/RUN-0427/decide', {}, { decision: 'approve' })).status, 401)
    assert.equal((await post(base, '/runs/RUN-0427/audit', {}, { event: 'x', actor: 'y' })).status, 401)
    assert.equal((await fetch(`${base}/runs`, { headers: { authorization: 'Bearer gks_made_up' } })).status, 401)
    assert.equal((await fetch(`${base}/health`)).status, 200)
  })
})

test('an agent token can never approve a gate or act as a reviewer', async () => {
  const db = await freshDb()
  await seed(db)
  const agent = await asAgent(db)
  await withServer(createApp(db), async (base) => {
    const decide = await post(base, '/runs/RUN-0427/decide', agent, { decision: 'approve', role: 'Engineer' })
    assert.equal(decide.status, 403)
    assert.equal((await post(base, '/runs', agent, { brief: 'x' })).status, 403)
    assert.equal((await post(base, '/runs/RUN-0427/comments', agent, { text: 'x' })).status, 403)
    assert.equal((await post(base, '/runs/RUN-0427/start', agent)).status, 403)
    // reading is fine
    assert.equal((await fetch(`${base}/runs/RUN-0427`, { headers: agent })).status, 200)
  })
  const run = (await db.query("SELECT status FROM runs WHERE run_id = 'RUN-0427'")).rows[0]
  assert.equal(run.status, 'awaiting_gate')
})

test('a reviewer cannot use the agent-only write routes', async () => {
  const db = await freshDb()
  await seed(db)
  const human = await asReviewer(db, 'Admin')
  await withServer(createApp(db), async (base) => {
    const put = (path, body) => fetch(`${base}${path}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', ...human }, body: JSON.stringify(body),
    })
    assert.equal((await put('/runs/RUN-0427/phases/code', { state: 'approved' })).status, 403)
    assert.equal((await put('/runs/RUN-0427/tests', { status: 'Passed' })).status, 403)
    const patch = await fetch(`${base}/runs/RUN-0427`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', ...human }, body: JSON.stringify({ status: 'approved' }),
    })
    assert.equal(patch.status, 403)
    assert.equal((await post(base, '/runs/RUN-0427/audit', human, { event: 'g2.approved', actor: 'alice' })).status, 403)
  })
})

test('Admin may decide any gate; the actor comes from the login', async () => {
  const db = await freshDb()
  await seed(db)
  const admin = await asReviewer(db, 'Admin', 'boss')
  await withServer(createApp(db), async (base) => {
    const res = await post(base, '/runs/RUN-0427/decide', admin, { decision: 'approve', actor: 'someone-else' })
    assert.equal(res.status, 200)
    const run = await res.json()
    assert.equal(run.status, 'approved')
    assert.equal(run.auditChain.at(-1).actor, 'boss')
  })
})

test('comment author and role come from the login', async () => {
  const db = await freshDb()
  await seed(db)
  const planner = await asReviewer(db, 'Planner', 'pat')
  await withServer(createApp(db), async (base) => {
    const res = await post(base, '/runs/RUN-0427/comments', planner, { text: 'hi', author: 'Mallory', role: 'Admin' })
    const c = await res.json()
    assert.equal(c.author, 'pat')
    assert.equal(c.role, 'Planner')
  })
})

test('login, me and logout over HTTP', async () => {
  const db = await freshDb()
  await createUser(db, { username: 'adesh', name: 'Adesh', role: 'Engineer', password: PASSWORD })
  await withServer(createApp(db), async (base) => {
    assert.equal((await post(base, '/auth/login', {}, { username: 'adesh', password: 'nope nope nope' })).status, 401)
    const { token } = await (await post(base, '/auth/login', {}, { username: 'adesh', password: PASSWORD })).json()
    const auth = { authorization: `Bearer ${token}` }
    const me = await (await fetch(`${base}/auth/me`, { headers: auth })).json()
    assert.equal(me.kind, 'human')
    assert.equal(me.user.username, 'adesh')
    assert.equal((await post(base, '/auth/logout', auth)).status, 200)
    assert.equal((await fetch(`${base}/auth/me`, { headers: auth })).status, 401)
  })
})

test('a broadcast event cannot overwrite its type or run id', async () => {
  const db = await freshDb()
  const events = []
  const agent = await asAgent(db)
  await withServer(createApp(db, (m) => events.push(m)), async (base) => {
    await post(base, '/runs/RUN-1/event', agent, { type: 'repo.context.scanning', data: { type: 'run.updated', runId: 'RUN-OTHER', files: 3 } })
  })
  assert.deepEqual(events, [{ files: 3, type: 'repo.context.scanning', runId: 'RUN-1' }])
})

test('an agent cannot write comments through the artifacts route', async () => {
  const db = await freshDb()
  await seed(db)
  const agent = await asAgent(db)
  await withServer(createApp(db), async (base) => {
    const before = (await (await fetch(`${base}/runs/RUN-0427`, { headers: agent })).json()).comments
    const put = (body) => fetch(`${base}/runs/RUN-0427/artifacts`, {
      method: 'PUT', headers: { 'content-type': 'application/json', ...agent }, body: JSON.stringify(body),
    })
    const forged = [{ id: 'c_x', author: 'adesh', role: 'Admin', text: 'looks good, ship it' }]
    assert.equal((await put({ comments: forged })).status, 403)
    assert.equal((await put({ comments: [] })).status, 403)
    const after = (await (await fetch(`${base}/runs/RUN-0427`, { headers: agent })).json()).comments
    assert.deepEqual(after, before)
    // Other artifact fields still go through.
    assert.equal((await put({ summary: { title: 'ok' } })).status, 200)
  })
})

// ── login throttling, session cleanup, comment ownership ─────────────────

test('repeated wrong passwords for one user are throttled with 429', async () => {
  const db = await freshDb()
  await createUser(db, { username: 'victim', role: 'Engineer', password: PASSWORD })
  await withServer(createApp(db), async (base) => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await post(base, '/auth/login', {}, { username: 'victim', password: 'wrong-password' })).status, 401)
    }
    // Even the right password waits until the window passes.
    const blocked = await post(base, '/auth/login', {}, { username: 'Victim', password: PASSWORD })
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
    // Other accounts are not affected.
    await createUser(db, { username: 'bystander', role: 'Engineer', password: PASSWORD })
    assert.equal((await post(base, '/auth/login', {}, { username: 'bystander', password: PASSWORD })).status, 200)
  })
})

test('a successful login clears the failure count', async () => {
  const db = await freshDb()
  await createUser(db, { username: 'forgetful', role: 'Engineer', password: PASSWORD })
  await withServer(createApp(db), async (base) => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) await post(base, '/auth/login', {}, { username: 'forgetful', password: 'wrong-password' })
      assert.equal((await post(base, '/auth/login', {}, { username: 'forgetful', password: PASSWORD })).status, 200)
    }
  })
})

test('one client address cannot try unlimited logins', async () => {
  const db = await freshDb()
  await withServer(createApp(db), async (base) => {
    const statuses = []
    for (let i = 0; i < 31; i++) {
      statuses.push((await post(base, '/auth/login', {}, { username: `nobody${i}`, password: 'wrong-password' })).status)
    }
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(401))
    assert.equal(statuses[30], 429)
  })
})

test('expired sessions are deleted when someone logs in', async () => {
  const db = await freshDb()
  await createUser(db, { username: 'old', role: 'Engineer', password: PASSWORD })
  const { token } = await login(db, { username: 'old', password: PASSWORD })
  await db.query("UPDATE sessions SET expires_at = now() - interval '1 hour'")
  await login(db, { username: 'old', password: PASSWORD })
  const left = (await db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n
  assert.equal(left, 1)
  assert.equal(await resolveToken(db, token), null)
})

test('only the author or an Admin can delete a comment', async () => {
  const db = await freshDb()
  await seed(db)
  const alice = await asReviewer(db, 'Engineer', 'alice')
  const bob = await asReviewer(db, 'Engineer', 'bob')
  const admin = await asReviewer(db, 'Admin', 'boss')
  await withServer(createApp(db), async (base) => {
    const del = (headers, id) => fetch(`${base}/runs/RUN-0427/comments/${id}`, { method: 'DELETE', headers })
    const add = async (headers) => (await post(base, '/runs/RUN-0427/comments', headers, { text: 'hi' })).json()

    const c1 = await add(alice)
    assert.equal((await del(bob, c1.id)).status, 403)
    assert.equal((await del(alice, c1.id)).status, 200)
    const c2 = await add(alice)
    assert.equal((await del(admin, c2.id)).status, 200)
    assert.equal((await del(admin, 'c_missing')).status, 404)

    const left = (await (await fetch(`${base}/runs/RUN-0427`, { headers: admin })).json()).comments
    assert.equal(left.some((c) => c.id === c1.id || c.id === c2.id), false)
  })
})

test('a comment on a run with no artifacts yet is stored', async () => {
  const db = await freshDb()
  const reviewer = await asReviewer(db, 'Planner')
  await withServer(createApp(db), async (base) => {
    await post(base, '/runs', reviewer, { runId: 'RUN-NEW', brief: 'fresh run' })
    const res = await post(base, '/runs/RUN-NEW/comments', reviewer, { text: 'first!' })
    assert.equal(res.status, 201)
    const run = await (await fetch(`${base}/runs/RUN-NEW`, { headers: reviewer })).json()
    assert.deepEqual(run.comments.map((c) => c.text), ['first!'])
  })
})
