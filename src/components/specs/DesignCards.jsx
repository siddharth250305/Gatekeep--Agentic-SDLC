import { ShieldAlert, FilePlus2, FilePen } from 'lucide-react'
import { RenderInline } from './MarkdownBlocks'
import { asList, itemText } from '../../lib/markdown'

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

export function HighlightedJson({ text }) {
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

export const CREATE_TONE = { icon: 'text-[#17692e] dark:text-[#34c759]', badge: 'bg-[#34c759]/15 dark:bg-[#34c759]/25 text-[#17692e] dark:text-[#34c759]', text: 'text-[#17692e] dark:text-[#34c759]' }
export const MODIFY_TONE = { icon: 'text-accent dark:text-[#4da3ff]', badge: 'bg-accent/15 dark:bg-accent/25 text-accent dark:text-[#4da3ff]', text: 'text-accent dark:text-[#4da3ff]' }

export function FileTreeCard({ title, icon: Icon, tone, files, marker }) {
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
              <span className="shrink-0 select-none text-faint" aria-hidden="true">{i === files.length - 1 ? '└─' : '├─'}&nbsp;</span>
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

// compact: one column, for the narrow Gate 3 side panel.
export function DesignCards({ design, filesToCreate, filesToModify, filesSource, compact = false }) {
  const threats = asList(design.threat_model ?? design.threats)
  const otherSections = Object.entries(design).filter(([k, v]) => !PLAN_KEYS.has(k) && asList(v).length)
  const grid = compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <div>
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#8e8e93]">
          {filesSource === 'run' ? 'Files changed in this run' : 'Target file plan'} ({filesToCreate.length + filesToModify.length})
        </h3>
        <div className={`mt-2.5 grid gap-3 ${grid}`}>
          <FileTreeCard title="Files to create" icon={FilePlus2} marker="+" files={filesToCreate} tone={CREATE_TONE} />
          <FileTreeCard title="Files to modify" icon={FilePen} marker="~" files={filesToModify} tone={MODIFY_TONE} />
        </div>
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#8e8e93]">
          <ShieldAlert size={14} className="text-amber" /> Threat model
        </h3>
        {threats.length ? (
          <div className={`mt-2.5 grid gap-2.5 ${grid}`}>
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
