// Single-use WebSocket tickets (Milestone 1 review finding #9).
//
// Browsers cannot set headers on a WebSocket, so the dashboard used to put its
// session token in the URL, where proxies and logs can keep it. Instead it now
// asks POST /auth/ws-ticket for a random ticket and connects with ?ticket=.
// A ticket works once and only for a few seconds. It maps to the session
// token in this process's memory only; the token itself never goes in a URL.

import { randomBytes } from 'node:crypto'

export function createTicketStore({ ttlMs = 30_000, now = () => Date.now() } = {}) {
  const tickets = new Map() // ticket -> { token, expiresAt }

  function sweep() {
    const t = now()
    for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k)
  }

  return {
    ttlMs,
    issue(token) {
      sweep()
      const ticket = randomBytes(24).toString('base64url')
      tickets.set(ticket, { token, expiresAt: now() + ttlMs })
      return ticket
    },
    // The session token behind a ticket, or null. The ticket is used up either way.
    redeem(ticket) {
      if (typeof ticket !== 'string') return null
      const entry = tickets.get(ticket)
      tickets.delete(ticket)
      if (!entry || entry.expiresAt <= now()) return null
      return entry.token
    },
  }
}

// One store shared by the HTTP app and the WebSocket hub of this process.
export const wsTickets = createTicketStore()
