import { Check, Play } from 'lucide-react'

// The Overview's status card: where the run stands, and Start Pipeline for a
// run that was never started. Approve and Request changes are in the gate
// banner at the top of every page (F4), so they are not repeated here.
export default function RunStatusCard({ run, onStartPipeline }) {
  return (
    <div className="card p-6 shadow-card bg-gradient-to-r from-white via-white to-accent/[0.02] dark:from-[#141416] dark:via-[#141416] dark:to-accent/[0.06]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                run?.awaiting ? 'bg-accent animate-ping' : run?.status === 'approved' ? 'bg-[#34c759]' : 'bg-muted'
              }`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                run?.awaiting ? 'bg-accent' : run?.status === 'approved' ? 'bg-[#34c759]' : 'bg-muted'
              }`} />
            </span>
            <h3 className="text-[16px] font-semibold text-ink dark:text-white">
              {run?.awaiting
                ? 'Gate Decision Required'
                : run?.status === 'approved'
                ? 'Pipeline Completed & Approved'
                : run?.status === 'cancelled'
                ? 'Run Cancelled'
                : (run?.step && run.step !== 'req') || run?.started
                ? 'Agent Working'
                : 'Workflow Ready to Run'}
            </h3>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              run?.awaiting
                ? 'bg-accent/15 dark:bg-accent/25 text-accent dark:text-[#409cff]'
                : run?.status === 'approved'
                ? 'bg-[#34c759]/15 dark:bg-[#34c759]/25 text-[#17692e] dark:text-[#34c759]'
                : run?.status === 'cancelled'
                ? 'bg-[#ff3b30]/15 dark:bg-[#ff3b30]/25 text-[#d70015] dark:text-[#ff453a]'
                : 'bg-black/[0.04] dark:bg-white/[0.08] text-muted dark:text-[#a1a1aa]'
            }`}>
              {run?.awaiting ? `Awaiting ${run?.gate || 'Review'}` : run?.status || 'idle'}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted dark:text-[#a1a1aa]">
            {run?.awaiting
              ? `Role "${run?.gate || 'Reviewer'}" must approve or request rework to advance the pipeline.`
              : run?.status === 'approved'
              ? 'All phases approved and verified against cryptographic audit ledger.'
              : run?.status === 'cancelled'
              ? 'This run was cancelled. A cancelled run cannot be reopened.'
              : (run?.step && run.step !== 'req') || run?.started
              ? 'The agent is working on this step. The next gate opens when it hands its work over.'
              : 'Click Start Pipeline to begin agent reasoning, testing, and approval gates.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {run?.awaiting ? (
            // The decision itself is made in the gate banner at the top of every page (F4).
            <span className="text-[12.5px] font-medium text-muted dark:text-[#a1a1aa]">Approve or request changes in the gate banner above.</span>
          ) : run?.status === 'approved' ? (
            <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#17692e] dark:text-[#34c759]">
              <Check size={16} strokeWidth={2.5} />
              <span>Production Ready</span>
            </div>
          ) : run?.step !== 'req' || run?.started ? null : (
            <button
              type="button"
              onClick={() => onStartPipeline && onStartPipeline(run?.id)}
              className="rounded-xl bg-[#0071e3] hover:bg-[#0077ed] px-5 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all active:scale-[0.98] flex items-center gap-1.5 cursor-pointer"
            >
              <Play size={13} fill="currentColor" />
              <span>Start Pipeline ▶</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
