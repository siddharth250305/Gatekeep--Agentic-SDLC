// Thin client for the GateKeep backend (Node/Express on :4040).
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4040'

// The reviewer's login session ({ token, user, expiresAt }). Kept in
// localStorage so a page reload stays logged in; every access is guarded
// because storage can be unavailable (private mode, blocked site data).
const SESSION_KEY = 'gatekeep_session'

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    if (s?.token && (!s.expiresAt || new Date(s.expiresAt) > new Date())) return s
  } catch { /* storage unavailable */ }
  return null
}

let session = loadSession()
let onUnauthorized = () => {}

export function setSession(next) {
  session = next
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* storage unavailable */ }
}

// Called when the API answers 401 (session expired or revoked).
export function onSessionExpired(fn) {
  onUnauthorized = fn
}

// fetch with the session token attached.
function call(path, { headers, ...init } = {}) {
  const auth = session?.token ? { authorization: `Bearer ${session.token}` } : {}
  return fetch(`${BASE}${path}`, { ...init, headers: { ...auth, ...headers } })
}

async function json(res) {
  if (res.status === 401 && !res.url.endsWith('/auth/login')) onUnauthorized()
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
}

const JSON_HEADERS = { 'content-type': 'application/json' }

export const api = {
  base: BASE,

  health: () => call(`/health`).then(json),

  login: (username, password) =>
    call(`/auth/login`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ username, password }) }).then(json),

  logout: () => call(`/auth/logout`, { method: 'POST' }).then(json),

  // Single-use, short-lived ticket for opening the live-update WebSocket.
  wsTicket: () => call(`/auth/ws-ticket`, { method: 'POST' }).then(json),

  listRuns: () => call(`/runs`).then(json),

  createRun: (body) =>
    call(`/runs`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }).then(json),

  getRun: (id) => call(`/runs/${id}`).then(json),

  start: (id) =>
    call(`/runs/${id}/start`, { method: 'POST' }).then(json),

  decide: (id, body) =>
    call(`/runs/${id}/decide`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }).then(json),

  // Real DB mutation of a past audit event (the honest tamper demo).
  tamper: (id, seq, payload) =>
    call(`/runs/${id}/audit/${seq}/tamper`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ payload }),
    }).then(json),

  addComment: (id, comment) =>
    call(`/runs/${id}/comments`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(comment),
    }).then(json),

  deleteComment: (id, commentId) =>
    call(`/runs/${id}/comments/${commentId}`, {
      method: 'DELETE',
    }).then(json),

  // MCP External Agent Sessions
  listMcpSessions: () => call(`/mcp/sessions`).then(json),
  getMcpSessionsForRun: (runId) => call(`/mcp/sessions/run/${runId}`).then(json),
  getMcpStats: () => call(`/mcp/stats`).then(json),
}

// Live updates. Calls onMessage({ type, runId }) on each broadcast.
// Browsers cannot send headers on a WebSocket, so each connection first asks
// for a single-use ticket; the session token never goes in the URL.
export function connectRealtime(onMessage) {
  let ws
  let closed = false
  let retry
  const url = BASE.replace(/^http/, 'ws')
  const reconnect = () => {
    if (!closed) retry = setTimeout(open, 1500)
  }
  const open = async () => {
    let ticket
    try {
      ;({ ticket } = await api.wsTicket())
    } catch {
      return reconnect()
    }
    if (closed) return
    ws = new WebSocket(`${url}/?ticket=${encodeURIComponent(ticket)}`)
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data))
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = reconnect
  }
  open()
  return () => {
    closed = true
    clearTimeout(retry)
    ws?.close()
  }
}
