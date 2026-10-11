import { ArrowRight, CircleCheck } from 'lucide-react'
import StatusIndicator from '../StatusIndicator'

export default function ApprovalsView({ runs, onOpenRun }) {
  const pending = runs.filter((r) => r.awaiting)
  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-[24px] font-semibold tracking-tight text-ink">Approvals</h1>
      <p className="mt-1 text-[13px] text-muted">Runs waiting on your sign-off as Engineer.</p>
      {pending.length === 0 ? (
        <div className="card mt-6 px-6 py-16 text-center">
          <CircleCheck size={28} className="mx-auto text-green" />
          <p className="mt-3 text-[14px] font-medium text-ink">You are all caught up</p>
          <p className="mt-1 text-[13px] text-muted">No runs are awaiting your approval.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {pending.map((r) => {
            const gate = r.steps.find((s) => s.state === 'active')
            return (
              <li key={r.id} className="card flex items-center gap-4 p-5 transition-shadow hover:shadow-pop">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[12px] text-faint">{r.id}</span>
                    <StatusIndicator status="awaiting" label={gate ? gate.label : 'Awaiting'} chip />
                  </div>
                  <div className="mt-1 truncate text-[15px] font-medium text-ink">{r.brief}</div>
                  <div className="mt-0.5 font-mono text-[12px] text-faint">{r.repo} · {r.branch}</div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="font-mono text-[14px] font-semibold tabnum text-ink">{r.totals.cost}</div>
                  <div className="text-[11px] text-faint">{r.totals.tokens} tokens</div>
                </div>
                <button onClick={() => onOpenRun(r.id)} className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-btn transition-colors hover:bg-accent-hover">
                  Review <ArrowRight size={15} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
