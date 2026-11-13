// WebSocket hub for live run updates.
//
// Connecting requires a valid login and, for browsers, an allowed Origin.
// Browsers cannot set headers on a WebSocket, so they pass ?ticket=<ticket>
// from POST /auth/ws-ticket (single use, expires in seconds); the session
// token itself never goes in the URL. Agent services send a bearer header. The hub only pushes messages; anything a client sends is
// ignored, and frames are capped at 1 KB.
//
// A login is checked again every `recheckMs` while the socket stays open, so a
// session that logs out or expires (or an agent token that is revoked) stops
// receiving updates; its socket is closed with code 4001.
import { WebSocketServer } from 'ws'
import { allowedOrigins } from './app.js'
import { resolveToken } from './auth/service.js'
import { wsTickets } from './auth/tickets.js'

export function createRealtimeHub(db, { uiOrigins = allowedOrigins(), recheckMs = 30_000, tickets = wsTickets } = {}) {
  const clients = new Set()
  const tokens = new Map() // socket -> the token it connected with

  function broadcast(msg) {
    const s = JSON.stringify(msg)
    for (const c of clients) if (c.readyState === 1) c.send(s)
  }

  function tokenFrom(req) {
    const header = req.headers.authorization || ''
    if (header.startsWith('Bearer ')) return header.slice(7)
    const ticket = new URL(req.url, 'http://localhost').searchParams.get('ticket')
    return ticket ? tickets.redeem(ticket) : null
  }

  async function verifyClient({ origin, req }, done) {
    try {
      if (origin && !uiOrigins.has(origin)) return done(false, 403, 'origin not allowed')
      const token = tokenFrom(req)
      const principal = await resolveToken(db, token)
      if (!principal) return done(false, 401, 'login required')
      req.gatekeepToken = token
      done(true)
    } catch {
      done(false, 500, 'error')
    }
  }

  // Close every socket whose login is no longer valid.
  async function recheck() {
    await Promise.all([...tokens].map(async ([ws, token]) => {
      try {
        if (!(await resolveToken(db, token))) ws.close(4001, 'login expired')
      } catch {
        // database hiccup: keep the socket, try again next round
      }
    }))
  }

  function attach(server) {
    const wss = new WebSocketServer({ server, verifyClient, maxPayload: 1024 })
    wss.on('connection', (ws, req) => {
      clients.add(ws)
      tokens.set(ws, req.gatekeepToken)
      const drop = () => {
        clients.delete(ws)
        tokens.delete(ws)
      }
      ws.on('close', drop)
      ws.on('error', drop)
    })
    const timer = setInterval(() => recheck(), recheckMs)
    timer.unref()
    wss.on('close', () => clearInterval(timer))
    server.on('close', () => clearInterval(timer))
    return wss
  }

  return { broadcast, attach, clients, recheck }
}
