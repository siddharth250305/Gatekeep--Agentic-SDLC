import { TriangleAlert } from 'lucide-react'

// Gate 3, right column (F5 part 2, I2): the files the approved design
// planned next to the files the run actually changed. A file changed outside
// the plan gets a red warning; a planned file left alone is listed.
const ROW = {
  planned: { label: 'Changed as planned', tone: 'text-[#17692e] dark:text-[#34c759]', bg: '' },
  untouched: { label: 'Planned, not changed', tone: 'text-[#b25000] dark:text-[#ff9f0a]', bg: '' },
  pattern: { label: 'Planned pattern', tone: 'text-muted dark:text-[#a1a1aa]', bg: '' },
  undeclared: { label: 'Not in the approved design', tone: 'text-[#d70015] dark:text-[#ff453a] font-semibold', bg: 'bg-[#ff3b30]/[0.08]' },
}

const isPattern = (p) => /[*?]/.test(p)

export default function DriftTable({ trace, onOpenFile }) {
  const drift = trace?.drift
  if (!drift) return null
  const rows = [
    ...drift.undeclared.map((path) => ({ path, kind: 'undeclared', reqs: [], open: true })),
    ...drift.planned.map((p) => ({
      path: p.path,
      kind: p.changed.length ? 'planned' : isPattern(p.path) ? 'pattern' : 'untouched',
      reqs: p.reqs,
      open: p.changed.length > 0 && !isPattern(p.path),
    })),
  ]
  if (!rows.length) return null
  const n = drift.undeclared.length

  return (
    <div className="border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
      {n > 0 && (
        <div role="alert" aria-label="Design drift" className="mb-2 flex items-start gap-2 rounded-xl border border-[#ff3b30]/40 bg-[#ff3b30]/[0.08] px-2.5 py-2 text-[12px] font-semibold text-[#d70015] dark:text-[#ff453a]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {n} {n === 1 ? 'file' : 'files'} changed outside the approved design
            {!trace.plan && <span className="block font-normal">The design has no file plan, so no change was declared.</span>}
          </span>
        </div>
      )}
      <table aria-label="Planned vs changed files" className="w-full table-fixed text-left text-[11.5px]">
        <caption className="mb-1 text-left text-[12px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">Planned vs changed</caption>
        <thead className="sr-only">
          <tr><th scope="col">File</th><th scope="col">Result</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = ROW[r.kind]
            return (
              <tr key={`${i}:${r.kind}:${r.path}`} data-drift={r.kind} className={`border-t border-black/[0.04] dark:border-white/[0.06] ${s.bg}`}>
                <td className="w-[58%] py-1 pr-2 align-top font-mono">
                  {r.open ? (
                    <button type="button" onClick={() => onOpenFile?.(r.path)} className="block w-full truncate text-left text-ink hover:text-accent dark:text-[#f5f5f7]" title={r.path}>
                      {r.path}
                    </button>
                  ) : (
                    <span className="block truncate text-muted dark:text-[#a1a1aa]" title={r.path}>{r.path}</span>
                  )}
                  {r.reqs.length > 0 && <span className="block font-sans text-[10px] text-faint dark:text-[#8e8e93]">{r.reqs.join(', ')}</span>}
                </td>
                <td className={`py-1 align-top ${s.tone}`}>{s.label}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
