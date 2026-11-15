// Milestone 6: the Gate 3 page links requirements to tests and shows planned vs
// changed files with warnings (F5 part 2, I2, I3), the gatekeep.yaml rules the
// change triggered (I5), the team rules on the Approve button (I4), and the
// evidence export / Pull Request for a finished run (I6).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { FakeWebSocket } from './test/setup.js'
import { SESSION, json, mockBackend, renderApp, run0427, runAt, signIn } from './test/app-harness.jsx'

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const openTab = async (title) => fireEvent.click((await screen.findAllByTitle(title))[0])
const banner = () => screen.findByRole('region', { name: 'Gate status' })
const serve = (run, extra = {}) => mockBackend({ [`GET /runs/${run0427.id}`]: () => json(200, run), ...extra })

const TRACE = {
  requirements: [
    { id: 'REQ-1', text: 'Limit each merchant to 60 calls a minute.', planned: ['app/middleware/throttle.py'], changed: ['app/middleware/throttle.py'], status: 'covered',
      tests: [{ name: 'test_req_1_allows_60', file: 'tests/test_throttle.py', outcome: 'passed', new: true }] },
    { id: 'REQ-2', text: 'Answer 429 with Retry-After.', planned: ['app/routes/webhook.py'], changed: ['app/routes/webhook.py'], status: 'failing',
      tests: [{ name: 'test_req_2_retry_after', file: 'tests/test_throttle.py', outcome: 'failed', new: true }] },
    { id: 'REQ-3', text: 'Internal traffic is exempt.', planned: [], changed: [], status: 'uncovered', tests: [] },
  ],
  plan: { files: [], interfaces: [] },
  drift: {
    planned: [
      { path: 'app/middleware/throttle.py', change: 'create', reqs: ['REQ-1'], changed: ['app/middleware/throttle.py'] },
      { path: 'app/routes/webhook.py', change: 'modify', reqs: ['REQ-2'], changed: ['app/routes/webhook.py'] },
      { path: 'app/deps/settings.py', change: 'modify', reqs: [], changed: [] },
    ],
    undeclared: ['README.md', 'app/deps/redis.py'],
    untouched: ['app/deps/settings.py'],
  },
  unknownRefs: [],
  summary: { requirements: 3, covered: 1, failing: 1, uncovered: 1, undeclared: 2, untouched: 1 },
}

const GOVERNANCE = {
  policyStatus: 'loaded',
  triggered: [{ path: 'app/**', files: ['app/middleware/throttle.py'], approvals: 2, reviewers: ['alice'], roles: ['Engineer', 'Admin'] }],
  requirements: [
    { label: 'Gate 3', approvals: 1, have: 1, roles: ['Engineer', 'Admin'], reviewers: [], missingReviewers: [], satisfied: true },
    { label: 'app/**', approvals: 2, have: 1, roles: ['Engineer', 'Admin'], reviewers: ['alice'], missingReviewers: ['alice'], satisfied: false },
  ],
  approvals: [{ username: 'erin', role: 'Engineer', at: '2026-11-14T10:00:00Z' }],
  excluded: [{ username: 'ml-priya', reason: 'requester' }],
  blocking: [],
  budget: { files: { used: 6, max: 10 }, lines: { used: 181, max: 400 } },
  complete: false,
}
const POLICY = { status: 'loaded', sha256: 'c'.repeat(64), rules: {} }

const gate3 = (extra = {}) => runAt('g3', { trace: TRACE, governance: GOVERNANCE, policy: POLICY, ...extra })

test('every requirement shows the tests that cover it; uncovered and failing ones stand out (F5, I3)', async () => {
  signIn()
  serve(gate3())
  await renderApp()
  await openTab('Code Review IDE')
  const list = await screen.findByRole('list', { name: 'Requirement coverage' })
  const items = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list) // not the nested test names
  expect(items).toHaveLength(3)
  expect(items[0]).toHaveTextContent('REQ-1')
  expect(items[0]).toHaveTextContent('Covered')
  expect(items[0]).toHaveTextContent('test_req_1_allows_60')
  expect(items[1]).toHaveTextContent('Failing')
  expect(items[1]).toHaveAttribute('data-status', 'failing')
  expect(items[2]).toHaveTextContent('REQ-3')
  expect(items[2]).toHaveTextContent('Not covered by any test')
  expect(items[2]).toHaveAttribute('data-status', 'uncovered')
  expect(screen.getByText('1 of 3 requirements covered')).toBeInTheDocument()
})

