import { useState } from 'react'
import { X, MessageSquare, CircleAlert, RefreshCw } from 'lucide-react'

export default function ReworkModal({ isOpen, onClose, onConfirm, run, reviewerRole }) {
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  const comments = run?.comments || []

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      let compiled = ''
      if (comments.length > 0) {
        compiled += 'Review Comments:\n'
        comments.forEach((c) => {
          const loc = c.line != null ? `${c.file}:${c.line}` : (c.file || c.phase || 'general')
          compiled += `- [${loc}] (${c.role}): ${c.text}\n`
        })
        compiled += '\n'
      }
      if (feedback.trim()) {
        compiled += `Overall Guidance:\n${feedback.trim()}`
      } else if (!comments.length) {
        compiled = 'Please review and rework the latest phase according to standard conventions.'
      }

      await onConfirm(compiled)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-3xl border border-black/[0.08] bg-white p-7 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <RefreshCw size={17} />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Request Changes &amp; Agent Rework</h2>
              <div className="text-[11.5px] text-faint">Loops back to the respective agent phase with reviewer feedback</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted hover:bg-black/[0.05] hover:text-ink transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-3.5 text-[13px] leading-relaxed text-muted">
          Rejecting the active gate with feedback loops back to the respective agent phase (Requirements, Design, or Coding). The agent will autonomously address your comments and re-run sandbox tests.
        </p>

        {/* Existing review comments summary */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[12px] font-semibold text-ink">
            <span className="flex items-center gap-1.5">
              <MessageSquare size={13} className="text-accent" />
              <span>Pending Review Comments ({comments.length})</span>
            </span>
            <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10.5px] font-mono text-faint">
              Acting as {reviewerRole}
            </span>
          </div>

          {comments.length > 0 ? (
            <div className="mt-2 max-h-44 overflow-y-auto rounded-2xl border border-black/[0.06] bg-black/[0.015] p-3 space-y-2">
              {comments.map((c) => (
                <div key={c.id} className="rounded-xl border border-black/[0.04] bg-white p-2.5 text-[12px] shadow-sm">
                  <div className="flex items-center justify-between text-[11px] text-faint">
                    <span className="font-mono text-accent font-semibold">
                      {c.file}{c.line != null ? `:${c.line}` : ''}
                    </span>
                    <span>{c.author} · {c.role}</span>
                  </div>
                  <div className="mt-1 text-ink">{c.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 rounded-2xl border border-black/[0.06] bg-black/[0.02] p-3.5 text-[12px] text-muted flex items-start gap-2.5">
              <CircleAlert size={15} className="text-faint shrink-0 mt-0.5" />
              <span>
                No inline comments saved yet. You can add overall guidance below, or click any line number in <strong>Code Review</strong> to leave line-level comments.
              </span>
            </div>
          )}
        </div>

        {/* Additional guidance */}
        <div className="mt-4">
          <label className="text-[12px] font-semibold text-ink">
            Additional Rework Guidance / Directives (optional)
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Please ensure exception handling passes when salt is empty, and verify that test_validate.py tests all failure branches."
            rows={3}
            className="mt-1.5 w-full rounded-2xl border border-black/[0.08] bg-white p-3 text-[12.5px] text-ink outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-sm"
          />
        </div>

        {/* Modal actions */}
        <div className="mt-6 flex justify-end gap-2.5 border-t border-black/[0.06] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary"
          >
            <RefreshCw size={14} className={submitting ? 'animate-spin' : ''} />
            <span>Send Feedback to Agent</span>
          </button>
        </div>
      </div>
    </div>
  )
}
