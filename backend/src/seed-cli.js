// One-shot seeder against the configured Postgres. Usage: npm run seed
import { pool, runSchema } from './db.js'
import { seed } from './runs/seed.js'

await runSchema(pool)
const n = await seed(pool)
console.log(`Seeded. ${n} runs in the database.`)
await pool.end()
