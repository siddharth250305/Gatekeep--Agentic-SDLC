import express from 'express'
import { auditRouter } from './routes/audit.js'
import { mcpRouter } from './routes/mcp.js'
import { runsRouter } from './routes/runs.js'

// Build the Express app around an injected pg-compatible pool (real Postgres in
// prod, pg-mem in tests) and a broadcast fn for live WebSocket updates.
export function createApp(db, broadcast = () => {}) {
  const app = express()
  app.use(express.json())

  // Permissive CORS for the Vite dev frontend.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'content-type')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/', runsRouter(db, broadcast))
  app.use('/', auditRouter(db, broadcast))
  app.use('/', mcpRouter(db, broadcast))

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(400).json({ error: err.message || 'bad request' })
  })

  return app
}
