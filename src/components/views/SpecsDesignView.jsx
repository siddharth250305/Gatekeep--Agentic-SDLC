import { useState, useMemo } from 'react'
import {
  FileText, ShieldAlert, ShieldCheck, Cpu, CircleCheck, MessageSquare, Trash, Send,
  FileCode, Copy, Check, HelpCircle, FileCheck, ListChecks, BookOpen, TriangleAlert,
  LayoutGrid, Braces, FilePlus2, FilePen, Clock,
} from 'lucide-react'

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

function parseInlineTokens(text) {
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

function RenderInline({ text }) {
  const tokens = useMemo(() => parseInlineTokens(text), [text])
  const renderToken = (tok, idx) => {
    if (tok.type === 'code') {
      return (
        <code key={idx} className="rounded-md bg-black/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-accent break-words">
          {tok.text}
        </code>
      )
    }
    if (tok.type === 'bold') return <strong key={idx} className="font-semibold text-ink">{tok.children.map(renderToken)}</strong>
    if (tok.type === 'italic') return <em key={idx} className="italic text-ink">{tok.children.map(renderToken)}</em>
    // Links from agent output are shown as text only: never navigate to an agent-supplied URL.
    if (tok.type === 'link') return <span key={idx} className="text-accent underline decoration-accent/30">{tok.text}</span>
    return <span key={idx}>{tok.text}</span>
  }
  return <>{tokens.map(renderToken)}</>
}

function CodeBlockViewer({ lang, content }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="group relative my-3 max-w-full overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-[#f8f9fa] dark:bg-[#0d1117] text-[#24292f] dark:text-[#e6edf3] shadow-sm">
      <div className="flex items-center justify-between border-b border-black/[0.08] dark:border-[#30363d] bg-[#f0f2f5] dark:bg-[#161b22] px-3.5 py-1.5 text-[11px] font-mono text-muted dark:text-[#8b949e]">
        <span>{lang || 'text'}</span>
        <button type="button" onClick={handleCopy} className="flex items-center gap-1 text-muted hover:text-ink dark:text-[#8b949e] dark:hover:text-[#f0f6fc] transition-colors">
          {copied ? <Check size={12} className="text-[#34c759] dark:text-[#3fb950]" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {/* Diagrams keep their alignment and scroll inside the block; they never widen the page. */}
      <pre className="max-h-96 overflow-auto p-3.5 font-mono text-[12px] leading-relaxed whitespace-pre">{content}</pre>
    </div>
  )
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST_MARKER = /^([-*+]|\d+[.)])\s+/
const STORY = /^(?:User\s+)?Story\s*#?(\d+)\s*[:.)\-–—]?\s*(.*)$/i
const GWT = /^(Given|When|Then|And|But)\b[:,]?\s*(.*)$/i

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function parseMarkdownBlocks(text) {
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
function documentStats(blocks) {
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

const GWT_STYLE = {
  Given: { border: 'border-l-[#0071e3]', pill: 'bg-[#0071e3]/10 dark:bg-[#0071e3]/25 text-[#0058b0] dark:text-[#409cff]', icon: 'text-accent dark:text-[#409cff]' },
  When: { border: 'border-l-[#ff9500]', pill: 'bg-[#ff9500]/15 dark:bg-[#ff9500]/25 text-[#8f4700] dark:text-[#ff9f0a]', icon: 'text-[#8f4700] dark:text-[#ff9f0a]' },
  Then: { border: 'border-l-[#34c759]', pill: 'bg-[#34c759]/15 dark:bg-[#34c759]/25 text-[#17692e] dark:text-[#34c759]', icon: 'text-[#17692e] dark:text-[#34c759]' },
}

function BlockList({ blocks }) {
  let lastKeyword = 'Given'
  return (
    <div className="space-y-3 min-w-0">
      {blocks.map((block, idx) => {
        if (block.type === 'gwt') {
          const styleKey = block.keyword === 'And' || block.keyword === 'But' ? lastKeyword : block.keyword
          lastKeyword = styleKey
          const style = GWT_STYLE[styleKey] || GWT_STYLE.Given
          return (
            <div key={idx} className={`flex items-start gap-2.5 rounded-r-lg border-l-[3px] ${style.border} bg-black/[0.015] dark:bg-white/[0.04] py-2 pl-3 pr-3`}
              style={{ marginLeft: `${Math.max(0, block.indent - 1) * 12}px` }}>
              <CircleCheck size={14} className={`mt-0.5 shrink-0 ${style.icon}`} />
              <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink dark:text-[#f5f5f7] break-words">
                <span className={`mr-2 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${style.pill}`}>{block.keyword}</span>
                <RenderInline text={block.text} />
              </div>
            </div>
          )
        }
        return <Block key={idx} block={block} />
      })}
    </div>
  )
}

function Block({ block }) {
  switch (block.type) {
    case 'h1':
      return (
        <div className="border-b border-black/[0.08] dark:border-white/[0.08] pb-3 pt-1">
          <h1 className="flex items-start gap-2 text-[18px] font-bold tracking-tight text-ink dark:text-white break-words">
            <FileCheck size={20} className="mt-0.5 shrink-0 text-accent dark:text-[#4da3ff]" />
            <span className="min-w-0"><RenderInline text={block.text} /></span>
          </h1>
        </div>
      )
    case 'h2':
      return (
        <div className="border-b border-black/[0.05] dark:border-white/[0.08] pb-2 pt-4">
          <h2 className="text-[14.5px] font-semibold tracking-tight text-ink dark:text-white break-words"><RenderInline text={block.text} /></h2>
        </div>
      )
    case 'h3':
    case 'h4':
      return <h3 className="pt-2 text-[13.5px] font-semibold tracking-tight text-ink dark:text-white break-words"><RenderInline text={block.text} /></h3>
    case 'hr':
      return <div className="my-2 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
    case 'code':
      return <CodeBlockViewer lang={block.lang} content={block.content} />
    case 'table':
      return (
        <div className="my-3 max-w-full overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#141416]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="surface-raised border-b border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.04]">
                  {block.headers.map((h, i) => (
                    <th key={i} className="px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted dark:text-[#a1a1aa] whitespace-nowrap">
                      <RenderInline text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {block.rows.map((row, r) => (
                  <tr key={r} className="hover:bg-black/[0.015] dark:hover:bg-white/[0.03] transition-colors">
                    {block.headers.map((_, c) => (
                      <td key={c} className="min-w-[6rem] max-w-[28rem] px-3.5 py-2.5 align-top text-ink dark:text-[#f5f5f7] leading-relaxed break-words">
                        <RenderInline text={row[c] || ''} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    case 'story':
      return (
        <div className="card border border-black/[0.06] dark:border-white/[0.08] p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-accent/10 dark:bg-accent/20 px-2 font-mono text-[11px] font-bold text-accent dark:text-[#4da3ff]">
              <BookOpen size={12} /> Story {block.num}
            </span>
            <h3 className="min-w-0 pt-1 text-[13.5px] font-semibold leading-snug text-ink dark:text-white break-words">
              <RenderInline text={block.text || `User Story ${block.num}`} />
            </h3>
          </div>
          {block.children.length > 0 && <div className="mt-4"><BlockList blocks={block.children} /></div>}
        </div>
      )
    case 'label':
      return (
        <div className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint dark:text-[#8e8e93]">
          <ListChecks size={13} className="text-[#17692e] dark:text-[#34c759]" /> <RenderInline text={block.text} />
        </div>
      )
    case 'status':
      return block.detected ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-[#ff3b30]/30 dark:border-[#ff3b30]/40 bg-[#ff3b30]/[0.06] dark:bg-[#ff3b30]/15 p-3 text-[12.5px] font-semibold text-[#c4161c] dark:text-[#ff453a]">
          <ShieldAlert size={16} className="shrink-0" /> Prompt injection detected in the inputs. Read the findings below before approving.
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-[#34c759]/30 dark:border-[#34c759]/40 bg-[#34c759]/[0.05] dark:bg-[#34c759]/15 p-3 text-[12.5px] font-medium text-[#17692e] dark:text-[#34c759]">
          <ShieldCheck size={16} className="shrink-0" /> No prompt injection detected in the brief, repository or feedback.
        </div>
      )
    case 'refusal':
      return (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#ff9500]/30 dark:border-[#ff9500]/40 bg-[#ff9500]/[0.06] dark:bg-[#ff9500]/15 p-3.5 text-[12.5px] text-ink dark:text-[#f5f5f7]">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[#8f4700] dark:text-[#ff9f0a]" />
          <div><div className="font-semibold text-[#8f4700] dark:text-[#ff9f0a]">No actionable feature in the brief</div><RenderInline text={block.text} /></div>
        </div>
      )
    case 'ac':
      return (
        <div className="flex items-start gap-3 rounded-xl border border-[#34c759]/30 dark:border-[#34c759]/40 bg-[#34c759]/[0.05] dark:bg-[#34c759]/15 p-3.5">
          <CircleCheck size={16} className="mt-0.5 shrink-0 text-[#17692e] dark:text-[#34c759]" />
          <div className="min-w-0 flex-1">
            <span className="rounded-md bg-[#34c759]/20 dark:bg-[#34c759]/30 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[#17692e] dark:text-[#34c759]">{block.badge}</span>
            <div className="mt-1 text-[12.5px] leading-relaxed text-ink dark:text-[#f5f5f7] break-words"><RenderInline text={block.text} /></div>
          </div>
        </div>
      )
    case 'fr': {
      const isNFR = block.badge.startsWith('NFR')
      return (
        <div className="flex items-start gap-3 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.04] p-3.5">
          <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-bold ${
            isNFR ? 'border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-400/30 dark:bg-purple-500/15 dark:text-purple-300' : 'border-accent/20 dark:border-accent/30 bg-accent/10 dark:bg-accent/20 text-accent dark:text-[#4da3ff]'
          }`}>{block.badge}</span>
          <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink dark:text-[#f5f5f7] break-words"><RenderInline text={block.text} /></div>
        </div>
      )
    }
    case 'question':
      return (
        <div className="flex items-start gap-3 rounded-xl border border-[#ff9500]/30 dark:border-[#ff9500]/40 bg-[#ff9500]/[0.04] dark:bg-[#ff9500]/15 p-3.5">
          <HelpCircle size={16} className="mt-0.5 shrink-0 text-[#8f4700] dark:text-[#ff9f0a]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[#ff9500]/20 dark:bg-[#ff9500]/30 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[#8f4700] dark:text-[#ff9f0a]">{block.badge}</span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#8f4700] dark:text-[#ff9f0a]">Decision needed</span>
            </div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-ink dark:text-[#f5f5f7] break-words"><RenderInline text={block.text} /></div>
          </div>
        </div>
      )
    case 'bullet':
    case 'olist':
      return (
        <div className="flex items-start gap-2.5" style={{ paddingLeft: `${8 + block.indent * 16}px` }}>
          {block.type === 'olist'
            ? <span className="mt-px shrink-0 font-mono text-[11px] font-semibold text-faint">{block.num}.</span>
            : <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />}
          <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink break-words"><RenderInline text={block.text} /></div>
        </div>
      )
    default:
      return <p className="text-[12.5px] leading-relaxed text-ink break-words"><RenderInline text={block.text} /></p>
  }
}

// Structured renderer for agent-written requirements and design documents.
function RequirementsRenderer({ blocks }) {
  if (!blocks.length) {
    return <div className="py-12 text-center text-[13px] text-muted">No specification document available for this run.</div>
  }
  return <div className="font-sans text-[13px] leading-relaxed text-ink"><BlockList blocks={blocks} /></div>
}

// =========================================================================
// DESIGN: VISUAL CARDS + RAW JSON
// =========================================================================

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function HighlightedJson({ text }) {
  const out = []
  let last = 0
  let m
  JSON_TOKEN.lastIndex = 0
  while ((m = JSON_TOKEN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) {
      out.push(<span key={m.index} className={m[2] ? 'text-[#79c0ff]' : 'text-[#a5d6ff]'}>{m[1]}</span>)
      if (m[2]) out.push(m[2])
    } else if (m[3]) {
      out.push(<span key={m.index} className="text-[#ff7b72]">{m[3]}</span>)
    } else {
      out.push(<span key={m.index} className="text-[#ffa657]">{m[4]}</span>)
    }
    last = JSON_TOKEN.lastIndex
  }
  out.push(text.slice(last))
  return out
}

function asList(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

function itemText(item) {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    return item.description || item.mitigation || item.text || item.name || JSON.stringify(item)
  }
  return String(item)
}

function FileTreeCard({ title, icon: Icon, tone, files, marker }) {
  return (
    <div className="surface-raised min-w-0 rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4">
      <div className="flex items-center justify-between text-[12px] font-semibold text-ink">
        <span className="flex items-center gap-2"><Icon size={14} className={tone.icon} />{title}</span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${tone.badge}`}>{files.length}</span>
      </div>
      <div className="mt-2.5 flex flex-col font-mono text-[12px]">
        {files.length ? files.map((f, i) => (
          <div key={f.path} className={`flex min-w-0 items-center justify-between gap-2 ${tone.text}`}>
            <span className="flex min-w-0 items-center">
              <span className="shrink-0 select-none text-faint">{i === files.length - 1 ? '└─' : '├─'}&nbsp;</span>
              <span className="shrink-0">{marker}&nbsp;</span>
              <span className="truncate" title={f.path}>{f.path}</span>
            </span>
            {f.add != null && <span className="shrink-0 text-[10px] text-faint">+{f.add}{f.rem ? ` -${f.rem}` : ''}</span>}
          </div>
        )) : <span className="font-sans text-[12px] text-muted">None</span>}
      </div>
    </div>
  )
}

const THREAT_TONES = ['bg-[#ff3b30]/10 dark:bg-[#ff3b30]/20 text-[#c4161c] dark:text-[#ff453a]', 'bg-[#ff9500]/15 dark:bg-[#ff9500]/20 text-[#8f4700] dark:text-[#ff9f0a]', 'bg-accent/10 dark:bg-accent/20 text-accent dark:text-[#4da3ff]', 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300']
const PLAN_KEYS = new Set(['files_to_modify', 'files_to_create', 'threat_model', 'threats'])

function DesignCards({ design, filesToCreate, filesToModify, filesSource }) {
  const threats = asList(design.threat_model ?? design.threats)
  const otherSections = Object.entries(design).filter(([k, v]) => !PLAN_KEYS.has(k) && asList(v).length)
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#8e8e93]">
          {filesSource === 'run' ? 'Files changed in this run' : 'Target file plan'} ({filesToCreate.length + filesToModify.length})
        </h3>
        <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FileTreeCard title="Files to create" icon={FilePlus2} marker="+" files={filesToCreate}
            tone={{ icon: 'text-[#17692e] dark:text-[#34c759]', badge: 'bg-[#34c759]/15 dark:bg-[#34c759]/25 text-[#17692e] dark:text-[#34c759]', text: 'text-[#17692e] dark:text-[#34c759]' }} />
          <FileTreeCard title="Files to modify" icon={FilePen} marker="~" files={filesToModify}
            tone={{ icon: 'text-accent dark:text-[#4da3ff]', badge: 'bg-accent/15 dark:bg-accent/25 text-accent dark:text-[#4da3ff]', text: 'text-accent dark:text-[#4da3ff]' }} />
        </div>
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#8e8e93]">
          <ShieldAlert size={14} className="text-amber" /> Threat model
        </h3>
        {threats.length ? (
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {threats.map((t, i) => {
              const category = typeof t === 'object' && t ? (t.category || t.threat || t.stride) : null
              return (
                <div key={i} className="min-w-0 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.04] p-3">
                  <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${THREAT_TONES[i % THREAT_TONES.length]}`}>
                    {category || `T${i + 1}`}
                  </span>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted dark:text-[#a1a1aa] break-words"><RenderInline text={itemText(t)} /></p>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="mt-2.5 rounded-xl border border-dashed border-black/[0.1] dark:border-white/[0.12] p-3 text-[12px] text-muted dark:text-[#a1a1aa]">
            This design has no threat model. Ask the agent for one before approving if the change touches user data or security.
          </p>
        )}
      </div>

      {otherSections.map(([key, value]) => (
        <div key={key}>
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#8e8e93]">{key.replace(/_/g, ' ')}</h3>
          <div className="mt-2.5 space-y-1.5 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.04] p-4">
            {asList(value).map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink dark:text-[#f5f5f7]">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                <span className="min-w-0 break-words"><RenderInline text={itemText(item)} /></span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Gate badge from the run's real step state, never a hardcoded claim.
function GateBadge({ run, stepKey, role }) {
  const step = run?.steps?.find((s) => s.key === stepKey)
  const state = step?.state
  if (state === 'approved') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#34c759]/25 dark:border-[#34c759]/35 bg-[#34c759]/10 dark:bg-[#34c759]/20 px-3 py-1 font-mono text-[11px] font-semibold text-[#17692e] dark:text-[#34c759]" title={step.at || ''}>
        <Check size={11} strokeWidth={3} /> Approved by {role}
      </span>
    )
  }
  if (state === 'rejected') {
    return <span className="shrink-0 rounded-full border border-[#ff3b30]/25 dark:border-[#ff3b30]/35 bg-[#ff3b30]/10 dark:bg-[#ff3b30]/20 px-3 py-1 font-mono text-[11px] font-semibold text-[#c4161c] dark:text-[#ff453a]">Rejected by {role}</span>
  }
  if (state === 'active' || (run?.awaiting && run?.gate === role)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#ff9500]/25 dark:border-[#ff9500]/35 bg-[#ff9500]/10 dark:bg-[#ff9500]/20 px-3 py-1 font-mono text-[11px] font-semibold text-[#8f4700] dark:text-[#ff9f0a]">
        <Clock size={11} /> Awaiting {role}
      </span>
    )
  }
  return <span className="shrink-0 rounded-full bg-black/[0.04] dark:bg-white/[0.08] px-3 py-1 font-mono text-[11px] font-semibold text-muted dark:text-[#a1a1aa]">Not reviewed yet</span>
}

function StatChip({ icon: Icon, value, label, tone }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-[#1a1a1d] px-3 py-2.5">
      <Icon size={16} className={`shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="font-mono text-[15px] font-semibold leading-none text-ink dark:text-white">{value}</div>
        <div className="mt-1 text-[11px] leading-tight text-muted dark:text-[#a1a1aa]">{label}</div>
      </div>
    </div>
  )
}

// =========================================================================
// MAIN SPECS & DESIGN VIEW COMPONENT
// =========================================================================

export default function SpecsDesignView({ run, reviewerRole, onAddComment, onDeleteComment }) {
  const [activeTab, setActiveTab] = useState('requirements')
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [designViewMode, setDesignViewMode] = useState('cards') // 'cards' | 'raw'
  const [copiedSpec, setCopiedSpec] = useState(false)

  const summary = run?.summary
  const reqText = run?.requirements ||
    (summary && typeof summary === 'object'
      ? `${summary.headline || ''}\n\n${summary.sub || ''}\n\n${(summary.checks || []).map((c) => `- ${c}`).join('\n')}`
      : typeof summary === 'string' ? summary : null)
  const design = run?.design ?? null
  const designIsObject = Boolean(design) && typeof design === 'object' && !Array.isArray(design)
  const designString = designIsObject || Array.isArray(design) ? JSON.stringify(design, null, 2) : (design || '')

  const reqBlocks = useMemo(() => parseMarkdownBlocks(reqText || ''), [reqText])
  const reqStats = useMemo(() => documentStats(reqBlocks), [reqBlocks])
  const designBlocks = useMemo(() => (designIsObject ? [] : parseMarkdownBlocks(designString)), [designIsObject, designString])

  // Planned files come from the design object; for free-text designs, show what the run actually changed.
  const { filesToCreate, filesToModify, filesSource } = useMemo(() => {
    if (designIsObject && (design.files_to_create || design.files_to_modify)) {
      return {
        filesToCreate: asList(design.files_to_create).map((p) => ({ path: itemText(p), add: null })),
        filesToModify: asList(design.files_to_modify).map((p) => ({ path: itemText(p), add: null })),
        filesSource: 'design',
      }
    }
    const files = run?.files || []
    return {
      filesToCreate: files.filter((f) => f.status === 'A').map((f) => ({ path: f.path, add: f.add })),
      filesToModify: files.filter((f) => f.status !== 'A').map((f) => ({ path: f.path, add: f.add, rem: f.rem })),
      filesSource: 'run',
    }
  }, [designIsObject, design, run?.files])

  if (!run) {
    return (
      <div className="card p-12 text-center text-[13px] text-muted shadow-card">
        <FileText size={32} className="mx-auto mb-3 text-faint" />
        <h3 className="text-[16px] font-semibold text-ink">No Run Selected</h3>
        <p className="mt-1 text-[13px] text-muted">Select an active run from the header or launch a new workflow to view requirements.</p>
      </div>
    )
  }

  const comments = (run?.comments || []).filter(
    (c) => c.phase === activeTab || (activeTab === 'requirements' && c.phase === 'req')
  )

  const handlePostComment = async () => {
    if (!commentText.trim() || !onAddComment) return
    setSubmitting(true)
    try {
      await onAddComment({
        text: commentText.trim(),
        phase: activeTab,
        role: reviewerRole,
        file: activeTab === 'design' ? (filesToModify[0]?.path || filesToCreate[0]?.path || 'design.md') : 'requirements.md',
        line: null,
      })
      setCommentText('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopySpec = () => {
    navigator.clipboard.writeText(designString)
    setCopiedSpec(true)
    setTimeout(() => setCopiedSpec(false), 2000)
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Run Context Header Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.05] bg-black/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 font-mono text-[13px] font-bold text-accent">
            {run?.id?.replace(/^RUN-/, '').slice(0, 4) || 'RUN'}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span className="font-mono text-[13px] font-bold text-ink dark:text-[#f5f5f7]">{run?.id}</span>
              <span className="text-muted dark:text-[#a1a1aa]">·</span>
              <span className="truncate text-[12px] font-semibold text-accent">{run?.repo || 'Local Workspace'}</span>
              {run?.branch && <span className="font-mono text-[11px] text-faint dark:text-[#8e8e93]">({run.branch})</span>}
            </div>
            <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted dark:text-[#a1a1aa]">{run?.brief}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-3 py-1 font-mono text-[11px] font-semibold sm:self-auto ${
          run?.awaiting ? 'border border-[#ff9500]/25 bg-[#ff9500]/15 text-[#8f4700] dark:text-[#ff9f0a]'
            : run?.status === 'approved' ? 'border border-[#34c759]/25 bg-[#34c759]/15 text-[#17692e] dark:text-[#34c759]'
              : 'bg-black/[0.04] text-muted dark:bg-white/[0.06] dark:text-[#a1a1aa]'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${run?.awaiting ? 'animate-pulse bg-[#ff9500]' : 'bg-[#34c759]'}`} />
          <span>{run?.awaiting ? `Awaiting Gate: ${run?.gate || 'Review'}` : run?.status || 'Active'}</span>
        </span>
      </div>

      {/* Sub-header navigation with Apple Segmented Control */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.08]">
        <div className="segmented-control">
          <button type="button" onClick={() => setActiveTab('requirements')}
            className={`segmented-item ${activeTab === 'requirements' ? 'segmented-item-active' : ''}`}>
            <FileText size={14} />
            <span><span className="hidden sm:inline">Phase 1: </span>Requirements</span>
          </button>
          <button type="button" onClick={() => setActiveTab('design')}
            className={`segmented-item ${activeTab === 'design' ? 'segmented-item-active' : ''}`}>
            <Cpu size={14} />
            <span><span className="hidden sm:inline">Phase 2: Technical </span>Design</span>
          </button>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-[12px] text-faint dark:bg-white/[0.06] dark:text-[#8e8e93]">
          <MessageSquare size={13} className="text-accent" />
          <span className="tabnum font-mono font-semibold text-ink dark:text-[#f5f5f7]">{comments.length}</span> review notes
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Main Content Area */}
        <div className="card min-w-0 p-4 shadow-card sm:p-6">
          {activeTab === 'requirements' && (
            <div>
              <div className="flex flex-col gap-3 border-b border-black/[0.06] pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.08]">
                <div>
                  <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink dark:text-[#f5f5f7]">Engineering Requirements</h2>
                  <p className="mt-0.5 text-[13px] text-muted dark:text-[#a1a1aa]">User stories, acceptance criteria, and open questions from the requirements agent.</p>
                </div>
                <div className="shrink-0 self-start sm:self-auto"><GateBadge run={run} stepKey="g1" role="Planner" /></div>
              </div>

              {reqText ? (
                <div className="mt-5 space-y-5">
                  {/* What a reviewer needs to check, counted from the document itself */}
                  <div className="grid grid-cols-2 gap-2.5 2xl:grid-cols-4">
                    <StatChip icon={BookOpen} value={reqStats.stories || reqStats.requirements} label={reqStats.stories ? 'User stories' : 'Requirements'} tone="text-accent" />
                    <StatChip icon={ListChecks} value={reqStats.criteria} label="Acceptance criteria" tone="text-[#17692e] dark:text-[#34c759]" />
                    <StatChip icon={HelpCircle} value={reqStats.questions} label="Decisions needed" tone="text-[#8f4700] dark:text-[#ff9f0a]" />
                    <StatChip
                      icon={reqStats.injection === 'DETECTED' ? ShieldAlert : ShieldCheck}
                      value={reqStats.injection === 'DETECTED' ? 'Found' : reqStats.injection === 'NONE' ? 'None' : 'n/a'}
                      label="Prompt injection"
                      tone={reqStats.injection === 'DETECTED' ? 'text-[#c4161c] dark:text-[#ff453a]' : 'text-[#17692e] dark:text-[#34c759]'}
                    />
                  </div>
                  {reqStats.questions > 0 && (
                    <p className="flex items-start gap-2 rounded-xl border border-[#ff9500]/25 bg-[#ff9500]/[0.05] p-3 text-[12.5px] text-ink dark:bg-[#ff9500]/10 dark:text-[#f5f5f7]">
                      <HelpCircle size={15} className="mt-0.5 shrink-0 text-[#8f4700] dark:text-[#ff9f0a]" />
                      <span>The agent asked {reqStats.questions} question{reqStats.questions === 1 ? '' : 's'}. Answer them in a review note before approving, or the agent will build its own defaults.</span>
                    </p>
                  )}
                  <div className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4 sm:p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
                    <RequirementsRenderer blocks={reqBlocks} />
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-[13px] text-muted dark:text-[#a1a1aa]">No requirements generated for this run yet. Run the pipeline to begin.</div>
              )}
            </div>
          )}

          {activeTab === 'design' && (
            <div>
              <div className="flex flex-col gap-3 border-b border-black/[0.06] pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.08]">
                <div>
                  <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink dark:text-[#f5f5f7]">Technical Architecture &amp; File Plan</h2>
                  <p className="mt-0.5 text-[13px] text-muted dark:text-[#a1a1aa]">The agent's design: files, threat model, and implementation plan.</p>
                </div>
                <div className="shrink-0 self-start sm:self-auto"><GateBadge run={run} stepKey="g2" role="Engineer" /></div>
              </div>

              {design ? (
                <div className="mt-5 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#8e8e93]">Architecture manifest</h3>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-[11px] font-medium dark:bg-white/[0.06]" role="tablist">
                        <button type="button" role="tab" aria-selected={designViewMode === 'cards'} onClick={() => setDesignViewMode('cards')}
                          className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${designViewMode === 'cards' ? 'segmented-item-active bg-white font-semibold text-ink shadow-sm dark:bg-[#252529] dark:text-white' : 'text-muted hover:text-ink dark:text-[#a1a1aa] dark:hover:text-white'}`}>
                          <LayoutGrid size={11} /> Visual Cards
                        </button>
                        <button type="button" role="tab" aria-selected={designViewMode === 'raw'} onClick={() => setDesignViewMode('raw')}
                          className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${designViewMode === 'raw' ? 'segmented-item-active bg-white font-semibold text-ink shadow-sm dark:bg-[#252529] dark:text-white' : 'text-muted hover:text-ink dark:text-[#a1a1aa] dark:hover:text-white'}`}>
                          <Braces size={11} /> {designIsObject ? 'Raw JSON' : 'Raw Text'}
                        </button>
                      </div>
                      <button type="button" onClick={handleCopySpec} title="Copy the design"
                        className="flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white px-2 py-1 text-[11px] font-medium text-ink shadow-sm transition-colors hover:bg-black/[0.03] dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-[#f5f5f7] dark:hover:bg-white/[0.1]">
                        {copiedSpec ? <Check size={12} className="text-[#34c759]" /> : <Copy size={12} />}
                        <span>{copiedSpec ? 'Copied' : designIsObject ? 'Copy JSON' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 min-w-0">
                    {designViewMode === 'raw' ? (
                      <pre className="max-h-[32rem] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-2xl border border-black/[0.06] dark:border-white/[0.1] bg-[#f8f9fa] dark:bg-[#090b0e] p-4 font-mono text-[11.5px] leading-relaxed text-[#24292f] dark:text-[#e6edf3]">
                        {designIsObject ? <HighlightedJson text={designString} /> : designString}
                      </pre>
                    ) : designIsObject ? (
                      <DesignCards design={design} filesToCreate={filesToCreate} filesToModify={filesToModify} filesSource={filesSource} />
                    ) : (
                      <div className="space-y-6">
                        {filesToCreate.length + filesToModify.length > 0 && (
                          <div>
                            <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#8e8e93]">
                              Files changed in this run ({filesToCreate.length + filesToModify.length})
                            </h3>
                            <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <FileTreeCard title="Created" icon={FilePlus2} marker="+" files={filesToCreate}
                                tone={{ icon: 'text-[#17692e] dark:text-[#34c759]', badge: 'bg-[#34c759]/15 text-[#17692e] dark:text-[#34c759]', text: 'text-[#17692e] dark:text-[#34c759]' }} />
                              <FileTreeCard title="Modified" icon={FilePen} marker="~" files={filesToModify}
                                tone={{ icon: 'text-accent', badge: 'bg-accent/15 text-accent', text: 'text-accent' }} />
                            </div>
                          </div>
                        )}
                        <div className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4 sm:p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
                          <RequirementsRenderer blocks={designBlocks} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-[13px] text-muted dark:text-[#a1a1aa]">No design submitted for this run yet.</div>
              )}
            </div>
          )}
        </div>

        {/* Phase Review Comments Sidebar */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="card p-5 shadow-card">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink dark:text-[#f5f5f7]">
              <MessageSquare size={16} className="text-accent" />
              <span>Phase Review Notes</span>
            </h3>
            <p className="mt-1 text-[12px] text-muted dark:text-[#a1a1aa]">Add feedback on this {activeTab} phase. These comments are fed to the agent during rework.</p>

            <div className="mt-4 flex flex-col gap-2.5">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={`Leave feedback on ${activeTab}...`}
                rows={3}
                className="w-full rounded-xl border border-black/[0.08] bg-white p-3 text-[12.5px] text-ink shadow-sm outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/[0.12] dark:bg-[#1a1a1d] dark:text-[#f5f5f7] dark:placeholder-[#71717a]"
              />
              <div className="flex justify-end">
                <button type="button" onClick={handlePostComment} disabled={!commentText.trim() || submitting} className="btn-primary !px-3 !py-1.5 !text-[12px]">
                  <Send size={12} /> Post Note
                </button>
              </div>
            </div>

            <div className="mt-5 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
              <div className="text-[12px] font-semibold text-ink dark:text-[#f5f5f7]">Review Notes ({comments.length})</div>
              {comments.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-faint dark:text-[#8e8e93]">No review comments yet on this phase.</div>
              ) : (
                <div className="mt-3 flex flex-col gap-2.5">
                  {comments.map((c) => (
                    <div key={c.id} className="surface-raised rounded-xl border border-black/[0.06] bg-black/[0.015] p-3 text-[12px] dark:border-white/[0.08] dark:bg-white/[0.03]">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-ink dark:text-[#f5f5f7]">{c.author || 'Reviewer'}</span>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9.5px] font-medium text-accent">{c.role}</span>
                          {onDeleteComment && (
                            <button type="button" onClick={() => onDeleteComment(c.id)} className="text-faint transition-colors hover:text-red dark:text-[#8e8e93]" title="Delete note">
                              <Trash size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed text-ink dark:text-[#e4e4e7]">{c.text}</p>
                      <div className="mt-1 font-mono text-[10px] text-faint dark:text-[#8e8e93]">{new Date(c.createdAt || Date.now()).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

