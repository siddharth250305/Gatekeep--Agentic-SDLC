import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newDb } from 'pg-mem'
import { runSchema } from '../src/db.js'
import { createRun } from '../src/runs/service.js'
import { createApp } from '../src/app.js'

async function freshDb() {
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  await runSchema(pool)
  return pool
}

test('MCP HTTP flow: create session -> get session -> patch session -> end session -> stats', async () => {
  const db = await freshDb()
  await createRun(db, { runId: 'RUN-MCP-1', brief: 'MCP test run' })

  let broadcasts = []
  const broadcast = (msg) => broadcasts.push(msg)
  const app = createApp(db, broadcast)
  const server = app.listen(0)
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  try {
    // 1. Create session
    const res = await fetch(`${base}/mcp/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: 'mcp-sess-1',
        run_id: 'RUN-MCP-1',
        provider: 'claude',
        client: 'claude-code',
        model: 'claude-3-7-sonnet',
      }),
    })
    assert.equal(res.status, 201)
    const session = await res.json()
    assert.equal(session.session_id, 'mcp-sess-1')
    assert.equal(session.run_id, 'RUN-MCP-1')
    assert.equal(session.provider, 'claude')
    assert.equal(session.status, 'active')
    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].type, 'mcp.session.created')

    // 2. Get session by ID
    const got = await (await fetch(`${base}/mcp/sessions/mcp-sess-1`)).json()
    assert.equal(got.session_id, 'mcp-sess-1')

    // 3. Get sessions for run
    const byRun = await (await fetch(`${base}/mcp/sessions/run/RUN-MCP-1`)).json()
    assert.equal(byRun.length, 1)
    assert.equal(byRun[0].session_id, 'mcp-sess-1')

    // 4. Patch session with tool calls
    const patched = await (await fetch(`${base}/mcp/sessions/mcp-sess-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool_calls: 5,
        last_tool: 'apply_patch',
      }),
    })).json()
    assert.equal(patched.tool_calls, 5)
    assert.equal(patched.last_tool, 'apply_patch')

    // 5. Query stats
    const stats = await (await fetch(`${base}/mcp/stats`)).json()
    assert.equal(stats.total_sessions, 1)
    assert.equal(stats.active_sessions, 1)
    assert.equal(stats.total_tool_calls, 5)
    assert.equal(stats.sessions_by_provider.length, 1)
    assert.equal(stats.sessions_by_provider[0].provider, 'claude')

    // 6. End session
    const ended = await (await fetch(`${base}/mcp/sessions/mcp-sess-1/end`, {
      method: 'POST',
    })).json()
    assert.equal(ended.status, 'ended')
    assert.ok(ended.ended_at)
    assert.ok(broadcasts.some((b) => b.type === 'mcp.session.ended'))

    // 7. Verify active sessions list is empty now
    const activeList = await (await fetch(`${base}/mcp/sessions`)).json()
    assert.equal(activeList.length, 0)

    // 8. Error cases: 404 on missing run when creating session
    const missingRun = await fetch(`${base}/mcp/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'bad', run_id: 'RUN-DOES-NOT-EXIST' }),
    })
    assert.equal(missingRun.status, 404)

    // 9. Error case: 400 on missing fields
    const badBody = await fetch(`${base}/mcp/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(badBody.status, 400)
  } finally {
    server.close()
  }
})
