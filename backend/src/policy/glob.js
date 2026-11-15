// Path patterns for gatekeep.yaml and design plans (I5, I2). The one
// definition is backend/test/fixtures/glob-cases.json; agents/app/project_policy.py
// implements the same rules and is tested against the same file.
//
//   *        any characters except '/'
//   ?        one character except '/'
//   **       any number of whole folders (as 'a/**', '**/b' or 'a/**/b')
//   dir/     everything under dir (same as 'dir/**')
//   name     a pattern without '/' matches that name in any folder
// A leading '/' or './', '//' and '/./' are ignored. Everything else
// (newlines included) is matched literally. Repeated '**/' count as one, so a
// pattern cannot be made to backtrack for long (ECC review).

const cache = new Map()

export function normalizePath(path) {
  return String(path).trim().replace(/\\/g, '/').replace(/\/(\.\/)+/g, '/').replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '').replace(/^\/+/, '')
}

export function hasGlob(pattern) {
  return /[*?]/.test(pattern)
}

function compile(pattern) {
  let p = normalizePath(pattern).replace(/(\*\*\/)+/g, '**/')
  if (p.endsWith('/')) p += '**'
  if (!p.includes('/')) p = `**/${p}`
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*') {
      const atStart = i === 0 || p[i - 1] === '/'
      if (p[i + 1] === '*' && atStart && p[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 2; continue }
      if (p[i + 1] === '*' && atStart && i + 2 === p.length) { re += '[\\s\\S]*'; i += 1; continue }
      if (p[i + 1] === '*') i += 1 // '**' inside a name acts like '*'
      re += '[^/]*'
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`, 'u')
}

export function globMatch(pattern, path) {
  if (typeof pattern !== 'string' || typeof path !== 'string') return false
  let re = cache.get(pattern)
  if (!re) {
    re = compile(pattern)
    cache.set(pattern, re)
  }
  return re.test(normalizePath(path))
}
