// Milestone 4: a clear reviewer experience (organised.md, drawback.md 5.4-5.7, 6.2).
// G2 split files, F4 gate banner, F6 scoped rework, F8 live updates, F7
// accessibility, F5 (part 1) the Gate 3 three-column page.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { FakeWebSocket } from './test/setup.js'
import {
  SESSION, json, lastDecision, mockBackend, renderApp, run0427, runAt, runListLoads, signIn,
} from './test/app-harness.jsx'

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const TABS = ['Overview Dashboard', 'Specs & Design Review', 'Code Review IDE', 'Test Results & Sandbox', 'Cryptographic Audit Chain']
const openTab = async (title) => fireEvent.click((await screen.findAllByTitle(title))[0])
const banner = () => screen.findByRole('region', { name: 'Gate status' })
const serve = (run) => ({ [`GET /runs/${run0427.id}`]: () => json(200, run) })

// ---------------------------------------------------------------------------
// G2: no component file is longer than about 400 lines
// ---------------------------------------------------------------------------

test('no React component file is longer than 400 lines (G2)', () => {
  const sources = import.meta.glob(['/src/**/*.jsx', '!/src/**/*.test.jsx'], { query: '?raw', import: 'default', eager: true })
  const sizes = Object.entries(sources).map(([path, src]) => [path, src.split('\n').length])
  expect(sizes.length).toBeGreaterThan(10)
  expect(sizes.filter(([, lines]) => lines > 400)).toEqual([])
})

// ---------------------------------------------------------------------------
// F4: one gate banner on every page
// ---------------------------------------------------------------------------

test('every page shows which gate is active, who must act, who you are, and the actions (F4)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  for (const title of TABS) {
    await openTab(title)
    const region = await banner()
    expect(region).toHaveTextContent('Gate 3 of 3: Code review')
    expect(region).toHaveTextContent('Waiting for: Engineer')
    expect(region).toHaveTextContent('You are: Engineer')
    expect(within(region).getByRole('button', { name: 'Approve Gate 3' })).toBeEnabled()
    expect(within(region).getByRole('button', { name: 'Request changes' })).toBeEnabled()
  }
  // One clear place to decide: no second Approve button anywhere on the page.
  expect(screen.getAllByRole('button', { name: /^Approve/ })).toHaveLength(1)
})

test('the banner names Gate 1 and Gate 2 the same way (F4)', async () => {
  signIn({ ...SESSION.user, role: 'Planner' })
  mockBackend(serve(runAt('g1')))
  await renderApp()
  const region = await banner()
  await waitFor(() => expect(region).toHaveTextContent('Gate 1 of 3: Requirements review'))
  expect(region).toHaveTextContent('Waiting for: Planner')
  expect(region).toHaveTextContent('You are: Planner')
  expect(within(region).getByRole('button', { name: 'Approve Gate 1' })).toBeEnabled()
})

test('approving from the banner tells the server which gate the reviewer saw (F4, B8)', async () => {
  signIn()
  const fetchMock = mockBackend(serve(runAt('g2')))
  await renderApp()
  const approve = await within(await banner()).findByRole('button', { name: 'Approve Gate 2' })
  fireEvent.click(approve)
  await waitFor(() => expect(lastDecision(fetchMock)).toEqual({ decision: 'approve', feedback: '', gate: 'g2' }))
})

test('the wrong role sees Approve and Request changes disabled, with the reason (F4)', async () => {
  signIn({ ...SESSION.user, role: 'Planner' })
  const fetchMock = mockBackend()
  await renderApp()
  const region = await banner()
  const approve = await within(region).findByRole('button', { name: 'Approve Gate 3' })
  await waitFor(() => expect(approve).toBeDisabled())
  expect(within(region).getByRole('button', { name: 'Request changes' })).toBeDisabled()
  expect(within(region).getByRole('note')).toHaveTextContent('Only an Engineer can decide Gate 3. You are signed in as Planner.')
  expect(approve).toHaveAttribute('title', expect.stringContaining('Only an Engineer can decide Gate 3'))
  fireEvent.click(approve)
  expect(lastDecision(fetchMock)).toBeNull()
})

