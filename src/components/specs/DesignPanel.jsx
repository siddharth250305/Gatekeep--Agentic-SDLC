import { useMemo, useState } from 'react'
import { Copy, Check, LayoutGrid, Braces, FilePlus2, FilePen } from 'lucide-react'
import { RequirementsRenderer } from './MarkdownBlocks'
import { CREATE_TONE, DesignCards, FileTreeCard, HighlightedJson, MODIFY_TONE } from './DesignCards'
import { GateBadge } from './GateBadge'
import { parseMarkdownBlocks } from '../../lib/markdown'

// Phase 2 of the Specs & Design page: the technical design, as cards or raw.
export default function DesignPanel({ run, design, filesToCreate, filesToModify, filesSource }) {
  const [designViewMode, setDesignViewMode] = useState('cards') // 'cards' | 'raw'
  const [copiedSpec, setCopiedSpec] = useState(false)
  const designIsObject = Boolean(design) && typeof design === 'object' && !Array.isArray(design)
  const designString = designIsObject || Array.isArray(design) ? JSON.stringify(design, null, 2) : (design || '')
  const designBlocks = useMemo(() => (designIsObject ? [] : parseMarkdownBlocks(designString)), [designIsObject, designString])

  const handleCopySpec = () => {
    navigator.clipboard.writeText(designString)
    setCopiedSpec(true)
    setTimeout(() => setCopiedSpec(false), 2000)
  }

  return (
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
                      <FileTreeCard title="Created" icon={FilePlus2} marker="+" files={filesToCreate} tone={CREATE_TONE} />
                      <FileTreeCard title="Modified" icon={FilePen} marker="~" files={filesToModify} tone={MODIFY_TONE} />
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
  )
}
