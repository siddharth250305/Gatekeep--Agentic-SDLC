// Milestone 5, found in the Chrome check: when a decision is recorded but the
// agent service is not running, the backend says so (`pipeline` in the answer)
// and the reviewer must be told, instead of "Gate advanced" with no agent.
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { FakeWebSocket } from './test/setup.js'
import { json, mockBackend, renderApp, run0427, runAt, signIn } from './test/app-harness.jsx'

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const banner = () => screen.findByRole('region', { name: 'Gate status' })

async function approveGate2(pipeline) {
  signIn()
  const answer = { ...runAt('code'), ...(pipeline ? { pipeline } : {}) }
  mockBackend({
    [`GET /runs/${run0427.id}`]: () => json(200, runAt('g2')),
    [`POST /runs/${run0427.id}/decide`]: () => json(200, answer),
  })
  await renderApp()
  fireEvent.click(await within(await banner()).findByRole('button', { name: 'Approve Gate 2' }))
}

test('a recorded decision says when the agent service is not running (G9)', async () => {
  await approveGate2({ resumed: false, reason: 'not_running' })
  expect(await screen.findByText(/Decision recorded, but the agent service is not running/)).toBeInTheDocument()
  expect(screen.queryByText(/Gate advanced/)).toBeNull()
})

test('a recorded decision says when the agent service could not be told', async () => {
  await approveGate2({ resumed: false, reason: 'status_500' })
  expect(await screen.findByText(/Decision recorded, but the agent service could not be reached \(status_500\)/))
    .toBeInTheDocument()
})

test('a normal decision still says the gate advanced', async () => {
  await approveGate2(null)
  expect(await screen.findByText(`${run0427.id} approved. Gate advanced.`)).toBeInTheDocument()
})