test('an Admin may act for any gate role (F4)', async () => {
  signIn({ ...SESSION.user, role: 'Admin' })
  mockBackend()
  await renderApp()
  const region = await banner()
  await waitFor(() => expect(within(region).getByRole('button', { name: 'Approve Gate 3' })).toBeEnabled())
  expect(region).toHaveTextContent('You are: Admin')
})

test('the person who asked for the work cannot give the final approval, but can request changes (F4)', async () => {
  signIn({ ...SESSION.user, username: run0427.createdBy })
  mockBackend()
  await renderApp()
  const region = await banner()
  const approve = await within(region).findByRole('button', { name: 'Approve Gate 3' })
  await waitFor(() => expect(approve).toBeDisabled())
  expect(within(region).getByRole('note')).toHaveTextContent('You asked for this work, so someone else must give the final approval.')
  expect(within(region).getByRole('button', { name: 'Request changes' })).toBeEnabled()
})

test('code changed after the last test run: Approve is disabled in the banner with the reason (F4, B7)', async () => {
  signIn()
  mockBackend(serve({ ...run0427, review: { ...run0427.review, approvable: false, reason: 'code_changed' } }))
  await renderApp()
  const region = await banner()
  await waitFor(() => expect(within(region).getByRole('note')).toHaveTextContent('The code changed after the last test run.'))
  expect(within(region).getByRole('button', { name: 'Approve Gate 3' })).toBeDisabled()
})

test('while the agent works the banner says so and offers no decision (F4)', async () => {
  signIn()
  mockBackend(serve(runAt('design')))
  await renderApp()
  const region = await banner()
  await waitFor(() => expect(region).toHaveTextContent('Agent working: Design'))
  expect(region).toHaveTextContent('Waiting for: Agent')
  expect(within(region).queryByRole('button', { name: /Approve/ })).toBeNull()
})

test('a finished run says so in the banner (F4)', async () => {
  signIn()
  mockBackend(serve(runAt('done')))
  await renderApp()
  const region = await banner()
  await waitFor(() => expect(region).toHaveTextContent('Run complete'))
})

test('the banner opens the page to review for the current gate (F4)', async () => {
  signIn()
  mockBackend(serve(runAt('g2')))
  await renderApp()
  fireEvent.click(await within(await banner()).findByRole('button', { name: 'Open the design' }))
  // The Specs & Design page opens on the Design sub-page.
  expect(await screen.findByRole('heading', { name: /Technical Architecture/ })).toBeInTheDocument()
})

// ---------------------------------------------------------------------------
// F6: the rework window
// ---------------------------------------------------------------------------

// A run at Gate 3 that was already sent back once (at 18:00), with comments
// from every phase and from before and after that first rework.
const REWORKED_AT = '2026-11-13T18:00:00.000Z'
const reworked = {
  ...run0427,
  auditChain: [
    ...run0427.auditChain,
    { seq: 5, event: 'g3.rejected', actor: 'adrt25', payload: { to: 'code' }, createdAt: REWORKED_AT },
    { seq: 6, event: 'code.review_requested', actor: 'mcp', payload: {}, createdAt: '2026-11-13T18:10:00.000Z' },
  ],
  comments: [
    { id: 'c-req', phase: 'requirements', file: 'requirements.md', line: null, text: 'REQ note from Gate 1', role: 'Planner', author: 'pat', createdAt: '2026-11-13T17:50:00.000Z' },
    { id: 'c-design', phase: 'design', file: 'design.md', line: null, text: 'DESIGN note from Gate 2', role: 'Engineer', author: 'eli', createdAt: '2026-11-13T17:52:00.000Z' },
    { id: 'c-old', phase: 'code', file: 'app/deps/redis.py', line: 4, text: 'OLD code note already sent', role: 'Engineer', author: 'eli', createdAt: '2026-11-13T17:58:00.000Z' },
    { id: 'c-new', phase: 'code', file: 'app/middleware/throttle.py', line: 18, text: 'NEW code note for this round', role: 'Engineer', author: 'eli', createdAt: '2026-11-13T18:20:00.000Z' },
  ],
}

