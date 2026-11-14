// =========================================================================
// RUN DIFF NORMALIZATION
// run.diff arrives in three shapes: the GateKeep object ({file, lines, by_file}),
// raw unified-diff text, or an array of per-file entries. All become
// { files: [{path, status, add, rem}], linesByFile: {path: diffLines} }.
// =========================================================================
export function parseUnifiedDiff(text) {
  const byFile = {}
  let cur = null
  let oldN = 0
  let newN = 0
  let inHunk = false
  for (const line of String(text).replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const path = line.split(' b/').slice(1).join(' b/')
      cur = byFile[path] = { path, status: 'M', add: 0, rem: 0, lines: [] }
      inHunk = false
      continue
    }
    if (!cur && line.startsWith('+++ ')) {
      // Plain `diff -u` output without a "diff --git" header.
      const path = line.slice(4).replace(/^b\//, '').split('\t')[0]
      cur = byFile[path] = { path, status: 'M', add: 0, rem: 0, lines: [] }
      continue
    }
    if (!cur) continue
    if (!inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'A'
      else if (line.startsWith('deleted file mode')) cur.status = 'D'
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
    if (hunk) { oldN = +hunk[1]; newN = +hunk[2]; inHunk = true; continue }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) { cur.add++; cur.lines.push({ n1: null, n2: newN++, type: 'add', text: line.slice(1) }) }
    else if (line.startsWith('-')) { cur.rem++; cur.lines.push({ n1: oldN++, n2: null, type: 'rem', text: line.slice(1) }) }
    else cur.lines.push({ n1: oldN++, n2: newN++, type: 'ctx', text: line.slice(1) })
  }
  return Object.values(byFile)
}

export function normalizeRunDiff(run) {
  const linesByFile = {}
  const derived = []
  const diff = run?.diff
  const addEntry = (entry) => {
    const path = entry.path || entry.file
    if (!path) return
    const parsed = typeof entry.diff === 'string' ? parseUnifiedDiff(entry.diff)[0] : null
    const lines = entry.lines || parsed?.lines || []
    linesByFile[path] = lines
    derived.push({
      path,
      status: entry.status || parsed?.status || 'M',
      add: entry.add ?? parsed?.add ?? lines.filter((l) => l.type === 'add').length,
      rem: entry.rem ?? parsed?.rem ?? lines.filter((l) => l.type === 'rem').length,
    })
  }
  if (typeof diff === 'string') parseUnifiedDiff(diff).forEach(addEntry)
  else if (Array.isArray(diff)) diff.forEach(addEntry)
  else if (diff && typeof diff === 'object') {
    if (diff.by_file) Object.entries(diff.by_file).forEach(([path, entry]) => addEntry({ ...entry, path }))
    else addEntry(diff)
  }
  const files = run?.files?.length ? run.files : derived
  return { files, linesByFile }
}

// A one-file unified patch from parsed diff lines.
export function patchText(path, lines) {
  let patch = `--- a/${path}\n+++ b/${path}\n`
  lines.forEach((l) => {
    const pfx = l.type === 'add' ? '+' : l.type === 'rem' ? '-' : ' '
    patch += `${pfx}${l.text}\n`
  })
  return patch
}

// Save text as a file in the browser.
export function downloadText(filename, text, type) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
