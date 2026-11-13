// Milestone 0 hardening: CORS allowlist (A3), demo-only tamper route (E3),
// audit field validation (E5).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newDb } from 'pg-mem'
import { runSchema } from '../src/db.js'
import { appendEvent, verifyRun } from '../src/audit/service.js'
import { allowedOrigins, createApp } from '../src/app.js'

async function freshDb() {
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  await runSchema(pool)
  return pool
}

async function withServer(app, fn) {
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    server.close()
  }
}

// ── A3: CORS ────────────────────────────────────────────────────────────

test('CORS: the dashboard origin is allowed, including DELETE', async () => {
  const app = createApp(await freshDb(), () => {}, { uiOrigins: allowedOrigins('http://localhost:5180') })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/runs`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5180' } })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5180')
    assert.match(res.headers.get('access-control-allow-methods'), /DELETE/)
  })
})

test('CORS: any other website gets no CORS headers', async () => {
  const app = createApp(await freshDb(), () => {}, { uiOrigins: allowedOrigins('http://localhost:5180') })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/runs`, { headers: { origin: 'https://evil.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })
})

test('CORS: allowed origins come from a comma-separated list', () => {
  assert.deepEqual([...allowedOrigins(' http://a:1 , http://b:2 ')], ['http://a:1', 'http://b:2'])
  assert.ok(allowedOrigins(undefined).has('http://localhost:5180'))
})

// ── E3: tamper route only in demo mode ──────────────────────────────────

test('tamper route is not mounted outside demo mode', async () => {
  const db = await freshDb()
  await appendEvent(db, { runId: 'RUN-1', event: 'run.created', actor: 'a' })
  await appendEvent(db, { runId: 'RUN-1', event: 'g1.approved', actor: 'b' })
  await withServer(createApp(db, () => {}, { demoMode: false }), async (base) => {
    const res = await fetch(`${base}/runs/RUN-1/audit/2/tamper`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { x: 1 } }),
    })
    assert.equal(res.status, 404)
    const health = await (await fetch(`${base}/health`)).json()
    assert.equal(health.demoMode, false)
  })
  assert.equal((await verifyRun(db, 'RUN-1')).valid, true)
})

// ── E5: only values that round-trip through TEXT columns ────────────────

for (const [label, fields, message] of [
  ['numeric event', { event: 123, actor: 'a' }, /event must be a non-empty string/],
  ['object actor', { event: 'e', actor: { name: 'x' } }, /actor must be a non-empty string/],
  ['empty actor', { event: 'e', actor: '  ' }, /actor must be a non-empty string/],
  ['array payload', { event: 'e', actor: 'a', payload: [1] }, /payload must be a JSON object/],
  ['__proto__ in payload', { event: 'e', actor: 'a', payload: JSON.parse('{"a":{"__proto__":{"x":1}}}') }, /__proto__/],
  ['numeric createdAt', { event: 'e', actor: 'a', createdAt: 1700000000 }, /createdAt/],
  ['garbage createdAt', { event: 'e', actor: 'a', createdAt: 'yesterday-ish' }, /createdAt/],
]) {
  test(`appendEvent rejects ${label}`, async () => {
    const db = await freshDb()
    await assert.rejects(appendEvent(db, { runId: 'RUN-1', ...fields }), message)
  })
}

test('a rejected bad event over HTTP leaves the chain valid', async () => {
  const db = await freshDb()
  await appendEvent(db, { runId: 'RUN-7', event: 'run.created', actor: 'a' })
  await withServer(createApp(db), async (base) => {
    const res = await fetch(`${base}/runs/RUN-7/audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 123, actor: 'x' }),
    })
    assert.equal(res.status, 400)
  })
  // Before E5 this event was hashed as a number, stored as "123", and the
  // chain reported hash_mismatch forever.
  assert.deepEqual(await verifyRun(db, 'RUN-7'), { runId: 'RUN-7', valid: true, length: 1 })
})
