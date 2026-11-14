// =========================================================================
// MARKDOWN PARSER FOR AGENT REQUIREMENTS & DESIGN ARTIFACTS
// Handles both formats GateKeep produces: the pipeline's "User Story / Given /
// When / Then" output and MCP agents' FR-/NFR-/AC-/Q-numbered documents.
// =========================================================================

// Prose clean-up applied to plain text only (never inside `code`).
function sanitizeProse(text) {
  return text
    .replace(/\s*[—–]\s*/g, ' - ')        // em/en dashes -> spaced hyphen
    .replace(/\*\*|__/g, '')               // unbalanced bold markers left after tokenizing
    .replace(/(^|\s)[*_](?=\s|$)/g, '$1')  // stray single * or _
    .replace(/^#+\s+/, '')                 // stray heading hashes
    .replace(/\s{2,}/g, ' ')
}

export function parseInlineTokens(text) {
  if (!text) return []
  // Split on `code`, **bold**, *italic* and [link](url) without touching code contents.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|\[[^\]]+\]\([^)]+\))/g)
  return parts.flatMap((part) => {
    if (!part) return []
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return [{ type: 'code', text: part.slice(1, -1) }]
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return [{ type: 'bold', children: parseInlineTokens(part.slice(2, -2)) }]
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return [{ type: 'italic', children: parseInlineTokens(part.slice(1, -1)) }]
    }
    const link = part.match(/^\[([^\]]+)\]\([^)]+\)$/)
    if (link) return [{ type: 'link', text: link[1] }]
    return [{ type: 'text', text: sanitizeProse(part) }]
  })
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST_MARKER = /^([-*+]|\d+[.)])\s+/
const STORY = /^(?:User\s+)?Story\s*#?(\d+)\s*[:.)\-–—]?\s*(.*)$/i
const GWT = /^(Given|When|Then|And|But)\b[:,]?\s*(.*)$/i

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

export function parseMarkdownBlocks(text) {
  if (!text) return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()
    const indent = Math.min(3, Math.floor((rawLine.length - rawLine.trimStart().length) / 2))

    if (!trimmed) { i++; continue }

    // Fenced code
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') })
      continue
    }

    // Tables: a | row followed by a |---| separator
    if (trimmed.includes('|') && TABLE_SEPARATOR.test(lines[i + 1] || '')) {
      const headers = splitRow(trimmed)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push({ type: 'hr' }); i++; continue }

    // Headings (a heading that names a user story becomes a story card)
    const heading = trimmed.match(/^(#{1,6})\s+(.*?)\s*#*$/)
    if (heading) {
      const level = heading[1].length
      const title = heading[2].replace(/\*\*/g, '').trim()
      const story = title.match(STORY)
      if (story) blocks.push({ type: 'story', num: story[1], text: story[2], level })
      else blocks.push({ type: `h${Math.min(level, 4)}`, text: title, level })
      i++
      continue
    }

    // Strip list markers and bold wrappers to classify the line's content.
    const isListItem = LIST_MARKER.test(trimmed)
    const ordinal = trimmed.match(/^(\d+)[.)]\s+/)?.[1]
    const body = trimmed.replace(LIST_MARKER, '')
    const plain = body.replace(/^\*\*([^*]+)\*\*/, '$1')

    // Bold-only story line: **User Story 2: ...**
    const storyLine = plain.replace(/\*\*/g, '').match(STORY)
    if (storyLine && !isListItem && /^(\*\*)?(User\s+)?Story/i.test(body)) {
      blocks.push({ type: 'story', num: storyLine[1], text: storyLine[2], level: 7 })
      i++
      continue
    }

    // Injection report (requirements agent contract)
    const status = plain.match(/^Status:?\s*\**\s*(NONE|DETECTED)\b/i)
    if (status) { blocks.push({ type: 'status', detected: status[1].toUpperCase() === 'DETECTED' }); i++; continue }
    if (/^NO_ACTIONABLE_FEATURE:/.test(plain)) {
      blocks.push({ type: 'refusal', text: plain.replace(/^NO_ACTIONABLE_FEATURE:\s*/, '') })
      i++
      continue
    }

    // Numbered requirement IDs: AC-1, FR-2, NFR-3, Q4
    const id = plain.match(/^((?:AC|FR|NFR)-\d+|Q\d+)[.:]\s*(.*)$/)
    if (id) {
      const type = id[1].startsWith('AC') ? 'ac' : id[1].startsWith('Q') ? 'question' : 'fr'
      blocks.push({ type, badge: id[1], text: id[2] })
      i++
      continue
    }

    // Given / When / Then (list item, bolded keyword, or continuing an existing scenario)
    const gwt = plain.match(GWT)
    const prev = blocks[blocks.length - 1]
    if (gwt && (isListItem || /^\*\*/.test(body) || prev?.type === 'gwt' || prev?.type === 'label')) {
      blocks.push({ type: 'gwt', keyword: gwt[1][0].toUpperCase() + gwt[1].slice(1).toLowerCase(), text: gwt[2], indent })
      i++
      continue
    }

    // Label lines such as "* **Acceptance Criteria:**"
    const label = body.match(/^\*\*([^*]+?):?\*\*:?$/)
    if (label) { blocks.push({ type: 'label', text: label[1] }); i++; continue }

    if (isListItem) {
      blocks.push({ type: ordinal ? 'olist' : 'bullet', num: ordinal, text: body, indent })
      i++
      continue
    }

    blocks.push({ type: 'p', text: trimmed })
    i++
  }
  return groupStories(blocks)
}

