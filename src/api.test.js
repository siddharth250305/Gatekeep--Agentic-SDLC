// F8: live updates reconnect with exponential backoff, and tell the app once
// the connection is back so it can reload what it missed.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FakeWebSocket } from './test/setup.js'

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const down = () => new Response('{}', { status: 503 })

let ticketAnswers
let fetchMock
const ticketCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/ws-ticket')).length

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  ticketAnswers = []
  fetchMock = vi.fn(async () => (ticketAnswers.shift() ?? down)())
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
})

async function connect(handlers = {}) {
  vi.resetModules()
  const { connectRealtime } = await import('./api')
  return connectRealtime(handlers.onMessage ?? (() => {}), handlers)
}

test('each failed reconnect waits twice as long, up to 30 seconds (F8)', async () => {
  const stop = await connect()
  await vi.advanceTimersByTimeAsync(0)
  expect(ticketCalls()).toBe(1)

  // 1 s, 2 s, 4 s, 8 s, 16 s, then capped at 30 s.
  for (const [i, wait] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
    await vi.advanceTimersByTimeAsync(wait - 1)
    expect(ticketCalls()).toBe(i + 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(ticketCalls()).toBe(i + 2)
  }
  stop()
})

test('a good connection resets the wait, and only a reconnect (not the first connect) asks for a reload (F8)', async () => {
  const onReconnect = vi.fn()
  ticketAnswers = [() => ok({ ticket: 't1' }), down, () => ok({ ticket: 't2' })]
  const stop = await connect({ onReconnect })
  await vi.advanceTimersByTimeAsync(0)
  const first = FakeWebSocket.instances.at(-1)
  first.onopen()
  expect(onReconnect).not.toHaveBeenCalled()

  // Drop: retry after 1 s (fails), then 2 s (succeeds).
  first.onclose()
  await vi.advanceTimersByTimeAsync(1000)
  expect(ticketCalls()).toBe(2)
  await vi.advanceTimersByTimeAsync(2000)
  expect(ticketCalls()).toBe(3)
  const second = FakeWebSocket.instances.at(-1)
  expect(second).not.toBe(first)
  second.onopen()
  expect(onReconnect).toHaveBeenCalledTimes(1)

  // Connected again, so the next drop starts from 1 s again.
  ticketAnswers = [() => ok({ ticket: 't3' })]
  second.onclose()
  await vi.advanceTimersByTimeAsync(1000)
  expect(ticketCalls()).toBe(4)
  stop()
})

test('after stop() nothing reconnects (F8)', async () => {
  const stop = await connect()
  await vi.advanceTimersByTimeAsync(0)
  stop()
  await vi.advanceTimersByTimeAsync(120000)
  expect(ticketCalls()).toBe(1)
})

test('if the server was down when the page opened, the first successful connection also reloads (F8, review finding)', async () => {
  // The page loaded with the API down, so it shows nothing; the first socket
  // that opens must trigger the catch-up reload too.
  const onReconnect = vi.fn()
  ticketAnswers = [down, () => ok({ ticket: 't1' })]
  const stop = await connect({ onReconnect })
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(1000)
  FakeWebSocket.instances.at(-1).onopen()
  expect(onReconnect).toHaveBeenCalledTimes(1)
  stop()
})
