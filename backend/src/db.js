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

// Run the schema against any pg-compatible pool (real Postgres or pg-mem).
export async function runSchema(db) {
  const here = dirname(fileURLToPath(import.meta.url))
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8')
  await db.query(sql)
}
