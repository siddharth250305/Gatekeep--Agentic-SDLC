import http from 'node:http'
import { WebSocketServer } from 'ws'
import { createApp } from './app.js'
import { pool, runSchema } from './db.js'
import { seed } from './runs/seed.js'

await runSchema(pool)

// Seed demo runs only when explicitly requested via SEED_DEMO=true
if (process.env.SEED_DEMO === 'true') {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM runs')
  if (rows[0].n === 0) {
    await seed(pool)
    console.log('seeded demo runs (RUN-0427 / 0426 / 0425)')
  }
}

// WebSocket hub for live run progression.
const clients = new Set()
function broadcast(msg) {
  const s = JSON.stringify(msg)
  for (const c of clients) if (c.readyState === 1) c.send(s)
}

const app = createApp(pool, broadcast)
const server = http.createServer(app)
const wss = new WebSocketServer({ server })
wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
})

const port = process.env.PORT || 4000
server.listen(port, () => {
  console.log(`GateKeep API + WebSocket on http://localhost:${port}`)
})
