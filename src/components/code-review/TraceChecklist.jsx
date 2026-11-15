import { CircleCheck, CircleDashed, CircleX, ListChecks } from 'lucide-react'

// Gate 3, left column (F5 part 2, I3): every approved requirement with the
// tests that cover it and the files planned for it. The server links them
// (run.trace); uncovered and failing requirements stand out.
const STATUS = {
  covered: { label: 'Covered', tone: 'text-[#17692e] dark:text-[#34c759]', row: '' },
  failing: { label: 'Failing', tone: 'text-[#d70015] dark:text-[#ff453a]', row: 'border-[#ff3b30]/40 bg-[#ff3b30]/[0.06]' },
  uncovered: { label: 'Not covered by any test', tone: 'text-[#d70015] dark:text-[#ff453a]', row: 'border-[#ff3b30]/40 bg-[#ff3b30]/[0.06]' },
}

function CaseIcon({ outcome }) {
  if (outcome === 'passed') return <CircleCheck size={12} className="mt-0.5 shrink-0 text-[#34c759]" aria-label="passed" />
  if (outcome === 'skipped') return <CircleDashed size={12} className="mt-0.5 shrink-0 text-faint" aria-label="skipped" />
  return <CircleX size={12} className="mt-0.5 shrink-0 text-[#ff3b30]" aria-label={outcome} />
}

export default function TraceChecklist({ trace }) {
  const reqs = trace?.requirements || []
  if (!reqs.length) return null
  const covered = reqs.filter((r) => r.status === 'covered').length
  return (
    <div className="border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
        <ListChecks size={13} className="text-accent" aria-hidden="true" /> Requirement coverage
      </h3>
      <p className={`mt-1 text-[12px] font-semibold ${covered === reqs.length ? 'text-[#17692e] dark:text-[#34c759]' : 'text-[#d70015] dark:text-[#ff453a]'}`}>
        {covered} of {reqs.length} requirements covered
      </p>
      <ul aria-label="Requirement coverage" className="mt-2 space-y-2">
        {reqs.map((r) => {
          const s = STATUS[r.status] || STATUS.uncovered
          return (
            <li key={r.id} data-status={r.status} className={`rounded-xl border px-2.5 py-2 text-[12px] ${s.row || 'border-black/[0.06] dark:border-white/[0.08]'}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-mono text-[11px] font-semibold text-accent dark:text-[#4da3ff]">{r.id}</span>{' '}
                  <span className="text-ink dark:text-[#f5f5f7]">{r.text}</span>
                </span>
                <span className={`shrink-0 text-[11px] font-semibold ${s.tone}`}>{s.label}</span>
              </div>
              {r.tests.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {r.tests.map((t) => (
                    <li key={`${t.file}::${t.name}`} className="flex items-start gap-1.5 font-mono text-[10.5px] text-muted dark:text-[#a1a1aa]">
                      <CaseIcon outcome={t.outcome} />
                      <span className="truncate" title={`${t.file}::${t.name}`}>{t.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 truncate font-mono text-[10.5px] text-faint dark:text-[#8e8e93]" title={r.planned.join(', ')}>
                {r.planned.length ? `Planned: ${r.planned.join(', ')}` : 'No file in the design is linked to this requirement'}
              </p>
            </li>
          )
        })}
      </ul>
      {trace.unknownRefs?.length > 0 && (
        <p className="mt-2 text-[11px] font-medium text-[#b25000] dark:text-[#ff9f0a]">
          Unknown requirement IDs: {trace.unknownRefs.map((u) => `${u.id} (in ${u.in})`).join(', ')}
        </p>
      )}
    </div>
  )
}
