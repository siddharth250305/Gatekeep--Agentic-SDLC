import { File, Plus, X } from 'lucide-react'

// The strip of open files above the diff. Each tab is a real button, so the
// keyboard reaches it; the close button stays visible (not hover-only).
export default function OpenTabs({ openTabs, files, selectedPath, onSelect, onClose, onQuickOpen }) {
  return (
    <div className="flex h-[36px] shrink-0 items-center border-b border-black/[0.06] bg-[#f5f5f7] surface-ide-bar px-2 gap-1 overflow-x-auto dark:border-white/[0.08] dark:bg-[#0b0b0d]">
      {openTabs.map((tabPath) => {
        const file = files[tabPath] || { name: tabPath.split('/').pop(), modified: false, status: 'clean' }
        const isActive = tabPath === selectedPath
        return (
          <div
            key={tabPath}
            className={`flex h-[28px] items-center gap-1 rounded-lg pl-2.5 pr-1 text-[12px] font-medium transition-all ${
              isActive
                ? 'bg-white text-ink font-semibold shadow-xs border border-black/[0.06] dark:border-white/[0.1] dark:bg-[#1a1a1d] dark:text-white'
                : 'text-muted hover:bg-black/[0.04] hover:text-ink dark:text-[#a1a1aa] dark:hover:bg-white/[0.06] dark:hover:text-white'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(tabPath)}
              aria-current={isActive ? 'true' : undefined}
              title={tabPath}
              className="flex items-center gap-2 cursor-pointer"
            >
              <File size={13} className={isActive ? 'text-accent' : 'text-faint dark:text-[#8e8e93]'} />
              <span className="truncate max-w-[140px]">{file.name}</span>
              {file.modified && (
                <span className={`rounded px-1 font-mono text-[9px] font-bold ${
                  file.status === 'A' ? 'bg-[#34c759]/20 text-[#17692e] dark:text-[#34c759]' : 'bg-[#ff9500]/20 text-[#8f4700] dark:text-[#ff9f0a]'
                }`}>
                  {file.status || 'M'}
                </span>
              )}
            </button>
            {openTabs.length > 1 && (
              <button
                type="button"
                onClick={() => onClose(tabPath)}
                className="rounded p-0.5 text-faint opacity-60 hover:opacity-100 focus-visible:opacity-100 hover:bg-black/[0.08] hover:text-ink transition-colors dark:text-[#8e8e93] dark:hover:bg-white/[0.1] dark:hover:text-white"
                title="Close tab"
                aria-label={`Close ${file.name}`}
              >
                <X size={10} />
              </button>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={onQuickOpen}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-faint hover:bg-black/[0.05] hover:text-ink transition-colors dark:text-[#8e8e93] dark:hover:bg-white/[0.08] dark:hover:text-white"
        title="Open another changed file (⌘P)"
        aria-label="Open another changed file"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
