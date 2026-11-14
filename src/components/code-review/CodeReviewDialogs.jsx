import { useId, useMemo, useState } from 'react'
import { File, Search, X } from 'lucide-react'
import Dialog from '../Dialog'

// ⌘P quick open: jump to any file this run changed.
export function QuickOpenDialog({ fileList, selectedPath, onOpenFile, onClose }) {
  const [quickSearch, setQuickSearch] = useState('')
  const filtered = useMemo(() => {
    if (!quickSearch.trim()) return fileList
    const q = quickSearch.toLowerCase()
    return fileList.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
  }, [fileList, quickSearch])

  return (
    <Dialog
      onClose={onClose}
      label="Open a changed file"
      overlayClassName="items-start pt-24 bg-black/40 backdrop-blur-sm"
      className="w-full max-w-xl rounded-2xl border border-black/[0.1] bg-white shadow-pop overflow-hidden animate-rise dark:border-white/[0.12] dark:bg-[#18181b]"
    >
      <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
        <Search size={16} className="text-muted dark:text-[#a1a1aa]" />
        <input
          data-autofocus
          value={quickSearch}
          onChange={(e) => setQuickSearch(e.target.value)}
          aria-label="Search changed files"
          placeholder="Type the name of a file to open in the IDE..."
          className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint dark:text-white dark:placeholder-[#71717a]"
        />
        <kbd className="rounded border border-black/[0.08] bg-black/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-faint dark:border-white/[0.12] dark:bg-white/10 dark:text-[#a1a1aa]">
          ESC
        </kbd>
      </div>

      <div className="max-h-80 overflow-y-auto p-2 space-y-1">
        {filtered.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => onOpenFile(f.path)}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors ${
              f.path === selectedPath ? 'bg-accent/10 text-accent font-semibold' : 'text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]'
            }`}
          >
            <div className="flex items-center gap-2.5 truncate">
              <File size={14} className={f.path === selectedPath ? 'text-accent' : 'text-faint dark:text-[#8e8e93]'} />
              <span className="text-[13px]">{f.name}</span>
              <span className="font-mono text-[11px] text-faint truncate dark:text-[#8e8e93]">{f.path}</span>
            </div>
            <span className="rounded bg-[#ff9500]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#8f4700] dark:text-[#ff9f0a]">
              +{f.add} -{f.rem}
            </span>
          </button>
        ))}
        {!filtered.length && <div className="px-3 py-4 text-center text-[12px] text-muted dark:text-[#a1a1aa]">No changed file matches.</div>}
      </div>
    </Dialog>
  )
}

// The whole diff of one file, without the review chrome.
export function FullFileDialog({ path, diffLines, onClose }) {
  const titleId = useId()
  return (
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      overlayClassName="items-center bg-black/30 p-6 backdrop-blur-md"
      className="flex h-[80vh] w-full max-w-4xl flex-col rounded-3xl border border-black/[0.08] bg-white shadow-pop overflow-hidden dark:border-white/[0.12] dark:bg-[#18181b]"
    >
      <div className="flex items-center justify-between border-b border-black/[0.06] bg-black/[0.015] px-6 py-3.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="flex items-center gap-2">
          <File size={16} className="text-accent" />
          <span id={titleId} className="font-mono text-[13px] font-semibold text-ink dark:text-[#f5f5f7]">{path}</span>
          <span className="rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[11px] text-faint dark:bg-white/10 dark:text-[#a1a1aa]">Full Source</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close full view"
          className="rounded-full p-1 text-muted hover:bg-black/[0.06] hover:text-ink transition-colors dark:text-[#a1a1aa] dark:hover:bg-white/[0.08] dark:hover:text-white"
        >
          <X size={17} />
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-[#f8f9fa] dark:bg-[#090b0e] p-5 font-mono text-[12px] leading-relaxed text-[#24292f] dark:text-[#e6edf3]">
        <pre className="whitespace-pre">
          {diffLines.map((l, i) => (
            <div key={i} className="flex">
              <span className="w-12 select-none text-right pr-4 text-gray-500 font-mono text-[11px]" aria-hidden="true">
                {l.n2 || l.n1 || i + 1}
              </span>
              <span>{l.text}</span>
            </div>
          ))}
        </pre>
      </div>
    </Dialog>
  )
}