test('files changed outside the approved design get a red warning; untouched planned files are listed (F5, I2)', async () => {
  signIn()
  serve(gate3())
  await renderApp()
  await openTab('Code Review IDE')
  const table = await screen.findByRole('table', { name: 'Planned vs changed files' })
  const row = (path) => within(table).getByText(path).closest('tr')
  expect(row('README.md')).toHaveTextContent('Not in the approved design')
  expect(row('README.md')).toHaveAttribute('data-drift', 'undeclared')
  expect(row('app/deps/settings.py')).toHaveTextContent('Planned, not changed')
  expect(row('app/middleware/throttle.py')).toHaveTextContent('Changed as planned')
  const alert = screen.getByRole('alert', { name: 'Design drift' })
  expect(alert).toHaveTextContent('2 files changed outside the approved design')
})

test('the gatekeep.yaml rules this change triggered are shown with their approvals (F5, I5)', async () => {
  signIn()
  serve(gate3())
  await renderApp()
  await openTab('Code Review IDE')
  const panel = await screen.findByRole('region', { name: 'Project policy' })
  expect(panel).toHaveTextContent('gatekeep.yaml')
  expect(panel).toHaveTextContent('app/**')
  expect(panel).toHaveTextContent('1 of 2 approvals')
  expect(panel).toHaveTextContent('Waiting for alice')
  expect(panel).toHaveTextContent('6 of 10 files')
})

test('a blocking policy issue is shown and disables Approve with the reason (I3, I5)', async () => {
  signIn()
  const blocking = [{ code: 'over_file_budget', message: '12 files changed; gatekeep.yaml allows 10' }]
  serve(gate3({ governance: { ...GOVERNANCE, blocking } }))
  await renderApp()
  const b = await banner()
  await waitFor(() => expect(within(b).getByRole('button', { name: 'Approve Gate 3' })).toBeDisabled())
  expect(b).toHaveTextContent('12 files changed; gatekeep.yaml allows 10')
})

test('the banner shows how many approvals Gate 3 still needs (I4)', async () => {
  signIn()
  serve(gate3())
  await renderApp()
  const b = await banner()
  expect(b).toHaveTextContent('Approvals: 1 of 2')
  expect(within(b).getByRole('button', { name: 'Approve Gate 3' })).toBeEnabled()
})

test('a reviewer who already approved this code cannot approve it again (I4)', async () => {
  signIn({ ...SESSION.user, username: 'erin' })
  serve(gate3())
  await renderApp()
  const b = await banner()
  await waitFor(() => expect(within(b).getByRole('button', { name: 'Approve Gate 3' })).toBeDisabled())
  expect(b).toHaveTextContent('You already approved this code')
})

test('whoever approved the design cannot approve the code when the team rule says so (I4)', async () => {
  signIn()
  const excluded = [...GOVERNANCE.excluded, { username: SESSION.user.username, reason: 'approved Gate 2' }]
  serve(gate3({ governance: { ...GOVERNANCE, excluded } }))
  await renderApp()
  const b = await banner()
  await waitFor(() => expect(within(b).getByRole('button', { name: 'Approve Gate 3' })).toBeDisabled())
  expect(b).toHaveTextContent('You approved Gate 2 of this run, so someone else must approve the code')
})

test('an approval that is recorded while more are needed says so (I4)', async () => {
  signIn()
  const after = gate3({ governance: { ...GOVERNANCE, approvals: [...GOVERNANCE.approvals, { username: SESSION.user.username, role: 'Engineer' }] } })
  serve(gate3(), { [`POST /runs/${run0427.id}/decide`]: () => json(200, after) })
  await renderApp()
  fireEvent.click(await within(await banner()).findByRole('button', { name: 'Approve Gate 3' }))
  expect(await screen.findByText(`${run0427.id}: your approval is recorded. Gate 3 needs more approvals.`)).toBeInTheDocument()
})

test('a finished run offers the signed evidence and a Pull Request (I6)', async () => {
  signIn()
  const fetchMock = serve(runAt('done'), {
    [`GET /runs/${run0427.id}/evidence`]: () => json(200, { format: 'gatekeep-evidence/1', run: { id: run0427.id } }),
    [`POST /runs/${run0427.id}/pull-request`]: () => json(201, { url: 'https://github.com/acme/shop/pull/7', number: 7, branch: `gatekeep/${run0427.id}` }),
  })
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  await renderApp()
  const b = await banner()
  fireEvent.click(within(b).getByRole('button', { name: 'Download evidence' }))
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u.endsWith('/evidence'))).toBe(true))
  fireEvent.click(within(b).getByRole('button', { name: 'Create pull request' }))
  const link = await screen.findByRole('link', { name: /pull request #7/i })
  expect(link).toHaveAttribute('href', 'https://github.com/acme/shop/pull/7')
})

test('a refused Pull Request shows the server reason (I6)', async () => {
  signIn()
  serve(runAt('done'), {
    [`POST /runs/${run0427.id}/pull-request`]: () => json(409, { error: 'the code changed since approval', reason: 'code_changed' }),
  })
  await renderApp()
  fireEvent.click(within(await banner()).getByRole('button', { name: 'Create pull request' }))
  expect(await screen.findByText(/the code changed since approval/)).toBeInTheDocument()
})
