// Dashboard smoke tests: the app must render for a logged-out visitor and for
// a signed-in reviewer. Rendered under StrictMode exactly like main.jsx, which
// mounts, unmounts and re-mounts effects, so a bad effect cleanup (such as
// returning null) crashes here just as it does in the browser.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { FakeWebSocket } from './test/setup.js'
import { SESSION, json, lastDecision, mockBackend, renderApp, run0427 } from './test/app-harness.jsx'

// The one gate banner (F4) holds the Approve and Request changes buttons.
const banner = () => screen.findByRole('region', { name: 'Gate status' })

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

  // Finding #9: live updates trade the session for a single-use ticket; the
  // session token itself never appears in the WebSocket URL.
  await waitFor(() => expect(FakeWebSocket.instances.some((ws) => ws.url.includes('ticket=tkt_single_use'))).toBe(true))
  for (const ws of FakeWebSocket.instances) expect(ws.url).not.toContain(SESSION.token)
  const ticketCall = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/auth/ws-ticket') && init.method === 'POST')
  expect(ticketCall[1].headers.authorization).toBe(`Bearer ${SESSION.token}`)
})

test('approve tells the server which gate the reviewer was looking at (B8)', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const fetchMock = mockBackend()
  await renderApp()
  const approve = await within(await banner()).findByRole('button', { name: 'Approve Gate 3' })
  await waitFor(() => expect(approve).toBeEnabled())
  fireEvent.click(approve)
  await waitFor(() => expect(lastDecision(fetchMock)).toEqual({ decision: 'approve', feedback: '', gate: 'g3' }))
})

test('at Gate 3, Request Rework lets the reviewer send the work back to Design (B4)', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const fetchMock = mockBackend()
  await renderApp()
  fireEvent.click(await within(await banner()).findByRole('button', { name: 'Request changes' }))
  const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
  // Code is the default; the reviewer picks Design.
  expect(within(dialog).getByRole('radio', { name: /Code/ })).toBeChecked()
  fireEvent.click(within(dialog).getByRole('radio', { name: /Design/ }))
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'rethink the cache' } })
  fireEvent.click(within(dialog).getByRole('button', { name: /Send Feedback to Agent/ }))
  await waitFor(() => expect(lastDecision(fetchMock)).toMatchObject({ decision: 'reject', gate: 'g3', target: 'design' }))
  expect(lastDecision(fetchMock).feedback).toContain('rethink the cache')
})

test('before Gate 3 the rework window has no target choice', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const atGate2 = {
    ...run0427, step: 'g2',
    steps: run0427.steps.map((st) => ({ ...st, state: st.key === 'g2' ? 'active' : ['req', 'g1', 'design'].includes(st.key) ? 'approved' : 'pending' })),
  }
  const fetchMock = mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, atGate2) })
  await renderApp()
  fireEvent.click(await within(await banner()).findByRole('button', { name: 'Request changes' }))
  await screen.findByRole('dialog', { name: 'Request changes' })
  expect(screen.queryByRole('radio')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Send Feedback to Agent/ }))
  await waitFor(() => expect(lastDecision(fetchMock)).toMatchObject({ decision: 'reject', gate: 'g2' }))
  expect(lastDecision(fetchMock).target).toBeUndefined()
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

test('Start is offered only for a run at Requirements that was never started', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const atReq = (started) => ({
    ...run0427, step: 'req', status: 'running', gate: null, awaiting: false, started,
    steps: run0427.steps.map((st) => ({ ...st, state: st.key === 'req' ? 'active' : 'pending' })),
  })
  mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, atReq(true)) })
  await renderApp()
  // Sent back from Gate 1 after a pipeline start: Start would only answer 409.
  await screen.findByText('Agent Working')
  expect(screen.queryByRole('button', { name: /Start Pipeline/ })).toBeNull()
})

test('a run with no known step (from before the state machine) cannot be approved', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const legacy = { ...run0427, step: null }
  mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, legacy) })
  await renderApp()
  await screen.findAllByRole('button', { name: new RegExp(run0427.id) })
  // The banner explains there is no decision to make, and offers none.
  expect(await banner()).toHaveTextContent('This run has no known step, so no decision can be made.')
  expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
})

test('the dashboard says SHA-256 HMAC now that the chain is HMAC-signed (E1)', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  mockBackend()
  await renderApp()
  // Overview: the Audit Ledger Seal card.
  expect(await screen.findByText('SHA-256 HMAC')).toBeInTheDocument()
  expect(screen.queryByText('SHA-256 hash chain')).toBeNull()
  // Audit Chain tab: the algorithm line.
  fireEvent.click(screen.getAllByTitle('Cryptographic Audit Chain')[0])
  expect(await screen.findByText(/Algorithm: HMAC-SHA256/)).toBeInTheDocument()
})

// B7: Gate 3 approves one exact, tested version of the code.
const atGate3With = (review) => ({ ...run0427, review })

test('at Gate 3, Approve is disabled with the reason when the code changed after the last test run (B7)', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const changed = atGate3With({ fingerprint: 'b'.repeat(64), testRunId: run0427.tests.id, approvable: false, reason: 'code_changed' })
  const fetchMock = mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, changed) })
  await renderApp()
  // The one Approve button, in the gate banner, says why.
  const approves = await screen.findAllByTitle(/changed after the last test run/)
  await screen.findAllByRole('button', { name: new RegExp(run0427.id) })
  expect(approves.length).toBe(1)
  for (const button of approves) expect(button).toBeDisabled()
  expect(within(await banner()).getByRole('note')).toHaveTextContent('The code changed after the last test run. Approve is disabled.')
  for (const button of approves) fireEvent.click(button)
  expect(lastDecision(fetchMock)).toBeNull()
})

test('at Gate 3 with no review evidence at all, Approve stays disabled (fail closed)', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, atGate3With(undefined)) })
  await renderApp()
  await screen.findAllByRole('button', { name: new RegExp(run0427.id) })
  const approves = await screen.findAllByTitle(/no tested version/i)
  expect(approves.length).toBe(1)
  for (const button of approves) expect(button).toBeDisabled()
})

test('the test results page lists every test, marked new or existing (C2, C3)', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  mockBackend()
  await renderApp()
  fireEvent.click((await screen.findAllByTitle('Test Results & Sandbox'))[0])
  const list = await screen.findByRole('list', { name: 'Tests in the last run' })
  const rows = list.querySelectorAll('li')
  expect(rows).toHaveLength(4)
  expect(rows[0]).toHaveTextContent('test_webhook_accepts_valid_payload')
  expect(rows[0]).toHaveTextContent('Existing')
  expect(rows[1]).toHaveTextContent('New')
  expect(screen.getByText('1 existing · 3 new')).toBeInTheDocument()
})

test('a deleted chain head is explained without inventing a block number (E4)', async () => {
  localStorage.setItem('gatekeep_session', JSON.stringify(SESSION))
  const wiped = { ...run0427, verified: false, verify: { runId: run0427.id, valid: false, brokenAt: null, reason: 'head_missing' } }
  mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, wiped) })
  await renderApp()
  fireEvent.click((await screen.findAllByTitle('Cryptographic Audit Chain'))[0])
  expect(await screen.findByText(/The sealed chain head for this run was deleted/)).toBeInTheDocument()
  expect(screen.getByText('Cryptographic Integrity Failure Detected')).toBeInTheDocument()
  expect(screen.queryByText(/Block #2|\(#2\)/)).toBeNull()
})
