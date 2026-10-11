import { Router } from 'express'
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export function mcpRouter(db, broadcast = () => {}) {
  const r = Router()

  r.post('/mcp/sessions', wrap(async (req, res) => {
    const { session_id, run_id, provider = 'unknown', client = 'unknown', model } = req.body

    if (!session_id || !run_id) {
      return res.status(400).json({ error: 'session_id and run_id are required' })
    }

    const runCheck = await db.query('SELECT 1 FROM runs WHERE run_id = $1', [run_id])
    if (runCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' })
    }

    const result = await db.query(
      `INSERT INTO mcp_sessions (session_id, run_id, provider, client, model)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [session_id, run_id, provider, client, model]
    )

    broadcast({ type: 'mcp.session.created', runId: run_id, sessionId: session_id })
    res.status(201).json(result.rows[0])
  }))

  r.get('/mcp/sessions', wrap(async (req, res) => {
    const result = await db.query(`SELECT * FROM mcp_sessions WHERE status = 'active' ORDER BY created_at DESC`)
    res.json(result.rows)
  }))

  r.get('/mcp/sessions/:sessionId', wrap(async (req, res) => {
    const { sessionId } = req.params
    const result = await db.query(`SELECT * FROM mcp_sessions WHERE session_id = $1`, [sessionId])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'MCP session not found' })
    }
    res.json(result.rows[0])
  }))

  r.get('/mcp/sessions/run/:runId', wrap(async (req, res) => {
    const { runId } = req.params
    const result = await db.query(`SELECT * FROM mcp_sessions WHERE run_id = $1 ORDER BY created_at DESC`, [runId])
    res.json(result.rows)
  }))

  r.patch('/mcp/sessions/:sessionId', wrap(async (req, res) => {
    const { sessionId } = req.params
    const { tool_calls, last_tool, last_tool_at, status, ended_at, model } = req.body

    const updates = []
    const values = []
    let idx = 1

    if (tool_calls !== undefined) {
      updates.push(`tool_calls = $${idx++}`)
      values.push(tool_calls)
    }
    if (last_tool !== undefined) {
      updates.push(`last_tool = $${idx++}`)
      values.push(last_tool)
    }
    if (last_tool_at !== undefined) {
      updates.push(`last_tool_at = $${idx++}`)
      values.push(last_tool_at)
    }
    if (status !== undefined) {
      updates.push(`status = $${idx++}`)
      values.push(status)
    }
    if (ended_at !== undefined) {
      updates.push(`ended_at = $${idx++}`)
      values.push(ended_at)
    }
    if (model !== undefined) {
      updates.push(`model = $${idx++}`)
      values.push(model)
    }

    if (updates.length === 0) {
      const result = await db.query(`SELECT * FROM mcp_sessions WHERE session_id = $1`, [sessionId])
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'MCP session not found' })
      }
      return res.json(result.rows[0])
    }

    values.push(sessionId)
    const query = `
      UPDATE mcp_sessions
      SET ${updates.join(', ')}
      WHERE session_id = $${idx}
      RETURNING *
    `

    const result = await db.query(query, values)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'MCP session not found' })
    }

    broadcast({ type: 'mcp.session.updated', sessionId })
    res.json(result.rows[0])
  }))

  r.post('/mcp/sessions/:sessionId/end', wrap(async (req, res) => {
    const { sessionId } = req.params
    const result = await db.query(
      `UPDATE mcp_sessions SET status = 'ended', ended_at = now() WHERE session_id = $1 RETURNING *`,
      [sessionId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'MCP session not found' })
    }

    broadcast({ type: 'mcp.session.ended', sessionId })
    res.json(result.rows[0])
  }))

  r.get('/mcp/stats', wrap(async (req, res) => {
    const totalSessions = await db.query('SELECT COUNT(*) as count FROM mcp_sessions')
    const activeSessions = await db.query(`SELECT COUNT(*) as count FROM mcp_sessions WHERE status = 'active'`)
    const toolCalls = await db.query('SELECT SUM(tool_calls) as total_calls FROM mcp_sessions')
    const byProvider = await db.query('SELECT provider, COUNT(*) as count FROM mcp_sessions GROUP BY provider')

    res.json({
      total_sessions: parseInt(totalSessions.rows[0].count, 10),
      active_sessions: parseInt(activeSessions.rows[0].count, 10),
      total_tool_calls: parseInt(toolCalls.rows[0].total_calls || 0, 10),
      sessions_by_provider: byProvider.rows
    })
  }))

  return r
}
