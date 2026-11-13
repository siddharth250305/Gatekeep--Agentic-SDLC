// Login throttle, kept in memory (one backend process).
//
// Each key (a username, or a client address) may use `max` attempts per
// `windowMs`. Once spent, further logins for that key get 429 until the window
// that started with its first attempt ends. This stops password guessing, and
// because the address is counted before the password is hashed, a burst of
// requests cannot queue unlimited scrypt work either.
export function createLimiter({ max, windowMs, maxKeys = 10_000, now = Date.now }) {
  const hits = new Map() // key -> { count, resetAt }

  function live(key) {
    const e = hits.get(key)
    if (e && e.resetAt <= now()) {
      hits.delete(key)
      return null
    }
    return e
  }

  return {
    // Seconds until `key` may try again, or 0 when it may try now.
    retryAfter(key) {
      const e = live(key)
      return e && e.count >= max ? Math.ceil((e.resetAt - now()) / 1000) : 0
    },
    hit(key) {
      const e = live(key)
      if (e) {
        e.count++
        return
      }
      // Bounded memory: drop the oldest key when full.
      if (hits.size >= maxKeys) hits.delete(hits.keys().next().value)
      hits.set(key, { count: 1, resetAt: now() + windowMs })
    },
    reset(key) {
      hits.delete(key)
    },
  }
}
