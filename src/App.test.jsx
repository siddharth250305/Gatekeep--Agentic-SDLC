// Dashboard smoke tests: the app must render for a logged-out visitor and for
// a signed-in reviewer. Rendered under StrictMode exactly like main.jsx, which
// mounts, unmounts and re-mounts effects, so a bad effect cleanup (such as
// returning null) crashes here just as it does in the browser.
import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import run0427 from './test/fixtures/run-0427.json'
import { FakeWebSocket } from './test/setup.js'

const SESSION = {
  token: 'gks_test_session',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  user: { id: 1, username: 'adrt25', name: 'Adrian T', role: 'Engineer' },
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// A fake GateKeep backend. Overrides map a path to a response.
function mockBackend(overrides = {}) {
  const routes = {
    'POST /auth/login': () => json(200, SESSION),
    'POST /auth/logout': () => json(200, { ok: true }),
    'GET /health': () => json(200, { ok: true, demoMode: false }),
    'GET /runs': () => json(200, [{ id: run0427.id }]),
    [`GET /runs/${run0427.id}`]: () => json(200, run0427),
    'GET /mcp/sessions': () => json(200, []),
    'GET /mcp/stats': () => json(200, { total_sessions: 0, active_sessions: 0, total_tool_calls: 0, sessions_by_provider: [] }),
    ...overrides,
  }
  const fetchMock = vi.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${new URL(url).pathname}`
    return routes[key] ? routes[key](init) : json(404, { error: `no mock for ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// api.js reads the stored session when it is imported, so every test loads
// the app modules fresh.
async function renderApp() {
  vi.resetModules()
  const { default: App } = await import('./App')
  return render(<StrictMode><App /></StrictMode>)
}

let consoleError
beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

// React reports a bad effect cleanup through console.error before it crashes.
function expectNoEffectErrors() {
  const messages = consoleError.mock.calls.map((args) => args.map(String).join(' '))
  expect(messages.filter((m) => /must not return anything besides a function|destroy is not a function/.test(m))).toEqual([])
}

test('logged out: the login screen renders and nothing connects', async () => {
  mockBackend()
  await renderApp()
  expect(await screen.findByRole('heading', { name: 'Sign in to GateKeep' })).toBeInTheDocument()
  expect(screen.getByLabelText('Username')).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
  expectNoEffectErrors()
  // No live-update socket without a login.
  expect(FakeWebSocket.instances).toHaveLength(0)
})

test('logged out: signing in reaches the dashboard', async () => {
  const fetchMock = mockBackend()
  await renderApp()
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'adrt25' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByTitle('Signed in as Adrian T (Engineer)')).toBeInTheDocument()
  const login = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/login'))
  expect(JSON.parse(login[1].body)).toEqual({ username: 'adrt25', password: 'correct horse battery' })
  expect(localStorage.getItem('gatekeep_session')).toContain(SESSION.token)
  expectNoEffectErrors()
})

test('logged out: a wrong password shows the error and stays on the login screen', async () => {
  mockBackend({ 'POST /auth/login': () => json(401, { error: 'wrong username or password' }) })
  await renderApp()
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'adrt25' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope-nope-nope' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('wrong username or password')
  expect(screen.getByRole('heading', { name: 'Sign in to GateKeep' })).toBeInTheDocument()
})

test('logged in: the dashboard renders the run with the session token attached', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const fetchMock = mockBackend()
  await renderApp()

  expect(await screen.findByTitle('Signed in as Adrian T (Engineer)')).toBeInTheDocument()
  expect((await screen.findAllByRole('button', { name: new RegExp(run0427.id) })).length).toBeGreaterThan(0)
  expect(screen.getByText('Multi-Agent Pipeline Progression')).toBeInTheDocument()
  expectNoEffectErrors()

  // Every API call except /health carries the reviewer's token.
  const authed = fetchMock.mock.calls.filter(([url]) => !url.endsWith('/health'))
  expect(authed.length).toBeGreaterThan(0)
  for (const [, init] of authed) expect(init.headers.authorization).toBe(`Bearer ${SESSION.token}`)

  // Live updates open one socket that carries the token.
  await waitFor(() => expect(FakeWebSocket.instances.some((ws) => ws.url.includes(`token=${SESSION.token}`))).toBe(true))
})

test('logged in: an expired session returns to the login screen with a notice', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  mockBackend({ 'GET /runs': () => json(401, { error: 'login required' }) })
  await renderApp()
  expect(await screen.findByText('Your session expired. Please sign in again.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Sign in to GateKeep' })).toBeInTheDocument()
  expect(localStorage.getItem('gatekeep_session')).toBeNull()
  expectNoEffectErrors()
})
