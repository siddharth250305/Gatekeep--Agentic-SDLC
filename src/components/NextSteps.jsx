import { ArrowRight, Check } from 'lucide-react'

export default function NextSteps({ canAct, onApprove, onReject }) {
  return (
    <div className="card flex flex-col p-6">
      <h3 className="text-[15px] font-semibold text-ink">Next steps</h3>
      <div className="mt-4 flex flex-col gap-2.5">
        <button
          disabled={!canAct}
          onClick={onApprove}
          className="flex items-center justify-between rounded-md bg-accent px-4 py-3 text-[13px] font-semibold text-white shadow-btn transition-colors duration-150 enabled:hover:bg-accent-hover disabled:opacity-40"
        >
          <span className="flex items-center gap-2"><Check size={15} /> Approve and continue</span>
          <ArrowRight size={16} />
        </button>
        <button
          disabled={!canAct}
          onClick={onReject}
          className="flex items-center justify-between rounded-md border border-line px-4 py-3 text-[13px] font-medium text-ink transition-colors duration-150 enabled:hover:bg-sunken disabled:opacity-40"
        >
          Request changes
          <ArrowRight size={16} className="text-muted" />
        </button>
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-faint">This creates an output branch with the approved changes.</p>
    </div>
  )
}
