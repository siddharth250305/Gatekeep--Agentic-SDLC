import { Check, Clock } from 'lucide-react'

// Gate badge from the run's real step state, never a hardcoded claim.
export function GateBadge({ run, stepKey, role }) {
  const step = run?.steps?.find((s) => s.key === stepKey)
  const state = step?.state
  if (state === 'approved') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#34c759]/25 dark:border-[#34c759]/35 bg-[#34c759]/10 dark:bg-[#34c759]/20 px-3 py-1 font-mono text-[11px] font-semibold text-[#17692e] dark:text-[#34c759]" title={step.at || ''}>
        <Check size={11} strokeWidth={3} /> Approved by {role}
      </span>
    )
  }
  if (state === 'rejected') {
    return <span className="shrink-0 rounded-full border border-[#ff3b30]/25 dark:border-[#ff3b30]/35 bg-[#ff3b30]/10 dark:bg-[#ff3b30]/20 px-3 py-1 font-mono text-[11px] font-semibold text-[#c4161c] dark:text-[#ff453a]">Rejected by {role}</span>
  }
  if (state === 'active' || (run?.awaiting && run?.gate === role)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#ff9500]/25 dark:border-[#ff9500]/35 bg-[#ff9500]/10 dark:bg-[#ff9500]/20 px-3 py-1 font-mono text-[11px] font-semibold text-[#8f4700] dark:text-[#ff9f0a]">
        <Clock size={11} /> Awaiting {role}
      </span>
    )
  }
  return <span className="shrink-0 rounded-full bg-black/[0.04] dark:bg-white/[0.08] px-3 py-1 font-mono text-[11px] font-semibold text-muted dark:text-[#a1a1aa]">Not reviewed yet</span>
}

export function StatChip({ icon: Icon, value, label, tone }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-[#1a1a1d] px-3 py-2.5">
      <Icon size={16} className={`shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="font-mono text-[15px] font-semibold leading-none text-ink dark:text-white">{value}</div>
        <div className="mt-1 text-[11px] leading-tight text-muted dark:text-[#a1a1aa]">{label}</div>
      </div>
    </div>
  )
}
