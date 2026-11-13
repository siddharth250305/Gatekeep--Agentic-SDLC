// Agent service tokens (MCP server, pipeline). They can submit work but can
// never approve a gate.
//   npm run token:create -- --name mcp-server     prints the token ONCE
//   npm run token:revoke -- --name mcp-server
import { parseArgs } from 'node:util'
import { pool, runSchema } from '../db.js'
import { createAgentToken, revokeAgentToken } from '../auth/service.js'

const { positionals, values } = parseArgs({ allowPositionals: true, options: { name: { type: 'string' } } })
const action = positionals[0]
if (!['create', 'revoke'].includes(action) || !values.name) {
  console.error('usage: npm run token:create -- --name <name>   |   npm run token:revoke -- --name <name>')
  process.exit(2)
}

try {
  await runSchema(pool)
  if (action === 'create') {
    const token = await createAgentToken(pool, { name: values.name })
    console.log(`agent token "${values.name}" (shown once, store it as GATEKEEP_API_TOKEN):`)
    console.log(token)
  } else {
    const n = await revokeAgentToken(pool, { name: values.name })
    console.log(n ? `revoked ${n} token(s) named "${values.name}"` : `no active token named "${values.name}"`)
  }
} catch (err) {
  console.error(`error: ${err.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
