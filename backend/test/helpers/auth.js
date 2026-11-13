// Test identities: a logged-in reviewer and an agent service token.
import { createAgentToken, createUser, login } from '../../src/auth/service.js'

let n = 0
export const PASSWORD = 'correct horse battery'

// Authorization header for a reviewer with the given role.
export async function asReviewer(db, role = 'Engineer', username = `rev${++n}-${role.toLowerCase()}`) {
  await createUser(db, { username, name: username, role, password: PASSWORD })
  const { token } = await login(db, { username, password: PASSWORD })
  return { authorization: `Bearer ${token}` }
}

// Authorization header for an agent service.
export async function asAgent(db, name = `agent${++n}`) {
  return { authorization: `Bearer ${await createAgentToken(db, { name })}` }
}
