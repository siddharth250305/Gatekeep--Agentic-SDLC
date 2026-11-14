import { useState } from 'react'
import { MessageSquare, Trash, Send } from 'lucide-react'
import { canDeleteComment } from '../../lib/permissions'

// Review notes for one phase of the Specs & Design page. The notes are fed to
// the agent when the reviewer requests changes at that phase's gate.
export default function ReviewNotes({ phase, comments, currentUser, onPost, onDeleteComment }) {
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handlePost = async () => {
    if (!commentText.trim() || !onPost) return
    setSubmitting(true)
    try {
      await onPost(commentText.trim())
      setCommentText('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card p-5 shadow-card">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink dark:text-[#f5f5f7]">
        <MessageSquare size={16} className="text-accent" />
        <span>Phase Review Notes</span>
      </h3>
      <p className="mt-1 text-[12px] text-muted dark:text-[#a1a1aa]">Add feedback on this {phase} phase. Notes are sent to the agent when this phase's gate requests changes.</p>

      <div className="mt-4 flex flex-col gap-2.5">
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder={`Leave feedback on ${phase}...`}
          aria-label={`Review note on ${phase}`}
          rows={3}
          className="w-full rounded-xl border border-black/[0.08] bg-white p-3 text-[12.5px] text-ink shadow-sm outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/[0.12] dark:bg-[#1a1a1d] dark:text-[#f5f5f7] dark:placeholder-[#71717a]"
        />
        <div className="flex justify-end">
          <button type="button" onClick={handlePost} disabled={!commentText.trim() || submitting} className="btn-primary !px-3 !py-1.5 !text-[12px]">
            <Send size={12} /> Post Note
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
        <div className="text-[12px] font-semibold text-ink dark:text-[#f5f5f7]">Review Notes ({comments.length})</div>
        {comments.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-faint dark:text-[#8e8e93]">No review comments yet on this phase.</div>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            {comments.map((c) => (
              <div key={c.id} className="surface-raised rounded-xl border border-black/[0.06] bg-black/[0.015] p-3 text-[12px] dark:border-white/[0.08] dark:bg-white/[0.03]">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-ink dark:text-[#f5f5f7]">{c.author || 'Reviewer'}</span>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[9.5px] font-medium text-accent">{c.role}</span>
                    {onDeleteComment && canDeleteComment(c, currentUser) && (
                      <button type="button" onClick={() => onDeleteComment(c.id)} className="text-faint transition-colors hover:text-red dark:text-[#8e8e93]" title="Delete note" aria-label="Delete note">
                        <Trash size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed text-ink dark:text-[#e4e4e7]">{c.text}</p>
                <div className="mt-1 font-mono text-[10px] text-faint dark:text-[#8e8e93]">{new Date(c.createdAt || Date.now()).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