const openRework = async () => {
  fireEvent.click(await within(await banner()).findByRole('button', { name: 'Request changes' }))
  return screen.findByRole('dialog', { name: 'Request changes' })
}

test('only this step\'s new comments are listed and sent, never older rounds or other steps (F6)', async () => {
  signIn()
  const fetchMock = mockBackend(serve(reworked))
  await renderApp()
  const dialog = await openRework()
  const list = within(dialog).getByRole('list', { name: 'Comments that will be sent' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  expect(list).toHaveTextContent('NEW code note for this round')

  fireEvent.click(within(dialog).getByRole('button', { name: 'Send Feedback to Agent' }))
  await waitFor(() => expect(lastDecision(fetchMock)).toMatchObject({ decision: 'reject', gate: 'g3', target: 'code' }))
  const { feedback } = lastDecision(fetchMock)
  expect(feedback).toContain('NEW code note for this round')
  for (const old of ['OLD code note already sent', 'REQ note from Gate 1', 'DESIGN note from Gate 2']) expect(feedback).not.toContain(old)
})

test('at Gates 1 and 2 the window says where the work goes back to (F6)', async () => {
  signIn({ ...SESSION.user, role: 'Planner' })
  mockBackend(serve(runAt('g1')))
  await renderApp()
  const dialog = await openRework()
  expect(within(dialog).queryByRole('radio')).toBeNull()
  expect(within(dialog).getByText('Sends the work back to:')).toBeInTheDocument()
  expect(within(dialog).getByText('Requirements')).toBeInTheDocument()
})

test('at Gate 3 the reviewer chooses Code or Design (F6, B4)', async () => {
  signIn()
  const fetchMock = mockBackend()
  await renderApp()
  const dialog = await openRework()
  expect(within(dialog).getByRole('radio', { name: /Code/ })).toBeChecked()
  fireEvent.click(within(dialog).getByRole('radio', { name: /Design/ }))
  fireEvent.change(within(dialog).getByRole('textbox', { name: /guidance/i }), { target: { value: 'rethink the cache' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send Feedback to Agent' }))
  await waitFor(() => expect(lastDecision(fetchMock)).toMatchObject({ decision: 'reject', gate: 'g3', target: 'design' }))
  expect(lastDecision(fetchMock).feedback).toContain('rethink the cache')
})

test('the feedback box is empty again after sending (F6)', async () => {
  signIn()
  const fetchMock = mockBackend()
  await renderApp()
  let dialog = await openRework()
  fireEvent.change(within(dialog).getByRole('textbox', { name: /guidance/i }), { target: { value: 'first round' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send Feedback to Agent' }))
  await waitFor(() => expect(lastDecision(fetchMock)?.feedback).toContain('first round'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  dialog = await openRework()
  expect(within(dialog).getByRole('textbox', { name: /guidance/i })).toHaveValue('')
})

test('if the server refuses, the window stays open and keeps what was typed (F6)', async () => {
  signIn()
  mockBackend({ [`POST /runs/${run0427.id}/decide`]: () => json(409, { error: 'the run moved on' }) })
  await renderApp()
  const dialog = await openRework()
  fireEvent.change(within(dialog).getByRole('textbox', { name: /guidance/i }), { target: { value: 'keep me' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send Feedback to Agent' }))
  expect(await screen.findByText(/Decision NOT recorded/)).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Request changes' })).toBeInTheDocument()
  expect(within(dialog).getByRole('textbox', { name: /guidance/i })).toHaveValue('keep me')
})

// ---------------------------------------------------------------------------
// F8: live updates
// ---------------------------------------------------------------------------

const liveSocket = () => waitFor(() => {
  const ws = FakeWebSocket.instances.at(-1)
  expect(ws?.onmessage).toBeTypeOf('function')
  return ws
})

test('a burst of live events reloads the runs once, not once per event (F8)', async () => {
  signIn()
  const fetchMock = mockBackend()
  await renderApp()
  await screen.findAllByRole('button', { name: new RegExp(run0427.id) })
  const ws = await liveSocket()
  const before = runListLoads(fetchMock)
  act(() => {
    for (let i = 0; i < 5; i++) ws.onmessage({ data: JSON.stringify({ type: 'run.updated', runId: run0427.id }) })
  })
  await waitFor(() => expect(runListLoads(fetchMock)).toBe(before + 1))
  await new Promise((r) => setTimeout(r, 600))
  expect(runListLoads(fetchMock)).toBe(before + 1)
})

test('after the live connection comes back, the runs are reloaded once to catch up (F8)', async () => {
  signIn()
  const fetchMock = mockBackend()
  await renderApp()
  await screen.findAllByRole('button', { name: new RegExp(run0427.id) })
  const first = await liveSocket()
  act(() => first.onopen?.())
  const before = runListLoads(fetchMock)
  act(() => first.onclose?.())
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1), { timeout: 3000 })
  const second = FakeWebSocket.instances.at(-1)
  act(() => second.onopen?.())
  await waitFor(() => expect(runListLoads(fetchMock)).toBe(before + 1))
})

// ---------------------------------------------------------------------------
// F7: accessibility and usability
// ---------------------------------------------------------------------------

test('dialogs take focus, keep Tab inside, close with Esc and give focus back (F7)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  const opener = await within(await banner()).findByRole('button', { name: 'Request changes' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

  // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
  const focusables = [...dialog.querySelectorAll('button:not([disabled]), textarea, input:not([disabled])')]
  focusables.at(-1).focus()
  fireEvent.keyDown(document.activeElement, { key: 'Tab' })
  expect(document.activeElement).toBe(focusables[0])
  fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(focusables.at(-1))

  fireEvent.keyDown(document.activeElement, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(document.activeElement).toBe(opener)
})

test('the New Run dialog closes with Esc (F7)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  fireEvent.click(await screen.findByRole('button', { name: 'New run' }))
  const dialog = await screen.findByRole('dialog', { name: /Launch New Agent Workflow Run/ })
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('the Code Review dialogs (quick open, full view) close with Esc (F7)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  await openTab('Code Review IDE')
  fireEvent.click(await screen.findByRole('button', { name: /Find file/ }))
  let dialog = await screen.findByRole('dialog', { name: 'Open a changed file' })
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  fireEvent.click(screen.getByRole('button', { name: /Full view/ }))
  dialog = await screen.findByRole('dialog', { name: /app\/middleware\/throttle.py/ })
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('every button on every page, and in the dialogs, has an accessible name (F7)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  const unnamed = () => screen.getAllByRole('button').filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label'))
  for (const title of TABS) {
    await openTab(title)
    await banner()
    expect(unnamed().map((b) => b.outerHTML.slice(0, 120))).toEqual([])
  }
  await openTab('Code Review IDE')
  fireEvent.click(screen.getByRole('button', { name: /Full view/ }))
  await screen.findByRole('dialog')
  expect(unnamed().map((b) => b.outerHTML.slice(0, 120))).toEqual([])
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(await screen.findByRole('button', { name: 'New run' }))
  await screen.findByRole('dialog')
  expect(unnamed().map((b) => b.outerHTML.slice(0, 120))).toEqual([])
})

test('line comment buttons are always reachable by keyboard, not only on mouse hover (F7)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  await openTab('Code Review IDE')
  const buttons = await screen.findAllByRole('button', { name: /^Comment on line \d+$/ })
  expect(buttons.length).toBeGreaterThan(0)
  for (const b of buttons) {
    expect(b.tabIndex).toBeGreaterThanOrEqual(0)
    expect(b.className).not.toMatch(/(^|\s)opacity-0(\s|$)/)
  }
  buttons[0].focus()
  fireEvent.click(buttons[0])
  expect(await screen.findByRole('textbox', { name: /Comment on line/ })).toBeInTheDocument()
})

const selectable = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.classList?.contains('select-none')) return false
  return true
}

test('run IDs, hashes and code can be selected and copied (F7)', async () => {
  signIn()
  mockBackend()
  const { container } = await renderApp()
  await screen.findAllByRole('button', { name: new RegExp(run0427.id) })
  expect(container.firstChild).not.toHaveClass('select-none')
  // Run ID in the header switcher.
  for (const el of screen.getAllByText(run0427.id)) expect(selectable(el)).toBe(true)
  // Code on the Code Review page.
  await openTab('Code Review IDE')
  for (const el of await screen.findAllByText('RateLimiter')) expect(selectable(el)).toBe(true)
  // Hashes on the Audit Chain page (shown shortened: first 8 and last 6 characters).
  await openTab('Cryptographic Audit Chain')
  const hash = run0427.auditChain[0].hash.slice(0, 8)
  const hashes = await screen.findAllByText(new RegExp(hash))
  for (const el of hashes) expect(selectable(el)).toBe(true)
})

// ---------------------------------------------------------------------------
// F5 (part 1): Gate 3 shows requirements, code and design on one screen
// ---------------------------------------------------------------------------

test('Gate 3 shows the approved requirements, the code changes and the approved design together (F5)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  await openTab('Code Review IDE')
  const reqs = await screen.findByRole('region', { name: 'Approved requirements' })
  const code = screen.getByRole('region', { name: 'Code changes' })
  const design = screen.getByRole('region', { name: 'Approved design' })

  // Left: requirements (approved at Gate 1) and the test results.
  expect(reqs).toHaveTextContent('Approved by Planner')
  expect(reqs).toHaveTextContent('AC-1')
  expect(reqs).toHaveTextContent('Limit webhook invocations to 60 requests per minute')
  const tests = within(reqs).getByRole('list', { name: 'Test results' })
  expect(within(tests).getAllByRole('listitem')).toHaveLength(run0427.tests.cases.length)
  expect(tests).toHaveTextContent('test_webhook_accepts_valid_payload')

  // Middle: the diff.
  expect(within(code).getAllByText('RateLimiter').length).toBeGreaterThan(0)

  // Right: the design (approved at Gate 2) and the changed files.
  expect(design).toHaveTextContent('Approved by Engineer')
  expect(design).toHaveTextContent('app/deps/redis.py')
  expect(design).toHaveTextContent('Spoofing')
  const changed = within(design).getByRole('list', { name: 'Changed files' })
  expect(within(changed).getAllByRole('listitem')).toHaveLength(run0427.files.length)

  // Picking a changed file opens it in the middle column.
  fireEvent.click(within(changed).getByRole('button', { name: /README\.md/ }))
  await waitFor(() => expect(code).toHaveTextContent('README.md'))
})

test('the Gate 3 columns say so when there is nothing approved to show (F5)', async () => {
  signIn()
  mockBackend(serve({ ...run0427, requirements: null, design: null, summary: null, tests: null }))
  await renderApp()
  await openTab('Code Review IDE')
  expect(await screen.findByRole('region', { name: 'Approved requirements' })).toHaveTextContent('No requirements recorded for this run.')
  expect(screen.getByRole('region', { name: 'Approved requirements' })).toHaveTextContent('No test run yet')
  expect(screen.getByRole('region', { name: 'Approved design' })).toHaveTextContent('No design recorded for this run.')
})

test('clicking outside the rework window does not throw away typed guidance (F7, review finding)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  const dialog = await openRework()
  fireEvent.change(within(dialog).getByRole('textbox', { name: /guidance/i }), { target: { value: 'half written' } })
  fireEvent.mouseDown(dialog.parentElement)
  expect(screen.getByRole('dialog', { name: 'Request changes' })).toBeInTheDocument()
})

test('Code Review never invents a repository or branch name (review finding, rule 5)', async () => {
  signIn()
  mockBackend(serve({ ...run0427, repo: '', branch: '' }))
  await renderApp()
  await openTab('Code Review IDE')
  await screen.findByRole('region', { name: 'Code changes' })
  expect(screen.queryByText('commerce-core')).toBeNull()
  fireEvent.click(screen.getByTitle('Git Branch'))
  expect(screen.queryByText('main')).toBeNull()
  expect(screen.getAllByText('Unknown branch').length).toBeGreaterThan(0)
})

// ---------------------------------------------------------------------------
// ECC React review findings
// ---------------------------------------------------------------------------

test('a dialog with an autofocus field still gives focus back to its opener on Esc (F7, review #1)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  const opener = await screen.findByRole('button', { name: 'New run' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', { name: /Launch New Agent Workflow Run/ })
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  fireEvent.keyDown(document.activeElement, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(document.activeElement).toBe(opener)
})

test('Shift+Tab from the dialog itself stays inside the dialog (F7, review #7)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  const dialog = await openRework()
  dialog.focus()
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(dialog)
})

test('a failed reload keeps the last good data and the open rework window (F8, review #2)', async () => {
  signIn()
  let failing = false
  mockBackend({ [`GET /runs/${run0427.id}`]: () => (failing ? json(500, { error: 'blip' }) : json(200, run0427)) })
  await renderApp()
  const dialog = await openRework()
  fireEvent.change(within(dialog).getByRole('textbox', { name: /guidance/i }), { target: { value: 'still here' } })
  failing = true
  const ws = await liveSocket()
  act(() => ws.onmessage({ data: JSON.stringify({ type: 'run.updated', runId: run0427.id }) }))
  expect(await screen.findByText('API offline')).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Request changes' })).toBeInTheDocument()
  expect(within(dialog).getByRole('textbox', { name: /guidance/i })).toHaveValue('still here')
  expect(await banner()).toHaveTextContent('Gate 3 of 3: Code review')
})

test('an older reload that answers late never overwrites a newer one (F8, review #3)', async () => {
  signIn()
  // 'load': normal answers; 'slow': the next answer is old and late; then 'done'.
  let mode = 'load'
  const done = runAt('done')
  mockBackend({
    [`GET /runs/${run0427.id}`]: async () => {
      if (mode === 'slow') { mode = 'done'; await new Promise((r) => setTimeout(r, 400)); return json(200, run0427) }
      return json(200, mode === 'done' ? done : run0427)
    },
  })
  await renderApp()
  const approve = await within(await banner()).findByRole('button', { name: 'Approve Gate 3' })
  await waitFor(() => expect(approve).toBeEnabled())
  mode = 'slow'
  const ws = await liveSocket()
  act(() => ws.onmessage({ data: JSON.stringify({ type: 'run.updated' }) })) // reload A: slow, old
  await new Promise((r) => setTimeout(r, 300))
  fireEvent.click(approve) // reload B: fast, new
  await waitFor(async () => expect(await banner()).toHaveTextContent('Run complete'))
  await new Promise((r) => setTimeout(r, 500)) // A lands now
  expect(await banner()).toHaveTextContent('Run complete')
})

test('signing out right after a live event does not show a false "session expired" (F8, review #4)', async () => {
  signIn()
  mockBackend({ 'GET /runs': (init) => (init.headers?.authorization ? json(200, [{ id: run0427.id }]) : json(401, { error: 'login required' })) })
  await renderApp()
  await screen.findAllByRole('button', { name: new RegExp(run0427.id) })
  const ws = await liveSocket()
  act(() => ws.onmessage({ data: JSON.stringify({ type: 'run.updated' }) }))
  fireEvent.click(screen.getByTitle(/Signed in as/))
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(await screen.findByRole('heading', { name: 'Sign in to GateKeep' })).toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 500))
  expect(screen.queryByText(/session expired/)).toBeNull()
})

test('a double click on Approve sends one decision (F4, review #6)', async () => {
  signIn()
  let release
  const fetchMock = mockBackend({
    [`POST /runs/${run0427.id}/decide`]: () => new Promise((r) => { release = () => r(json(200, runAt('done'))) }),
  })
  await renderApp()
  const approve = await within(await banner()).findByRole('button', { name: 'Approve Gate 3' })
  fireEvent.click(approve)
  fireEvent.click(approve)
  await waitFor(() => expect(release).toBeTypeOf('function'))
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/decide'))).toHaveLength(1)
  release()
})

test('Cmd+P does not open the file finder behind another dialog (F7, review #8)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  await openTab('Code Review IDE')
  await openRework()
  fireEvent.keyDown(window, { key: 'p', metaKey: true })
  expect(screen.queryByRole('dialog', { name: 'Open a changed file' })).toBeNull()
})

