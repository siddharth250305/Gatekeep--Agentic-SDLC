import { LayoutDashboard, FileText, Code, ShieldCheck, Terminal } from 'lucide-react'

export const NAV_TABS = [
  { key: 'overview', label: 'Overview', title: 'Overview Dashboard', Icon: LayoutDashboard },
  { key: 'specs', label: 'Specs & Design', title: 'Specs & Design Review', Icon: FileText },
  { key: 'code', label: 'Code Review', title: 'Code Review IDE', Icon: Code },
  { key: 'tests', label: 'Test Results', title: 'Test Results & Sandbox', Icon: ShieldCheck },
  { key: 'audit', label: 'Audit Chain', title: 'Cryptographic Audit Chain', Icon: Terminal },
]

// Segmented tab control. `full` stretches it across the mobile sub-bar with visible labels.
export default function NavTabs({ active, onChange, full = false }) {
  return (
    <div className={`${full ? 'flex w-full' : 'inline-flex'} h-9 items-center rounded-xl bg-black/[0.05] dark:bg-white/[0.06] p-1 border border-black/[0.04] dark:border-white/[0.08] shadow-inner gap-0.5`}>
      {NAV_TABS.map(({ key, label, title, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={title}
          aria-label={title}
          aria-current={active === key ? 'page' : undefined}
          className={`h-7 ${full ? 'flex-1 justify-center px-1' : 'px-2.5 sm:px-3'} flex items-center gap-1.5 rounded-lg text-[12px] transition-all whitespace-nowrap cursor-pointer ${
            active === key
              ? 'bg-white dark:bg-[#252529] font-semibold text-[#1d1d1f] dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
              : 'text-muted dark:text-[#a1a1aa] font-medium hover:text-[#1d1d1f] dark:hover:text-white hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
          }`}
        >
          <Icon size={13} className={`shrink-0 ${active === key ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'}`} />
          <span className={full ? 'hidden min-[420px]:inline truncate text-[11px]' : 'hidden xl:inline'}>{label}</span>
        </button>
      ))}
    </div>
  )
}
