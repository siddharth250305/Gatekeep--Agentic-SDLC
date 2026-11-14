import { useMemo } from 'react'
import { Cpu, File, Files } from 'lucide-react'
import { DesignCards } from '../specs/DesignCards'
import { RequirementsRenderer } from '../specs/MarkdownBlocks'
import { GateBadge } from '../specs/GateBadge'
import { parseMarkdownBlocks, plannedFiles } from '../../lib/markdown'

// Gate 3, right column (F5 part 1): the design approved at Gate 2 next to the
// files this run actually changed. Picking a changed file opens its diff.
// (Planned-vs-changed warnings come in Milestone 6, F5 part 2.)
export default function DesignColumn({ run, changedFiles, selectedPath, onOpenFile }) {
  const design = run?.design ?? null
  const designIsObject = Boolean(design) && typeof design === 'object' && !Array.isArray(design)
  const plan = useMemo(() => plannedFiles(design, run?.files), [design, run?.files])
  const textBlocks = useMemo(
    () => (design && !designIsObject ? parseMarkdownBlocks(Array.isArray(design) ? JSON.stringify(design, null, 2) : String(design)) : []),
    [design, designIsObject],
  )

  return (
    <section
      aria-label="Approved design"
      className="hidden lg:flex w-[300px] xl:w-[340px] shrink-0 flex-col overflow-y-auto border-l border-black/[0.08] bg-[#fbfbfd]/80 surface-ide-panel dark:border-white/[0.08] dark:bg-[#0b0b0d]/90"
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-2.5 dark:border-white/[0.08]">
        <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
          <Cpu size={13} className="text-accent" /> Design
        </h2>
        <GateBadge run={run} stepKey="g2" role="Engineer" />
      </div>

      <div className="px-4 py-3">
        {!design ? (
          <p className="py-4 text-center text-[12px] text-muted dark:text-[#a1a1aa]">No design recorded for this run.</p>
        ) : designIsObject ? (
          <DesignCards design={design} compact {...plan} />
        ) : (
          <RequirementsRenderer blocks={textBlocks} />
        )}
      </div>

      <div className="border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
        <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
          <Files size={13} className="text-accent" /> Changed files ({changedFiles.length})
        </h2>
        {changedFiles.length ? (
          <ul aria-label="Changed files" className="mt-2 space-y-0.5 font-mono text-[11.5px]">
            {changedFiles.map((f) => {
              const selected = f.path === selectedPath
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(f.path)}
                    aria-current={selected ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left transition-colors ${
                      selected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <File size={12} className="shrink-0" />
                      <span className="truncate" title={f.path}>{f.path}</span>
                      {f.status === 'A' && <span className="font-sans text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">NEW</span>}
                    </span>
                    <span className="shrink-0 text-[9.5px] font-semibold text-[#17692e] dark:text-[#34c759]">
                      +{f.add || 0}{f.rem ? ` -${f.rem}` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[12px] text-muted dark:text-[#a1a1aa]">No code changes yet. Files show up here once the agent writes code in the Code phase.</p>
        )}
      </div>
    </section>
  )
}