test('header popups are plain disclosure buttons, not half-built ARIA menus (F7, review #10)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  expect(screen.getByRole('button', { name: /Copy Run ID/ })).toBeInTheDocument()
})

test('when a rework replaces the changed files, the tabs follow the new files (review #12)', async () => {
  signIn()
  let second = false
  const swapped = { ...run0427, files: run0427.files.map((f, i) => ({ ...f, path: `new/file_${i}.py` })), diff: null }
  mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, second ? swapped : run0427) })
  await renderApp()
  await openTab('Code Review IDE')
  const code = await screen.findByRole('region', { name: 'Code changes' })
  expect(code).toHaveTextContent('throttle.py')
  second = true
  const ws = await liveSocket()
  act(() => ws.onmessage({ data: JSON.stringify({ type: 'run.updated' }) }))
  await waitFor(() => expect(code).toHaveTextContent('file_0.py'))
  expect(code).not.toHaveTextContent('throttle.py')
})

// ---------------------------------------------------------------------------
// Found in the live browser check
// ---------------------------------------------------------------------------

test('the New Run dialog opens with the cursor in the Brief field (F7, browser check)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  // A real click also focuses the button (fireEvent.click does not).
  const opener = await screen.findByRole('button', { name: 'New run' })
  opener.focus()
  fireEvent.click(opener)
  await screen.findByRole('dialog', { name: /Launch New Agent Workflow Run/ })
  await waitFor(() => expect(document.activeElement).toHaveAttribute('placeholder', 'e.g. Add rate limiting to the checkout webhook'))
})

test('a removed and an added line with the same number have their own comment buttons (F7, browser check)', async () => {
  signIn()
  mockBackend()
  await renderApp()
  await openTab('Code Review IDE')
  const names = (await screen.findAllByRole('button', { name: /^Comment on/ })).map((b) => b.getAttribute('aria-label'))
  expect(new Set(names).size).toBe(names.length)
  // Opening one comment box opens only that line's box.
  fireEvent.click(screen.getByRole('button', { name: 'Comment on removed line 15' }))
  expect(screen.getAllByRole('textbox', { name: /Comment on/ })).toHaveLength(1)
})

test('a run with no code changes offers no comment button on the placeholder line (browser check)', async () => {
  signIn()
  mockBackend(serve({ ...run0427, files: [], diff: null }))
  await renderApp()
  await openTab('Code Review IDE')
  const code = await screen.findByRole('region', { name: 'Code changes' })
  expect(code).toHaveTextContent('No code changes recorded for this run yet.')
  expect(screen.queryAllByRole('button', { name: /^Comment on/ })).toHaveLength(0)
})
