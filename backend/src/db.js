// PostgreSQL connection pool + schema bootstrap.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://gatekeep:gatekeep@localhost:5432/gatekeep',
})

// Marks a client that currently has an open transaction from withTransaction.
const IN_TX = Symbol('gatekeep.inTransaction')

export function inTransaction(db) {
  return db?.[IN_TX] === true
}

// Run fn(client) inside one transaction on a single connection. Commits when fn
// resolves, rolls back when it throws. When db is already a client inside
// withTransaction, fn simply joins that transaction.
export async function withTransaction(db, fn) {
  if (inTransaction(db)) return fn(db)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    client[IN_TX] = true
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    delete client[IN_TX]
    client.release()
  }
}

// Run the schema against any pg-compatible pool (real Postgres or pg-mem).
export async function runSchema(db) {
  const here = dirname(fileURLToPath(import.meta.url))
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8')
  await db.query(sql)
}
