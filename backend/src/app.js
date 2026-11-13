import express from 'express'
import { authenticate } from './auth/middleware.js'
import { auditRouter } from './routes/audit.js'
import { authRouter } from './routes/auth.js'
import { mcpRouter } from './routes/mcp.js'
import { runsRouter } from './routes/runs.js'

// Browsers may only call the API from the dashboard's own origin(s).
// Comma-separated list, e.g. "http://localhost:5180,https://gatekeep.example".
const DEFAULT_UI_ORIGINS = 'http://localhost:5180,http://127.0.0.1:5180'

export function allowedOrigins(value = process.env.GATEKEEP_UI_ORIGINS) {
  return new Set((value || DEFAULT_UI_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean))
}

// Build the Express app around an injected pg-compatible pool (real Postgres in
// prod, pg-mem in tests) and a broadcast fn for live WebSocket updates.
//
// options.demoMode mounts demo-only routes (the audit tamper endpoint). It is
// off unless GATEKEEP_DEMO_MODE=1, so a production deployment never exposes it.
export function createApp(db, broadcast = () => {}, {
  demoMode = process.env.GATEKEEP_DEMO_MODE === '1',
  uiOrigins = allowedOrigins(),
} = {}) {
  const app = express()
  app.use(express.json())

  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && uiOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
      res.header('Vary', 'Origin')
      res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
      res.header('Access-Control-Allow-Headers', 'content-type, authorization')
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  app.get('/health', (_req, res) => res.json({ ok: true, demoMode }))

  // Who is calling (req.principal). Each route then declares who may call it.
  app.use(authenticate(db))
  app.use('/', authRouter(db))
  app.use('/', runsRouter(db, broadcast))
  app.use('/', auditRouter(db, broadcast, { demoMode }))
  app.use('/', mcpRouter(db, broadcast))

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(400).json({ error: err.message || 'bad request' })
  })

  return app
}
