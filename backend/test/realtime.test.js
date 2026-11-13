// A4: the live-update WebSocket requires a login and an allowed origin.
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import WebSocket from 'ws'
import { allowedOrigins, createApp } from '../src/app.js'
import { createRealtimeHub } from '../src/realtime.js'
import { logout } from '../src/auth/service.js'
import { asAgent, asReviewer } from './helpers/auth.js'
import { freshDb } from './helpers/db.js'

async function withHub(db, fn) {
  const hub = createRealtimeHub(db, { uiOrigins: allowedOrigins('http://localhost:5180') })
  const server = http.createServer(createApp(db, hub.broadcast))
  hub.attach(server)
  await new Promise((r) => server.listen(0, r))
  const url = `ws://127.0.0.1:${server.address().port}`
  try {
    await fn(url, hub)
  } finally {
    for (const c of hub.clients) c.terminate()
    await new Promise((r) => server.close(r))
  }
}

// Resolves with the HTTP status of a refused handshake, or 'open'.
function connect(url, options = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options)
    ws.on('open', () => resolve({ status: 'open', ws }))
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }))
    ws.on('error', () => resolve({ status: 'error' }))
  })
}

const tokenOf = (headers) => headers.authorization.slice(7)

test('no token: the handshake is refused with 401', async () => {
  const db = await freshDb()
  await withHub(db, async (url) => {
    assert.equal((await connect(url)).status, 401)
    assert.equal((await connect(`${url}/?token=gks_nope`)).status, 401)
  })
})

test('a website that is not the dashboard is refused even with a token', async () => {
  const db = await freshDb()
  const human = await asReviewer(db)
  await withHub(db, async (url) => {
    const res = await connect(`${url}/?token=${tokenOf(human)}`, { origin: 'https://evil.example' })
    assert.equal(res.status, 403)
  })
})

test('a logged-in dashboard receives broadcasts', async () => {
  const db = await freshDb()
  const human = await asReviewer(db)
  await withHub(db, async (url, hub) => {
    const { status, ws } = await connect(`${url}/?token=${tokenOf(human)}`, { origin: 'http://localhost:5180' })
    assert.equal(status, 'open')
    const got = new Promise((r) => ws.once('message', (m) => r(JSON.parse(m))))
    hub.broadcast({ type: 'run.updated', runId: 'RUN-1' })
    assert.deepEqual(await got, { type: 'run.updated', runId: 'RUN-1' })
  })
})

test('an agent service can connect with a bearer header', async () => {
  const db = await freshDb()
  const agent = await asAgent(db)
  await withHub(db, async (url) => {
    assert.equal((await connect(url, { headers: agent })).status, 'open')
  })
})

test('a socket is closed once its session logs out', async () => {
  const db = await freshDb()
  const human = await asReviewer(db)
  await withHub(db, async (url, hub) => {
    const { status, ws } = await connect(`${url}/?token=${tokenOf(human)}`, { origin: 'http://localhost:5180' })
    assert.equal(status, 'open')
    const closed = new Promise((r) => ws.once('close', (code) => r(code)))
    await logout(db, tokenOf(human))
    await hub.recheck()
    assert.equal(await closed, 4001)
    // The server forgets the socket once its side of the close completes.
    for (let i = 0; i < 50 && hub.clients.size > 0; i++) await new Promise((r) => setTimeout(r, 10))
    assert.equal(hub.clients.size, 0)
  })
})

test('a socket with a valid session stays open after a recheck', async () => {
  const db = await freshDb()
  const human = await asReviewer(db)
  await withHub(db, async (url, hub) => {
    const { ws } = await connect(`${url}/?token=${tokenOf(human)}`, { origin: 'http://localhost:5180' })
    await hub.recheck()
    assert.equal(ws.readyState, WebSocket.OPEN)
  })
})
