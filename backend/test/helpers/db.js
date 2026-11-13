// Test database factory.
//
// Default: an in-memory pg-mem database (fast, no setup). pg-mem accepts
// BEGIN / ROLLBACK / FOR UPDATE but does not enforce them, so it cannot prove
// that locking or rollback works.
//
// With TEST_DATABASE_URL set (npm run test:pg), every call gets a fresh,
// throwaway schema in a real Postgres, dropped when the test file finishes.
// Tests that need real transaction behaviour use { skip: !realPg }.
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import { after } from 'node:test'
import pg from 'pg'
import { newDb } from 'pg-mem'
import { runSchema } from '../../src/db.js'

const url = process.env.TEST_DATABASE_URL
// Never reach a real agent pipeline from tests (one may be running on :8077).
// A port that was just freed (nothing listens there) makes /decide take its
// local path; tests that need a pipeline start a mock and set PIPELINE_URL.
// (Not a low port such as 1: fetch refuses those as "bad ports".)
process.env.PIPELINE_URL ??= `http://127.0.0.1:${await closedPort()}`

async function closedPort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
export const realPg = Boolean(url)
export const NEEDS_PG = realPg ? false : 'needs a real Postgres (npm run test:pg)'

const cleanups = []
after(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

export async function freshDb() {
  if (!realPg) {
    const mem = newDb()
    const { Pool } = mem.adapters.createPg()
    const pool = new Pool()
    await runSchema(pool)
    return pool
  }
  const schema = `t_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  await admin.end()

  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 10 })
  cleanups.push(async () => {
    await pool.end()
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    await c.query(`DROP SCHEMA ${schema} CASCADE`)
    await c.end()
  })
  await runSchema(pool)
  return pool
}
