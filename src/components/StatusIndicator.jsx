// Apple HIG Status Indicator: vibrant system colors, optical halo, pill chips
const STATUS = {
  approved:  { label: 'Approved',  color: 'green', live: false },
  rejected:  { label: 'Rejected',  color: 'red',   live: false },
  active:    { label: 'In review', color: 'amber', live: true },
  awaiting:  { label: 'Awaiting',  color: 'amber', live: true },
  running:   { label: 'Running',   color: 'blue',  live: true },
  pending:   { label: 'Pending',   color: 'faint', live: false },
  verified:  { label: 'Verified',  color: 'green', live: false },
  completed: { label: 'Completed', color: 'green', live: false },
  idle:      { label: 'Idle',      color: 'faint', live: false },
}

const TEXT  = {
  green: 'text-[#1f7a37]',
  red: 'text-[#d70015]',
  amber: 'text-[#b25000]',
  blue: 'text-[#0071e3]',
  faint: 'text-[#86868b]',
}

const DOT = {
  green: 'bg-[#34c759]',
  red: 'bg-[#ff3b30]',
  amber: 'bg-[#ff9500]',
  blue: 'bg-[#0071e3]',
  faint: 'bg-[#a1a1a6]',
}

const CHIP = {
  green: 'bg-[#34c759]/12 text-[#1f7a37] border-green/20',
  red: 'bg-[#ff3b30]/12 text-[#d70015] border-red/20',
  amber: 'bg-[#ff9500]/12 text-[#b25000] border-amber/20',
  blue: 'bg-[#0071e3]/12 text-[#0071e3] border-blue/20',
  faint: 'bg-black/[0.04] text-[#86868b] border-black/[0.04]',
}

function Dot({ color, live, pending }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
      {live && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${DOT[color]}`} />
      )}
      <span
        className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
          pending ? `bg-transparent ring-1 ring-inset ring-current` : DOT[color]
        }`}
      />
    </span>
  )
}

export default function StatusIndicator({ status, label, chip = false, icon: Icon, className = '' }) {
  const cfg = STATUS[status] ?? STATUS.pending
  const text = label ?? cfg.label
  const isPending = status === 'pending' || status === 'idle'
  const labelCls = `font-mono text-[10px] font-semibold uppercase tracking-[0.06em] ${TEXT[cfg.color]}`

  if (chip) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] ${CHIP[cfg.color]} ${className}`}
      >
        <Dot color={cfg.color} live={cfg.live} pending={isPending} />
        {Icon && <Icon size={12} className={TEXT[cfg.color]} />}
        <span className={labelCls}>{text}</span>
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Dot color={cfg.color} live={cfg.live} pending={isPending} />
      <span className={labelCls}>{text}</span>
    </span>
  )
}
