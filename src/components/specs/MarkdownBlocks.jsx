import { useState, useMemo } from 'react'
import {
  ShieldAlert, ShieldCheck, CircleCheck, Copy, Check, HelpCircle, FileCheck, ListChecks, BookOpen, TriangleAlert,
} from 'lucide-react'
import { parseInlineTokens } from '../../lib/markdown'

export function RenderInline({ text }) {
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
export function RequirementsRenderer({ blocks, empty = 'No specification document available for this run.' }) {
  if (!blocks.length) {
    return <div className="py-12 text-center text-[13px] text-muted">{empty}</div>
  }
  return <div className="font-sans text-[13px] leading-relaxed text-ink"><BlockList blocks={blocks} /></div>
}
