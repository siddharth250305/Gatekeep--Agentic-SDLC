import { useEffect, useMemo, useRef } from 'react'

// Run fn once after calls stop for `ms` (F8: a burst of live events reloads
// the runs once). Under a steady stream of calls it still runs at least every
// `maxWait` ms, so the screen never goes stale. call.cancel() drops a pending call.
export function useDebouncedCallback(fn, ms, maxWait = ms * 4) {
  const fnRef = useRef(fn)
  const timer = useRef(null)
  const firstCall = useRef(null)
  fnRef.current = fn

  useEffect(() => () => clearTimeout(timer.current), [])

  return useMemo(() => {
    const call = () => {
      const now = Date.now()
      if (firstCall.current == null) firstCall.current = now
      clearTimeout(timer.current)
      const wait = Math.max(0, Math.min(ms, firstCall.current + maxWait - now))
      timer.current = setTimeout(() => {
        firstCall.current = null
        fnRef.current()
      }, wait)
    }
    call.cancel = () => {
      clearTimeout(timer.current)
      firstCall.current = null
    }
    return call
  }, [ms, maxWait])
}
