import http from 'node:http'
import { createApp } from './app.js'
import { createRealtimeHub } from './realtime.js'
import { pool, runSchema } from './db.js'
import { seed } from './runs/seed.js'
import { countUsers } from './auth/service.js'
import { auditKey } from './audit/chain.js'
import { recoverPipelineRuns } from './runs/pipeline.js'

// The audit diary is stamped with an HMAC key kept outside the database (E1).
// Without it nothing could be recorded, so refuse to start (fail closed).
try {
  auditKey()
} catch (err) {
  console.error(`${err.message}. Set it to a random secret of at least 32 characters`)
  console.error('(scripts/dev.sh setup writes one to .gatekeep.local.env).')
  process.exit(1)
}

await runSchema(pool)

if ((await countUsers(pool)) === 0) {
  console.warn('No reviewer accounts yet. Create one with:')
  console.warn('  npm run user:create -- --username <name> --role Admin')
}

// Seed demo runs only when explicitly requested via SEED_DEMO=true
if (process.env.SEED_DEMO === 'true') {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM runs')
  if (rows[0].n === 0) {
    await seed(pool)
    console.log('seeded demo runs (RUN-0427 / 0426 / 0425)')
  }
}

// Live run updates over WebSocket (login required, see realtime.js).
const hub = createRealtimeHub(pool)
const app = createApp(pool, hub.broadcast)
const server = http.createServer(app)
hub.attach(server)

const port = process.env.PORT || 4040
server.listen(port, () => {
  console.log(`GateKeep API + WebSocket on http://localhost:${port}`)
  // The pipeline keeps no run state: after a restart, wake it for every run
  // it was working on, so none is left waiting at a robot step (G9).
  recoverPipelineRuns(pool)
    .then(({ woken, failed }) => {
      if (woken.length) console.log(`woke the pipeline for ${woken.join(', ')}`)
      if (failed.length) console.warn(`the pipeline did not accept ${failed.join(', ')} (not running, or refused); it picks them up when it starts`)
    })
    .catch((err) => console.warn(`pipeline recovery skipped: ${err.message}`))
})
