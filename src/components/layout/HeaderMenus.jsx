import { useEffect } from 'react'
import { ChevronDown, GitBranch, Ellipsis, Plus, FileText, Download, Copy } from 'lucide-react'

const MENU = 'absolute top-full z-50 mt-1.5 rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white/95 dark:bg-[#18181b]/95 p-1.5 shadow-pop backdrop-blur-xl animate-rise'
const ITEM = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer'

// A popup panel opened by a disclosure button (aria-expanded): closes on a
// click outside or on Esc (F7).
function Popup({ open, onClose, className, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div className={className}>{children}</div>
    </>
  )
}

const dotClass = (run) => (run?.awaiting ? 'bg-[#ff9500] animate-pulse' : run?.status === 'approved' ? 'bg-[#34c759]' : run ? 'bg-[#0071e3]' : 'bg-muted')

export function RunSwitcher({ runs, run, open, setOpen, onSelect }) {
  return (
    <div className="relative min-w-0 shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 sm:gap-2 rounded-xl bg-black/[0.03] hover:bg-black/[0.06] border border-black/[0.06] dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:border-white/[0.12] px-2 sm:px-2.5 text-[12px] font-semibold text-ink dark:text-[#f5f5f7] transition-colors shadow-2xs cursor-pointer"
      >
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass(run)}`} />
        <span className="font-mono text-ink dark:text-[#f5f5f7] text-[11.5px] sm:text-[12px] max-w-[90px] sm:max-w-[150px] truncate">{run?.id || 'No Runs'}</span>
        <ChevronDown size={11} className="text-faint dark:text-[#a1a1aa] ml-0.5 shrink-0" />
      </button>
      <Popup open={open} onClose={() => setOpen(false)} className={`${MENU} left-0 w-80 overflow-hidden`}>
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#a1a1aa]">
          Select Workflow Run
        </div>
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => { onSelect(r.id); setOpen(false) }}
            className={`flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors cursor-pointer ${
              r.id === run?.id ? 'bg-accent/10 dark:bg-accent/20' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-ink dark:text-white">{r.id}</span>
              <span className={`font-mono text-[10.5px] font-semibold ${
                r.awaiting ? 'text-[#ff9500] dark:text-[#ff9f0a]' : r.status === 'approved' ? 'text-[#34c759]' : 'text-faint dark:text-[#8e8e93]'
              }`}>
                {r.awaiting ? `Awaiting ${r.gate || 'gate'}` : r.status}
              </span>
            </div>
            <span className="truncate text-[11.5px] text-muted dark:text-[#a1a1aa] mt-0.5">{r.brief}</span>
          </button>
        ))}
      </Popup>
    </div>
  )
}

export function UserMenu({ user, open, setOpen, onSignOut }) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] px-2 sm:px-2.5 text-[12px] font-medium text-ink dark:text-[#f5f5f7] transition-colors cursor-pointer"
        title={`Signed in as ${user.name} (${user.role})`}
      >
        <span className="hidden lg:inline max-w-[120px] truncate">{user.name}</span>
        <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{user.role}</span>
        <ChevronDown size={11} className="text-faint dark:text-[#a1a1aa] hidden sm:block" />
      </button>
      <Popup open={open} onClose={() => setOpen(false)} className={`${MENU} right-0 w-56`}>
        <div className="px-2.5 py-1.5 text-[12px] text-ink dark:text-[#f5f5f7]">
          <div className="font-semibold truncate">{user.name}</div>
          <div className="text-[11px] text-faint dark:text-[#a1a1aa]">@{user.username} · {user.role}</div>
        </div>
        <button type="button" onClick={onSignOut} className={`${ITEM} text-[12px]`}>
          Sign out
        </button>
      </Popup>
    </div>
  )
}

export function MoreMenu({ run, open, setOpen, onNewRun, onCopyRunId, onCopyCheckout, onDownloadPatch, onExportAudit }) {
  const item = (onClick, Icon, label, extra = '') => (
    <button type="button" onClick={() => { onClick(); setOpen(false) }} className={`${ITEM} ${extra}`}>
      <Icon size={13} className="text-faint dark:text-[#a1a1aa]" />
      <span>{label}</span>
    </button>
  )
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-muted dark:text-[#a1a1aa] hover:text-ink dark:hover:text-white transition-colors cursor-pointer"
        title="More actions"
        aria-label="More actions"
      >
        <Ellipsis size={14} />
      </button>
      <Popup open={open} onClose={() => setOpen(false)} className={`${MENU} right-0 w-52 text-[12px]`}>
        {item(onNewRun, Plus, 'New Run', 'sm:hidden')}
        {item(onCopyRunId, Copy, `Copy Run ID (${run?.id})`)}
        {item(onCopyCheckout, GitBranch, 'Copy Git Checkout')}
        {item(onDownloadPatch, Download, 'Download .patch')}
        {item(onExportAudit, FileText, 'Export Audit JSON')}
      </Popup>
    </div>
  )
}
