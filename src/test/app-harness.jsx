// Shared harness for dashboard tests: a fake GateKeep backend and a fresh App.
import { StrictMode } from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import run0427 from './fixtures/run-0427.json'

export { run0427 }

export const SESSION = {
  token: 'gks_test_session',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  user: { id: 1, username: 'adrt25', name: 'Adrian T', role: 'Engineer' },
}

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// A fake GateKeep backend. Overrides map "METHOD /path" to a response function.
export function mockBackend(overrides = {}) {
  const routes = {
    'POST /auth/login': () => json(200, SESSION),
    'POST /auth/logout': () => json(200, { ok: true }),
    'GET /health': () => json(200, { ok: true, demoMode: false }),
    'GET /runs': () => json(200, [{ id: run0427.id }]),
    [`GET /runs/${run0427.id}`]: () => json(200, run0427),
    'GET /mcp/sessions': () => json(200, []),
    'GET /mcp/stats': () => json(200, { total_sessions: 0, active_sessions: 0, total_tool_calls: 0, sessions_by_provider: [] }),
    'POST /auth/ws-ticket': () => json(200, { ticket: 'tkt_single_use', expiresInMs: 30000 }),
    [`POST /runs/${run0427.id}/decide`]: () => json(200, { ...run0427, step: 'done', status: 'approved', awaiting: false }),
    ...overrides,
  }
  const fetchMock = vi.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${new URL(url).pathname}`
    return routes[key] ? routes[key](init) : json(404, { error: `no mock for ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// Sign in as `user` (defaults to the Engineer in SESSION).
export function signIn(user = SESSION.user) {
  localStorage.setItem('gatekeep_session', JSON.stringify({ ...SESSION, user }))
}

// api.js reads the stored session when it is imported, so every test loads
// the app modules fresh. Rendered under StrictMode exactly like main.jsx.
export async function renderApp() {
  vi.resetModules()
  const { default: App } = await import('../App')
  return render(<StrictMode><App /></StrictMode>)
}

// The JSON body of the last POST to /decide.
export function lastDecision(fetchMock) {
  const calls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/decide'))
  return calls.length ? JSON.parse(calls.at(-1)[1].body) : null
}

// How many times the app asked for the run list.
export const runListLoads = (fetchMock) =>
  fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === '/runs' && (init?.method || 'GET') === 'GET').length

// The run at another step, with the step states the server would report.
const ORDER = ['req', 'g1', 'design', 'g2', 'code', 'g3', 'done']
export function runAt(step, extra = {}) {
  const idx = ORDER.indexOf(step)
  const gate = { g1: 'Planner', g2: 'Engineer', g3: 'Engineer' }[step] ?? null
  return {
    ...run0427,
    step,
    gate,
    awaiting: Boolean(gate),
    status: gate ? 'awaiting_gate' : step === 'done' ? 'approved' : step === 'cancelled' ? 'cancelled' : 'running',
    review: step === 'g3' ? run0427.review : null,
    steps: run0427.steps.map((st) => {
      const i = ORDER.indexOf(st.key)
      return { ...st, state: i < idx || step === 'done' ? 'approved' : i === idx ? 'active' : 'pending' }
    }),
    ...extra,
  }
}
