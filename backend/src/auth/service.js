// Accounts, sessions and agent tokens.
//
// Two kinds of caller:
//   human  - a reviewer who logged in with username + password. Gets a session
//            token (gks_...) that expires. Only humans can decide gates.
//   agent  - an agent service (MCP server, pipeline) holding an API token
//            (gka_...) made with `npm run token:create`. Agents submit work
//            but can never approve.
// Only SHA-256 hashes of tokens are stored, never the tokens themselves.

import { createHash, randomBytes } from 'node:crypto'
import { dummyVerify, hashPassword, verifyPassword } from './passwords.js'

export const ROLES = ['Planner', 'Engineer', 'Admin']
const SESSION_PREFIX = 'gks_'
const AGENT_PREFIX = 'gka_'

const sessionHours = () => Number(process.env.GATEKEEP_SESSION_HOURS) || 12
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const newToken = (prefix) => prefix + randomBytes(32).toString('base64url')

function publicUser(row) {
  return { id: Number(row.id), username: row.username, name: row.display_name, role: row.role }
}

export async function createUser(db, { username, name, role, password }) {
  if (typeof username !== 'string' || !/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw new Error('username must be 3-40 characters: lowercase letters, digits, ".", "_" or "-"')
  }
  if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(', ')}`)
  const displayName = (name || username).trim().slice(0, 80)
  const res = await db.query(
    `INSERT INTO users (username, display_name, role, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [username, displayName, role, await hashPassword(password)],
  )
  return publicUser(res.rows[0])
}

// Returns { token, expiresAt, user } or null for a wrong username/password.
export async function login(db, { username, password }) {
  const row = (await db.query('SELECT * FROM users WHERE username = $1', [String(username ?? '')])).rows[0]
  if (!row || row.disabled) return dummyVerify(password).then(() => null)
  if (!(await verifyPassword(password, row.password_hash))) return null

  // Expired sessions are useless; clear them out as new ones are made.
  await db.query('DELETE FROM sessions WHERE expires_at <= now()')

  const token = newToken(SESSION_PREFIX)
  const expiresAt = new Date(Date.now() + sessionHours() * 3600 * 1000)
  await db.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [sha256(token), row.id, expiresAt.toISOString()],
  )
  return { token, expiresAt: expiresAt.toISOString(), user: publicUser(row) }
}

export async function logout(db, token) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(String(token))])
}

export async function createAgentToken(db, { name }) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('token name is required')
  const token = newToken(AGENT_PREFIX)
  await db.query('INSERT INTO api_tokens (token_hash, name) VALUES ($1, $2)', [sha256(token), name.trim()])
  return token
}

export async function revokeAgentToken(db, { name }) {
  const res = await db.query(
    'UPDATE api_tokens SET revoked_at = now() WHERE name = $1 AND revoked_at IS NULL RETURNING name',
    [name],
  )
  return res.rows.length
}

// Who is calling? Returns { kind: 'human', user } | { kind: 'agent', name } | null.
export async function resolveToken(db, token) {
  if (typeof token !== 'string') return null
  if (token.startsWith(SESSION_PREFIX)) {
    const row = (await db.query(
      `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [sha256(token)],
    )).rows[0]
    if (!row || row.disabled || new Date(row.expires_at) <= new Date()) return null
    return { kind: 'human', user: publicUser(row) }
  }
  if (token.startsWith(AGENT_PREFIX)) {
    const row = (await db.query(
      'SELECT name FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256(token)],
    )).rows[0]
    return row ? { kind: 'agent', name: row.name } : null
  }
  return null
}

export async function countUsers(db) {
  return (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n
}
