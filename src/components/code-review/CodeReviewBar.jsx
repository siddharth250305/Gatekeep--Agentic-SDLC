import { useEffect, useState } from 'react'
import { File, Copy, Download, Check, ChevronDown, Search, GitBranch } from 'lucide-react'

// Top bar of the Code Review page: repo / branch / file breadcrumb, the quick
// file finder, and copy / patch actions for the open file.
export default function CodeReviewBar({ run, activeFile, fileList, modifiedFiles, onOpenFile, onQuickOpen, onDownloadPatch, onCopyCode, copied }) {
  // Breadcrumb dropdown state: 'repo' | 'branch' | 'file' | null
  const [activeDropdown, setActiveDropdown] = useState(null)

  // Close dropdown on click outside, or with Esc.
  useEffect(() => {
    const closeMenu = () => setActiveDropdown(null)
    const onKey = (e) => { if (e.key === 'Escape') setActiveDropdown(null) }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const toggle = (name) => setActiveDropdown(activeDropdown === name ? null : name)
  const totalAdd = modifiedFiles.reduce((acc, f) => acc + (f.add || 0), 0)
  const totalRem = modifiedFiles.reduce((acc, f) => acc + (f.rem || 0), 0)
  const pathParts = (activeFile.path || '').split('/')
  const fileName = pathParts.pop() || ''
  const folderParts = pathParts

  return (
    <div className="flex h-[40px] shrink-0 items-center justify-between border-b border-black/[0.08] bg-[#fbfbfd] surface-ide-bar px-3.5 z-20 gap-3 dark:border-white/[0.08] dark:bg-[#0b0b0d]">
      {/* Left: Interactive Codebase Breadcrumb Path (Auto-shrinks, never overflows) */}
      <div className="flex items-center gap-1 text-[12px] text-muted min-w-0 flex-1 overflow-hidden dark:text-[#a1a1aa]">
        {/* Repo selector dropdown */}
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => toggle('repo')}
            aria-expanded={activeDropdown === 'repo'}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold text-ink hover:bg-black/[0.05] transition-colors dark:text-[#f5f5f7] dark:hover:bg-white/[0.08]"
            title="Codebase Repository"
          >
            <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded bg-black/10 text-ink text-[10px] dark:bg-white/10 dark:text-white">
              📦
            </span>
            <span className="truncate max-w-[120px]">{run?.repo || 'Unknown repository'}</span>
            <ChevronDown size={11} className="text-faint dark:text-[#8e8e93]" />
          </button>
          {activeDropdown === 'repo' && (
            <div className="absolute left-0 top-full mt-1 w-56 rounded-xl border border-black/[0.08] bg-white p-1 shadow-pop z-50 animate-rise text-[12px] dark:border-white/[0.12] dark:bg-[#18181b]">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
                Active Codebase
              </div>
              <div className="rounded-lg bg-accent/10 px-2.5 py-1.5 font-semibold text-accent flex items-center justify-between">
                <span>{run?.repo || 'Unknown repository'}</span>
                <Check size={12} />
              </div>
              <div className="mt-1 border-t border-black/[0.04] pt-1 text-[11px] text-faint px-2.5 py-1 dark:border-white/[0.06] dark:text-[#8e8e93]">
                Commit: {run?.commit || 'not shipped yet'}
              </div>
            </div>
          )}
        </div>

        <span className="text-faint shrink-0 dark:text-[#8e8e93]">/</span>

        {/* Branch dropdown */}
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => toggle('branch')}
            aria-expanded={activeDropdown === 'branch'}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-ink font-medium hover:bg-black/[0.05] transition-colors dark:text-[#f5f5f7] dark:hover:bg-white/[0.08]"
            title="Git Branch"
          >
            <GitBranch size={12} className="text-accent shrink-0" />
            <span className="truncate max-w-[130px]">{run?.branch || 'Unknown branch'}</span>
            <ChevronDown size={11} className="text-faint dark:text-[#8e8e93]" />
          </button>
          {activeDropdown === 'branch' && (
            <div className="absolute left-0 top-full mt-1 w-64 rounded-xl border border-black/[0.08] bg-white p-1 shadow-pop z-50 animate-rise text-[12px] dark:border-white/[0.12] dark:bg-[#18181b]">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
                Branch of this run
              </div>
              <div className="rounded-lg bg-accent/10 px-2.5 py-1.5 font-semibold text-accent flex items-center justify-between">
                <span>{run?.branch || 'Unknown branch'}</span>
              </div>
            </div>
          )}
        </div>

        {folderParts.map((folder, idx) => (
          <span key={idx} className="hidden sm:flex items-center gap-1 shrink-0">
            <span className="text-faint dark:text-[#8e8e93]">/</span>
            <span className="rounded px-1.5 py-0.5 text-faint dark:text-[#8e8e93]">{folder}</span>
          </span>
        ))}

        <span className="text-faint shrink-0 dark:text-[#8e8e93]">/</span>

        {/* Active File Switcher with Sibling Files */}
        <div className="relative min-w-0 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => toggle('file')}
            aria-expanded={activeDropdown === 'file'}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold text-accent bg-accent/10 hover:bg-accent/15 transition-colors"
            title="Click to switch sibling file"
          >
            <File size={12} className="shrink-0" />
            <span className="truncate max-w-[140px]">{fileName || 'No file'}</span>
            {activeFile.modified && (
              <span className={`rounded px-1 font-mono text-[9.5px] font-bold shrink-0 ${
                activeFile.status === 'A' ? 'bg-[#34c759]/20 text-[#17692e] dark:text-[#34c759]'
                  : activeFile.status === 'D' ? 'bg-[#ff3b30]/15 text-[#c4161c] dark:text-[#ff453a]'
                    : 'bg-[#ff9500]/20 text-[#8f4700] dark:text-[#ff9f0a]'
              }`}>
                {activeFile.status === 'A' || activeFile.status === 'D' ? activeFile.status : 'M'}
              </span>
            )}
            <ChevronDown size={11} className="text-accent shrink-0" />
          </button>
          {activeDropdown === 'file' && (
            <div className="absolute left-0 top-full mt-1 w-60 rounded-xl border border-black/[0.08] bg-white p-1 shadow-pop z-50 animate-rise text-[12px] dark:border-white/[0.12] dark:bg-[#18181b]">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
                Files in this Folder
              </div>
              {fileList
                .filter((f) => f.folder === activeFile.folder)
                .map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => { onOpenFile(f.path); setActiveDropdown(null) }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                      f.path === activeFile.path ? 'bg-accent/10 text-accent font-semibold' : 'text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <File size={12} className={f.path === activeFile.path ? 'text-accent' : 'text-faint dark:text-[#8e8e93]'} />
                      <span className="truncate">{f.name}</span>
                    </div>
                    {f.modified && (
                      <span className="font-mono text-[10px] font-semibold text-[#17692e] dark:text-[#34c759]">
                        +{f.add} -{f.rem}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Center: Quick Search / Codebase Jumper Button */}
      <button
        type="button"
        onClick={onQuickOpen}
        aria-label="Find file (⌘P)"
        className="flex h-7 items-center justify-between rounded-xl bg-black/[0.04] px-2.5 text-muted hover:bg-black/[0.07] border border-black/[0.04] text-[12px] transition-colors shrink-0 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-[#a1a1aa] dark:hover:bg-white/[0.1]"
      >
        <div className="flex items-center gap-2">
          <Search size={12} className="text-faint dark:text-[#8e8e93]" />
          <span className="text-faint hidden lg:inline dark:text-[#8e8e93]">Find file in codebase...</span>
        </div>
        <kbd className="rounded border border-black/[0.08] bg-white px-1.5 py-0.5 font-mono text-[9px] text-faint shadow-xs ml-2 dark:border-white/[0.12] dark:bg-white/10 dark:text-[#a1a1aa]">
          ⌘P
        </kbd>
      </button>

      {/* Right: Codebase Stats & View Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden 2xl:flex items-center gap-1.5 font-mono text-[11px] text-muted mr-1 dark:text-[#a1a1aa]">
          <span className="font-semibold text-ink dark:text-[#f5f5f7]">{modifiedFiles.length} modified</span>
          <span>·</span>
          <span className="text-[#17692e] font-semibold dark:text-[#34c759]">+{totalAdd}</span>
          <span className="text-[#d70015] font-semibold dark:text-[#ff453a]">-{totalRem}</span>
        </div>

        <button
          type="button"
          onClick={onDownloadPatch}
          aria-label="Download patch"
          className="flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white hover:bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink transition-colors shadow-2xs dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-[#f5f5f7] dark:hover:bg-white/[0.1]"
          title="Download unified diff patch for this run"
        >
          <Download size={11} className="text-muted dark:text-[#a1a1aa]" />
          <span className="hidden sm:inline">Patch</span>
        </button>

        <button
          type="button"
          onClick={onCopyCode}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white hover:bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink transition-colors shadow-2xs dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-[#f5f5f7] dark:hover:bg-white/[0.1]"
          title="Copy current code to clipboard"
        >
          {copied ? <Check size={11} className="text-green dark:text-[#34c759]" /> : <Copy size={11} className="text-muted dark:text-[#a1a1aa]" />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  )
}
