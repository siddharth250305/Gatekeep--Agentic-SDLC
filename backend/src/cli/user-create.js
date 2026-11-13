// Create a reviewer account.
//   npm run user:create -- --username adesh --name "Adesh S" --role Admin
// The password is read from GATEKEEP_PASSWORD, or asked for without echo.
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { pool, runSchema } from '../db.js'
import { ROLES, createUser } from '../auth/service.js'

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question)
    // readline echoes what is typed to its output stream; give it one that
    // discards everything, so the password never appears on screen.
    const muted = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true })
    let answered = false
    rl.on('close', () => { if (!answered) resolve('') }) // no terminal input: fail with a clear error
    rl.question('', (answer) => { answered = true; rl.close(); process.stdout.write('\n'); resolve(answer) })
  })
}

const { values } = parseArgs({
  options: { username: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } },
})
if (!values.username || !values.role) {
  console.error(`usage: npm run user:create -- --username <name> --role <${ROLES.join('|')}> [--name "Display Name"]`)
  process.exit(2)
}

try {
  const password = process.env.GATEKEEP_PASSWORD || await askHidden('Password (min 10 chars): ')
  await runSchema(pool)
  const user = await createUser(pool, { username: values.username, name: values.name, role: values.role, password })
  console.log(`created ${user.role} "${user.username}"`)
} catch (err) {
  console.error(`error: ${err.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
