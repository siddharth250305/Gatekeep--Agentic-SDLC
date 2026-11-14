import { useState } from 'react'
import { Plus, Sun, Moon } from 'lucide-react'
import NavTabs from './NavTabs'
import { MoreMenu, RunSwitcher, UserMenu } from './HeaderMenus'

// The app header: logo and run switcher, the page tabs, and the signed-in
// reviewer with the new-run, theme and more-actions controls. Gate decisions
// live in the gate banner below it (F4), not here.
export default function AppHeader({
  runs, run, user, runTab, onTabChange, onSelectRun, onSignOut, onNewRun,
  isDarkMode, onToggleTheme, onCopyRunId, onCopyCheckout, onDownloadPatch, onExportAudit,
}) {
  const [runMenu, setRunMenu] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const [moreMenu, setMoreMenu] = useState(false)

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0b0b0d] px-3 sm:px-4 z-30 shadow-2xs gap-2 sm:gap-4">
      {/* Left: logo + run switcher */}
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0">
        <button
          type="button"
          onClick={() => onTabChange('overview')}
          aria-label="GateKeep overview"
          className="flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black text-white dark:bg-white dark:text-black font-bold text-[13px] tracking-tight shadow-xs">
            G
          </span>
          <span className="text-[14px] font-bold tracking-tight text-ink dark:text-[#f5f5f7] hidden sm:inline">GateKeep</span>
          <span className="rounded bg-black/[0.05] dark:bg-white/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-faint dark:text-[#a1a1aa] hidden lg:inline">
            PROD
          </span>
        </button>
        <div className="h-4 w-px bg-black/[0.1] dark:bg-white/[0.12] mx-0.5 shrink-0 hidden md:block" />
        <RunSwitcher runs={runs} run={run} open={runMenu} setOpen={setRunMenu} onSelect={onSelectRun} />
      </div>

      {/* Center: page tabs. Phones use the sub-bar below the header. */}
      <div className="hidden md:flex items-center justify-center shrink-0">
        <NavTabs active={runTab} onChange={onTabChange} />
      </div>

      {/* Right: reviewer, new run, theme, more */}
      <div className="flex items-center justify-end gap-1.5 sm:gap-2 min-w-0 shrink-0">
        <UserMenu user={user} open={userMenu} setOpen={setUserMenu} onSignOut={() => { setUserMenu(false); onSignOut() }} />

        <button
          type="button"
          onClick={onNewRun}
          className="hidden sm:inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] px-2 lg:px-2.5 text-[12px] font-medium text-ink dark:text-[#f5f5f7] transition-all active:scale-[0.98] shrink-0 cursor-pointer"
          title="Launch new agent workflow run"
          aria-label="New run"
        >
          <Plus size={13} className="text-faint dark:text-[#a1a1aa]" />
          <span className="hidden lg:inline">New Run</span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-muted dark:text-[#a1a1aa] hover:text-ink dark:hover:text-white transition-colors cursor-pointer shrink-0"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle Dark / Light Theme"
        >
          <span className={`flex items-center justify-center transition-transform duration-200 ease-out ${isDarkMode ? 'rotate-[360deg]' : 'rotate-0'}`} aria-hidden="true">
            {isDarkMode ? <Sun size={14} className="text-[#ff9500]" /> : <Moon size={14} className="text-muted" />}
          </span>
        </button>

        <MoreMenu
          run={run}
          open={moreMenu}
          setOpen={setMoreMenu}
          onNewRun={onNewRun}
          onCopyRunId={onCopyRunId}
          onCopyCheckout={onCopyCheckout}
          onDownloadPatch={onDownloadPatch}
          onExportAudit={onExportAudit}
        />
      </div>
    </header>
  )
}
