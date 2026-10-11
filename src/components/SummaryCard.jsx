import { CircleCheck, ClipboardList } from 'lucide-react'

export default function SummaryCard({ summary }) {
  if (!summary) {
    return (
      <div className="card p-6">
        <h3 className="text-[15px] font-semibold text-ink">Summary</h3>
        <p className="mt-3 text-[13px] text-muted">No summary for this run yet.</p>
      </div>
    )
  }
  return (
    <div className="card p-6">
      <h3 className="text-[15px] font-semibold text-ink">Summary</h3>
      <div className="mt-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-bg">
          <ClipboardList size={18} className="text-accent" />
        </span>
        <div>
          <div className="text-[14px] font-medium text-ink">{summary.headline}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{summary.sub}</p>
        </div>
      </div>
      <ul className="mt-5 flex flex-col gap-2.5">
        {summary.checks.map((c) => (
          <li key={c} className="flex items-center gap-2.5 text-[13px] text-ink">
            <CircleCheck size={17} className="shrink-0 text-green" />{c}
          </li>
        ))}
      </ul>
    </div>
  )
}
