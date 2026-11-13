import { Router } from 'express'
import { bearerToken, requireAny, requireHuman } from '../auth/middleware.js'
import { createLimiter } from '../auth/rateLimit.js'
import { login, logout } from '../auth/service.js'
import { wsTickets } from '../auth/tickets.js'

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const WINDOW_MS = 15 * 60 * 1000

export function authRouter(db, {
  // Wrong passwords allowed per username, and login attempts per client
  // address, in each 15-minute window.
  maxFailuresPerUser = 5,
  maxAttemptsPerAddress = 30,
  tickets = wsTickets,
} = {}) {
  const r = Router()
  const perUser = createLimiter({ max: maxFailuresPerUser, windowMs: WINDOW_MS })
  const perAddress = createLimiter({ max: maxAttemptsPerAddress, windowMs: WINDOW_MS })

  r.post('/auth/login', wrap(async (req, res) => {
    const { username, password } = req.body || {}
    const userKey = `user:${String(username ?? '').toLowerCase()}`
    const addressKey = `ip:${req.ip}`
    const wait = Math.max(perUser.retryAfter(userKey), perAddress.retryAfter(addressKey))
    if (wait > 0) {
      res.set('Retry-After', String(wait))
      return res.status(429).json({ error: `too many login attempts, try again in ${Math.ceil(wait / 60)} min` })
    }

    perAddress.hit(addressKey)
    const out = await login(db, { username, password })
    if (!out) {
      perUser.hit(userKey)
      return res.status(401).json({ error: 'wrong username or password' })
    }
    perUser.reset(userKey)
    res.json(out)
  }))

  r.post('/auth/logout', requireAny, wrap(async (req, res) => {
    await logout(db, bearerToken(req))
    res.json({ ok: true })
  }))

  r.get('/auth/me', requireAny, (req, res) => res.json(req.principal))

  // A single-use, short-lived ticket for opening the live-update WebSocket,
  // so the session token never appears in a URL. Agents use a bearer header.
  r.post('/auth/ws-ticket', requireHuman, (req, res) => {
    res.json({ ticket: tickets.issue(bearerToken(req)), expiresInMs: tickets.ttlMs })
  })

  return r
}
