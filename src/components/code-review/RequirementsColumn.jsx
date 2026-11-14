import { useMemo } from 'react'
import { CircleCheck, CircleX, CircleDashed, FileText } from 'lucide-react'
import { RequirementsRenderer } from '../specs/MarkdownBlocks'
import { GateBadge } from '../specs/GateBadge'
import { parseMarkdownBlocks, requirementsText } from '../../lib/markdown'
import { testOutcome } from '../views/TestResultsView'

const OUTCOME_TONE = {
  pass: 'text-[#17692e] dark:text-[#34c759]',
  fail: 'text-[#d70015] dark:text-[#ff453a]',
  none: 'text-muted dark:text-[#a1a1aa]',
}

// Gate 3, left column (F5 part 1): what was approved at Gate 1, and what the
// tests showed. The reviewer checks the code in the middle against both.
export default function RequirementsColumn({ run }) {
  const text = requirementsText(run)
  const blocks = useMemo(() => parseMarkdownBlocks(text || ''), [text])
  const tests = run?.tests
  const outcome = testOutcome(tests)
  const cases = tests?.cases || []

  return (
    <section
      aria-label="Approved requirements"
      className="hidden lg:flex w-[300px] xl:w-[340px] shrink-0 flex-col overflow-y-auto border-r border-black/[0.08] bg-[#fbfbfd]/70 surface-ide-panel dark:border-white/[0.08] dark:bg-[#0b0b0d]/90"
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-2.5 dark:border-white/[0.08]">
        <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
          <FileText size={13} className="text-accent" /> Requirements
        </h2>
        <GateBadge run={run} stepKey="g1" role="Planner" />
      </div>

      <div className="px-4 py-3">
        {blocks.length
          ? <RequirementsRenderer blocks={blocks} />
          : <p className="py-4 text-center text-[12px] text-muted dark:text-[#a1a1aa]">No requirements recorded for this run.</p>}
      </div>

      <div className="mt-auto border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">Test results</h2>
        <p className={`mt-1 text-[12.5px] font-semibold ${OUTCOME_TONE[outcome.tone]}`}>
          {outcome.label}
          {tests && <span className="font-normal text-muted dark:text-[#a1a1aa]"> · {tests.passed ?? 0} passed · {tests.failed ?? 0} failed · {tests.total ?? 0} total</span>}
        </p>
        {cases.length > 0 && (
          <ul aria-label="Test results" className="mt-2 space-y-1">
            {cases.map((c, i) => {
              const passed = c.outcome === 'passed'
              const skipped = c.outcome === 'skipped'
              const Icon = passed ? CircleCheck : skipped ? CircleDashed : CircleX
              return (
                <li key={`${c.file}::${c.name}::${i}`} className="flex items-start gap-2 text-[11.5px]">
                  <Icon size={13} className={`mt-0.5 shrink-0 ${passed ? 'text-[#34c759]' : skipped ? 'text-faint' : 'text-[#ff3b30]'}`} aria-label={c.outcome} />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-ink dark:text-[#f5f5f7]" title={c.name}>{c.name}</span>
                    <span className="block truncate font-mono text-[10.5px] text-faint dark:text-[#8e8e93]">
                      {c.file} · {c.new ? 'New' : 'Existing'}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