// Nest everything after a story heading inside that story's card.
function groupStories(blocks) {
  const out = []
  let story = null
  for (const block of blocks) {
    const ends = block.type === 'story' || (block.level != null && story && block.level <= story.level) ||
      (block.type === 'hr' && story)
    if (story && ends) { out.push(story); story = null }
    if (block.type === 'story') { story = { ...block, children: [] }; continue }
    if (block.type === 'hr' && !story && out[out.length - 1]?.type === 'story') continue
    if (story) story.children.push(block)
    else out.push(block)
  }
  if (story) out.push(story)
  return out
}

// Counts that tell a reviewer what to check, derived from the document itself.
export function documentStats(blocks) {
  const stats = { stories: 0, criteria: 0, questions: 0, requirements: 0, injection: null }
  const walk = (list) => list.forEach((b) => {
    if (b.type === 'story') { stats.stories++; walk(b.children) }
    if (b.type === 'ac' || (b.type === 'gwt' && b.keyword === 'Then')) stats.criteria++
    if (b.type === 'question') stats.questions++
    if (b.type === 'fr') stats.requirements++
    if (b.type === 'status') stats.injection = b.detected ? 'DETECTED' : 'NONE'
  })
  walk(blocks)
  return stats
}

// The requirements text of a run. Older runs only carried a summary.
export function requirementsText(run) {
  const summary = run?.summary
  return run?.requirements ||
    (summary && typeof summary === 'object'
      ? `${summary.headline || ''}\n\n${summary.sub || ''}\n\n${(summary.checks || []).map((c) => `- ${c}`).join('\n')}`
      : typeof summary === 'string' ? summary : null)
}

// Design helpers: a design value may be a string, a list, or a list of objects.
export function asList(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

export function itemText(item) {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    return item.description || item.mitigation || item.text || item.name || JSON.stringify(item)
  }
  return String(item)
}

// Planned files come from the design object; for free-text designs, the files
// the run actually changed are shown instead (filesSource tells which).
export function plannedFiles(design, runFiles) {
  const designIsObject = Boolean(design) && typeof design === 'object' && !Array.isArray(design)
  if (designIsObject && (design.files_to_create || design.files_to_modify)) {
    return {
      filesToCreate: asList(design.files_to_create).map((p) => ({ path: itemText(p), add: null })),
      filesToModify: asList(design.files_to_modify).map((p) => ({ path: itemText(p), add: null })),
      filesSource: 'design',
    }
  }
  const files = runFiles || []
  return {
    filesToCreate: files.filter((f) => f.status === 'A').map((f) => ({ path: f.path, add: f.add })),
    filesToModify: files.filter((f) => f.status !== 'A').map((f) => ({ path: f.path, add: f.add, rem: f.rem })),
    filesSource: 'run',
  }
}
