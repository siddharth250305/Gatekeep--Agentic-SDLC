import { useMemo } from 'react'
import { ShieldAlert, ShieldCheck, HelpCircle, ListChecks, BookOpen } from 'lucide-react'
import { RequirementsRenderer } from './MarkdownBlocks'
import { GateBadge, StatChip } from './GateBadge'
import { documentStats, parseMarkdownBlocks } from '../../lib/markdown'

// Phase 1 of the Specs & Design page: the requirements document, with counts
// of what a reviewer has to check.
export default function RequirementsPanel({ run, reqText }) {
  const reqBlocks = useMemo(() => parseMarkdownBlocks(reqText || ''), [reqText])
  const reqStats = useMemo(() => documentStats(reqBlocks), [reqBlocks])

  return (
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
  )
}
