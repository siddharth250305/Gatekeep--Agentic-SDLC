// Express guards. Every route except /health and /auth/login declares who may
// call it: requireHuman, requireAgent, or requireAny.

import { resolveToken } from './service.js'

export function bearerToken(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

// Attaches req.principal (or null). Never rejects by itself.
export function authenticate(db) {
  return async (req, _res, next) => {
    try {
      req.principal = await resolveToken(db, bearerToken(req))
      next()
    } catch (err) {
      next(err)
    }
  }
}

function guard(allowed, message) {
  return (req, res, next) => {
    if (!req.principal) return res.status(401).json({ error: 'login required' })
    if (!allowed.includes(req.principal.kind)) return res.status(403).json({ error: message })
    next()
  }
}

// Gate decisions, comments, starting runs: a logged-in reviewer only.
export const requireHuman = guard(['human'], 'only a logged-in reviewer can do this')
// Writes coming from the agent services (phases, tests, artifacts, events).
export const requireAgent = guard(['agent'], 'only an agent service token can do this')
// Read-only views.
export const requireAny = guard(['human', 'agent'], 'forbidden')

// A logged-in reviewer with the Admin role.
export function requireAdmin(req, res, next) {
  requireHuman(req, res, () => {
    if (req.principal.user.role !== 'Admin') return res.status(403).json({ error: 'only an Admin can do this' })
    next()
  })
}

// Display name recorded in the audit log for the caller.
export function actorName(principal) {
  if (!principal) return 'anonymous'
  return principal.kind === 'human' ? principal.user.username : `agent:${principal.name}`
}
