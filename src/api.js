// Thin client for the GateKeep backend (Node/Express on :4040).
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4040'

async function json(res) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
}

export const api = {
  base: BASE,

  listRuns: () => fetch(`${BASE}/runs`).then(json),

  createRun: (body) =>
    fetch(`${BASE}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json),

  getRun: (id) => fetch(`${BASE}/runs/${id}`).then(json),

  start: (id) =>
    fetch(`${BASE}/runs/${id}/start`, { method: 'POST' }).then(json),

  decide: (id, body) =>
    fetch(`${BASE}/runs/${id}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json),

  // Real DB mutation of a past audit event (the honest tamper demo).
  tamper: (id, seq, payload) =>
    fetch(`${BASE}/runs/${id}/audit/${seq}/tamper`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    }).then(json),

  addComment: (id, comment) =>
    fetch(`${BASE}/runs/${id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(comment),
    }).then(json),

  deleteComment: (id, commentId) =>
    fetch(`${BASE}/runs/${id}/comments/${commentId}`, {
      method: 'DELETE',
    }).then(json),

  // MCP External Agent Sessions
  listMcpSessions: () => fetch(`${BASE}/mcp/sessions`).then(json),
  getMcpSessionsForRun: (runId) => fetch(`${BASE}/mcp/sessions/run/${runId}`).then(json),
  getMcpStats: () => fetch(`${BASE}/mcp/stats`).then(json),
}

// Live updates. Calls onMessage({ type, runId }) on each broadcast.
export function connectRealtime(onMessage) {
  let ws
  let closed = false
  const url = BASE.replace(/^http/, 'ws')
  const open = () => {
    ws = new WebSocket(url)
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data))
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      if (!closed) setTimeout(open, 1500) // reconnect
    }
  }
  open()
  return () => {
    closed = true
    ws?.close()
  }
}
