import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendEvent, getChain, verifyRun, tamperEvent } from '../src/audit/service.js'
import { createApp } from '../src/app.js'
import { freshDb } from './helpers/db.js'
import { asAgent, asReviewer } from './helpers/auth.js'


test('append builds a valid per-run chain', async () => {
  const db = await freshDb()
  await appendEvent(db, { runId: 'RUN-1', event: 'run.created', actor: 'ml-priya', payload: { brief: 'x' } })
  await appendEvent(db, { runId: 'RUN-1', event: 'requirements.approved', actor: 'ml-priya' })
  await appendEvent(db, { runId: 'RUN-1', event: 'design.approved', actor: 'o-lindqvist' })

  const chain = await getChain(db, 'RUN-1')
  assert.equal(chain.length, 3)
  assert.deepEqual(chain.map((e) => e.seq), [1, 2, 3])
  assert.equal(chain[0].prevHash, '0'.repeat(64)) // genesis
  assert.equal(chain[1].prevHash, chain[0].hash) // linked
  assert.equal(chain[2].prevHash, chain[1].hash)

  assert.deepEqual(await verifyRun(db, 'RUN-1'), { runId: 'RUN-1', valid: true, length: 3 })
})

test('a real DB mutation is detected by verify', async () => {
  const db = await freshDb()
  await appendEvent(db, { runId: 'RUN-2', event: 'run.created', actor: 'a' })
  await appendEvent(db, { runId: 'RUN-2', event: 'design.approved', actor: 'b', payload: { file: 'ok.py' } })
  await appendEvent(db, { runId: 'RUN-2', event: 'coding.completed', actor: 'c' })

  assert.equal((await verifyRun(db, 'RUN-2')).valid, true)

  // Real UPDATE of a past event's payload, hash left untouched.
  const tampered = await tamperEvent(db, 'RUN-2', 2, { file: 'backdoor.py' })
  assert.equal(tampered.payload.file, 'backdoor.py')

  const result = await verifyRun(db, 'RUN-2')
  assert.equal(result.valid, false)
  assert.equal(result.brokenAt, 2)
  assert.equal(result.reason, 'hash_mismatch')
})

test('chains are isolated per run', async () => {
  const db = await freshDb()
  await appendEvent(db, { runId: 'A', event: 'run.created', actor: 'x' })
  await appendEvent(db, { runId: 'B', event: 'run.created', actor: 'y' })
  const a = await getChain(db, 'A')
  const b = await getChain(db, 'B')
  assert.equal(a[0].seq, 1)
  assert.equal(b[0].seq, 1) // B starts its own chain at genesis
  assert.equal(a[0].prevHash, '0'.repeat(64))
  assert.equal(b[0].prevHash, '0'.repeat(64))
})

test('HTTP flow: append -> verify ok -> tamper -> verify broken', async () => {
  const db = await freshDb()
  const app = createApp(db, () => {}, { demoMode: true })
  const agent = await asAgent(db)
  const human = await asReviewer(db)
  const server = app.listen(0)
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  try {
    for (const ev of [
      { event: 'mcp.session.created' },
      { event: 'mcp.file.written', payload: { file: 'throttle.py' } },
    ]) {
      const res = await fetch(`${base}/runs/RUN-9/audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...agent },
        body: JSON.stringify(ev),
      })
      assert.equal(res.status, 201)
    }

    let v = await (await fetch(`${base}/runs/RUN-9/audit/verify`, { method: 'POST', headers: human })).json()
    assert.equal(v.valid, true)

    const tamper = (headers) => fetch(`${base}/runs/RUN-9/audit/2/tamper`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ payload: { file: 'backdoor.py' } }),
    })
    // The demo tamper is Admin-only, even in demo mode.
    assert.equal((await tamper(human)).status, 403)
    assert.equal((await tamper(await asReviewer(db, 'Admin'))).status, 200)

    v = await (await fetch(`${base}/runs/RUN-9/audit/verify`, { method: 'POST', headers: human })).json()
    assert.equal(v.valid, false)
    assert.equal(v.brokenAt, 2)
  } finally {
    server.close()
  }
})
