import { ShieldCheck, ShieldAlert, Sun, Moon } from 'lucide-react'

// Status bar pinned under the workspace: platform health on the left, run context on the right.
export default function AppFooter({ apiOnline, runs, run, activeAgents, isDarkMode, onToggleTheme }) {
  const awaiting = runs.filter((r) => r.awaiting).length
  const chainOk = run?.verified !== false
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0b0b0d] px-3 sm:px-4 font-mono text-[10.5px] text-muted dark:text-[#a1a1aa]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1.5 shrink-0" title={apiOnline ? 'GateKeep API reachable' : 'GateKeep API unreachable'}>
          <span className={`h-1.5 w-1.5 rounded-full ${apiOnline ? 'bg-[#34c759]' : 'bg-[#ff3b30]'}`} />
          <span className={apiOnline ? '' : 'text-red'}>{apiOnline ? 'API connected' : 'API offline'}</span>
        </span>
        <span className="hidden sm:inline text-faint dark:text-[#8e8e93]">·</span>
        <span className="hidden sm:inline shrink-0 tabnum">
          {runs.length} {runs.length === 1 ? 'run' : 'runs'}
          {awaiting > 0 && <span className="text-[#8f4700] dark:text-[#ff9f0a]"> · {awaiting} awaiting</span>}
        </span>
        <span className="hidden md:inline text-faint dark:text-[#8e8e93]">·</span>
        <span className="hidden md:inline shrink-0 tabnum">{activeAgents} active {activeAgents === 1 ? 'agent' : 'agents'}</span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {run && (
          <span
            className={`hidden min-[480px]:flex items-center gap-1 shrink-0 ${chainOk ? 'text-[#17692e] dark:text-[#34c759]' : 'text-red'}`}
            title={`Audit chain for ${run.id}`}
          >
            {chainOk ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
            <span>{chainOk ? 'Chain verified' : 'Chain broken'}</span>
          </span>
        )}
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex items-center gap-1 rounded px-1 text-muted dark:text-[#a1a1aa] hover:text-ink dark:hover:text-white transition-colors cursor-pointer"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDarkMode ? <Moon size={11} /> : <Sun size={11} />}
          <span>{isDarkMode ? 'Dark' : 'Light'}</span>
        </button>
        <span className="hidden sm:inline text-faint dark:text-[#8e8e93]">GateKeep v0.1.0</span>
      </div>
    </footer>
  )
}
