import { Check, RotateCcw, ArrowRight } from 'lucide-react'
import { gateView } from '../lib/gate'

const DOT = {
  gate: 'bg-[#ff9500] animate-pulse',
  agent: 'bg-[#0071e3]',
  not_started: 'bg-muted',
  done: 'bg-[#34c759]',
  cancelled: 'bg-[#ff3b30]',
  unknown: 'bg-muted',
}

// One banner on every page (F4): which gate the run is at, who must act, who
// you are, and the two decisions. When this user may not approve, the button
// is disabled and the banner says why, before anyone clicks. busy: a decision
// is being sent, so both buttons wait for it.
export default function GateBanner({ run, user, busy = false, onApprove, onRequestChanges, onOpenReview }) {
  if (!run) return null
  const view = gateView(run, user)
  const isGate = view.kind === 'gate'
  const block = isGate ? view.approveBlock : null
  const blockNote = !block ? null
    : !view.canReject ? `${block}. Approve and Request changes are disabled.`
      : `${block}. Approve is disabled.`

  return (
    <section
      aria-label="Gate status"
      className={`shrink-0 border-b px-3 sm:px-4 py-2 ${
        isGate ? 'border-[#ff9500]/25 bg-[#ff9500]/[0.06] dark:bg-[#ff9500]/[0.1]' : 'border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-[#0b0b0d]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink dark:text-[#f5f5f7]">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[view.kind]}`} aria-hidden="true" />
          <strong className="font-semibold">{view.title}</strong>
          <span className="text-muted dark:text-[#a1a1aa]">
            Waiting for: <span className="font-semibold text-ink dark:text-[#f5f5f7]">{view.waitingFor}</span>
          </span>
          <span className="text-muted dark:text-[#a1a1aa]">
            You are: <span className="font-semibold text-ink dark:text-[#f5f5f7]">{user?.role || 'not signed in'}</span>
            {user?.name && <span className="hidden sm:inline"> ({user.name})</span>}
          </span>
        </div>

        {isGate && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenReview?.(view.gate.review)}
              className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[12px] font-medium text-accent hover:bg-accent/10 dark:text-[#4da3ff] transition-colors cursor-pointer"
            >
              <span>{view.gate.review.label}</span>
              <ArrowRight size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!view.canReject || busy}
              title={view.rejectBlock || 'Send the work back with feedback'}
              onClick={onRequestChanges}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-white/[0.06] px-3 text-[12.5px] font-semibold text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.1] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Request changes</span>
            </button>
            <button
              type="button"
              disabled={!view.canApprove || busy}
              title={view.approveBlock || `Approve ${view.title}`}
              onClick={onApprove}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] px-3.5 text-[12.5px] font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
              <span>{view.approveLabel}</span>
            </button>
          </div>
        )}
      </div>
      {blockNote && (
        <p role="note" className="mt-1.5 text-[12px] font-medium text-[#d70015] dark:text-[#ff453a]">{blockNote}</p>
      )}
    </section>
  )
}
