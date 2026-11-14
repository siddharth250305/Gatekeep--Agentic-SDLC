// F8: refresh debounce. A burst collapses into one call; a steady stream still
// calls at least every maxWait, so the screen never goes stale.
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useDebouncedCallback } from './useDebouncedCallback'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('a steady stream of calls still runs at least every maxWait (F8)', () => {
  const fn = vi.fn()
  const { result } = renderHook(() => useDebouncedCallback(fn, 250, 1000))
  // One call every 100 ms for 3 s: never 250 ms quiet.
  for (let t = 0; t < 3000; t += 100) { result.current(); vi.advanceTimersByTime(100) }
  expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(fn.mock.calls.length).toBeLessThanOrEqual(4)
})
