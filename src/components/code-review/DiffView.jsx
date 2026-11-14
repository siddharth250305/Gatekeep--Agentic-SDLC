import { useState } from 'react'
import { Plus, MessageSquare, X, Eye } from 'lucide-react'
import { highlight } from './highlight'

// The diff of one file, with a comment button on every line. The buttons are
// always visible (faint until hover or keyboard focus), so a keyboard user can
// Tab to them (F7). Line numbers are not selectable, so copied code is clean.
export default function DiffView({ activeFile, diffLines, onAddComment, reviewerRole, onFullView }) {
  // The row (not the line number: a removed and an added line can share one) being commented on.
  const [activeCommentRow, setActiveCommentRow] = useState(null)
  const [commentText, setCommentText] = useState('')

  // Saving a line comment only saves the comment. Rejecting the gate is a
  // separate, deliberate action ("Request changes"), which sends these comments.
  const submitComment = async (lineNo) => {
    if (!commentText.trim() || !onAddComment) return
    try {
      await onAddComment({ line: lineNo, file: activeFile.path, text: commentText.trim(), role: reviewerRole })
    } catch {
      return // keep the draft so nothing typed is lost; the error toast explains why
    }
    setActiveCommentRow(null)
    setCommentText('')
  }

  return (
    <>
      {/* Status bar of the active file */}
      <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-black/[0.015] px-4 text-[11.5px] gap-2 min-w-0 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <div className="flex items-center gap-2 font-mono text-muted min-w-0 truncate dark:text-[#a1a1aa]">
          <span className="font-semibold text-ink truncate dark:text-[#f5f5f7]">{activeFile.path || 'No file'}</span>
          {activeFile.header && <span className="text-faint shrink-0 dark:text-[#8e8e93]">{activeFile.header}</span>}
        </div>
        <button
          type="button"
          onClick={onFullView}
          className="shrink-0 text-muted hover:text-ink flex items-center gap-1 transition-colors text-[11px] dark:text-[#a1a1aa] dark:hover:text-white"
        >
          <Eye size={12} /> Full view
        </button>
      </div>

      <div className="relative flex-1 overflow-auto bg-white font-mono text-[12px] leading-[1.65] dark:bg-[#000000]">
        <div className="py-2 min-w-full">
          {diffLines.map((line, idx) => {
            const lineNo = line.n2 || line.n1 || idx + 1
            const isRem = line.type === 'rem'
            const isAdd = line.type === 'add'
            const bg = isRem ? 'bg-[#ff3b30]/10 dark:bg-[#ff453a]/15' : isAdd ? 'bg-[#34c759]/10 dark:bg-[#34c759]/15' : ''
            const sign = isRem ? '-' : isAdd ? '+' : ' '
            const signColor = isRem ? 'text-[#d70015] dark:text-[#ff453a] font-bold' : isAdd ? 'text-[#17692e] dark:text-[#34c759] font-bold' : 'text-transparent'
            const drafting = activeCommentRow === idx
            const lineName = `${isRem ? 'removed line' : 'line'} ${lineNo}`

            return (
              <div key={idx} className="relative group">
                <div className={`flex items-stretch hover:bg-black/[0.02] dark:hover:bg-white/[0.04] ${bg}`}>
                  <div className="w-14 shrink-0 px-2 text-right font-mono text-[11px] text-faint flex items-center justify-end gap-1.5 dark:text-[#a1a1aa]">
                    {!line.placeholder && <button
                      type="button"
                      onClick={() => setActiveCommentRow(drafting ? null : idx)}
                      title="Comment on this line"
                      aria-label={`Comment on ${lineName}`}
                      aria-expanded={drafting}
                      className="opacity-30 group-hover:opacity-100 focus-visible:opacity-100 text-accent transition-all p-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
                    >
                      <Plus size={11} strokeWidth={2.5} />
                    </button>}
                    <span className="w-7 text-right select-none" aria-hidden="true">{lineNo}</span>
                  </div>
                  <span className={`w-5 shrink-0 select-none text-center font-mono text-[12px] ${signColor}`} aria-hidden="true">{sign}</span>
                  <code className="min-w-0 flex-1 whitespace-pre pr-4 font-mono text-[12px]">{highlight(line.text)}</code>
                </div>

                {drafting && (
                  <div className="border-y border-accent/20 bg-accent/[0.03] p-3 pl-16 space-y-2 dark:bg-accent/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] font-semibold text-accent flex items-center gap-1.5 font-sans">
                        <MessageSquare size={12} />
                        Add Review Instruction on Line {lineNo}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveCommentRow(null)}
                        aria-label="Close comment box"
                        className="text-faint hover:text-ink dark:text-[#8e8e93] dark:hover:text-white"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <textarea
                      autoFocus
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setActiveCommentRow(null) }}
                      aria-label={`Comment on ${lineName}`}
                      placeholder="Explain required changes or rework instructions for the agent..."
                      rows={2}
                      className="w-full rounded-xl border border-black/[0.1] bg-white p-2.5 text-[12px] font-sans text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/[0.12] dark:bg-[#121214] dark:text-white dark:placeholder-[#71717a]"
                    />
                    <div className="flex justify-end gap-2 font-sans">
                      <button
                        type="button"
                        onClick={() => setActiveCommentRow(null)}
                        className="rounded-lg border border-black/[0.08] px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-black/[0.04] dark:border-white/[0.1] dark:text-[#f5f5f7] dark:hover:bg-white/[0.08]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => submitComment(lineNo)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-[11px] font-semibold text-white shadow-xs hover:bg-accent-hover"
                      >
                        <MessageSquare size={11} />
                        <span>Save comment</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
