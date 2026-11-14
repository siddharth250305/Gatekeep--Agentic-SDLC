import { useId, useState } from 'react'
import { X, MessageSquare, CircleAlert, RefreshCw } from 'lucide-react'
import Dialog from './Dialog'
import { REWORK_TARGETS, gateComments, reworkFeedback } from '../lib/gate'

// "Request changes" (F6). The reviewer picks where the work goes back to (at
// Gate 3: Code or Design; Gates 1 and 2 have one fixed target), and only this
// gate's new comments are sent. The window is mounted fresh each time it
// opens, so the guidance box always starts empty; it stays open with the text
// kept if the server refuses the decision.
export default function ReworkModal({ onClose, onConfirm, run, reviewerRole }) {
  const titleId = useId()
  const guidanceId = useId()
  const targets = REWORK_TARGETS[run?.step] || []
  const [feedback, setFeedback] = useState('')
  const [target, setTarget] = useState(targets[0]?.value)
  const [submitting, setSubmitting] = useState(false)
  const comments = gateComments(run)

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const sent = await onConfirm(reworkFeedback(comments, feedback), target)
      if (sent) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      onClose={submitting ? undefined : onClose}
      labelledBy={titleId}
      closeOnBackdrop={!feedback.trim()}
      overlayClassName="items-center bg-black/40 backdrop-blur-md animate-fadeIn"
      className="w-full max-w-xl rounded-3xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#18181b] p-7 shadow-pop animate-rise"
    >
      <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.08] pb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 dark:bg-accent/20 text-accent dark:text-[#4da3ff]">
            <RefreshCw size={17} />
          </span>
          <div>
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.015em] text-ink dark:text-white">Request changes</h2>
            <div className="text-[11.5px] text-faint dark:text-[#a1a1aa]">Sends the work back to the agent with your feedback</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1.5 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-ink dark:hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {targets.length > 1 ? (
        <fieldset className="mt-4">
          <legend className="text-[12px] font-semibold text-ink dark:text-white">Send the work back to</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {targets.map((t) => (
              <label
                key={t.value}
                className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 text-[12px] transition-colors ${
                  target === t.value
                    ? 'border-accent bg-accent/[0.06] dark:bg-accent/[0.12]'
                    : 'border-black/[0.08] dark:border-white/[0.12] hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                }`}
              >
                <input
                  type="radio"
                  name="rework-target"
                  value={t.value}
                  checked={target === t.value}
                  onChange={() => setTarget(t.value)}
                  className="mt-0.5 accent-[#0071e3]"
                />
                <span>
                  <span className="block font-semibold text-ink dark:text-white">{t.label}</span>
                  <span className="block text-muted dark:text-[#a1a1aa]">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : targets.length === 1 && (
        <p className="mt-4 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] p-3 text-[12px] text-muted dark:text-[#a1a1aa]">
          <span>Sends the work back to:</span>{' '}
          <span className="font-semibold text-ink dark:text-white">{targets[0].label}</span>
          <span className="block mt-0.5">{targets[0].hint}</span>
        </p>
      )}

      {/* The comments that go with this rework: this gate's, written since its last rework */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px] font-semibold text-ink dark:text-white">
          <span className="flex items-center gap-1.5">
            <MessageSquare size={13} className="text-accent dark:text-[#4da3ff]" />
            <span>Comments sent with this rework ({comments.length})</span>
          </span>
          <span className="rounded-full bg-black/[0.04] dark:bg-white/[0.08] px-2 py-0.5 text-[10.5px] font-mono text-faint dark:text-[#a1a1aa]">
            Signed in as {reviewerRole}
          </span>
        </div>

        {comments.length > 0 ? (
          <ul aria-label="Comments that will be sent" className="mt-2 max-h-44 overflow-y-auto rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.03] p-3 space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-xl border border-black/[0.04] dark:border-white/[0.08] bg-white dark:bg-[#202024] p-2.5 text-[12px] shadow-sm">
                <div className="flex items-center justify-between text-[11px] text-faint dark:text-[#8e8e93]">
                  <span className="font-mono text-accent dark:text-[#4da3ff] font-semibold">
                    {c.file}{c.line != null ? `:${c.line}` : ''}
                  </span>
                  <span>{c.author} · {c.role}</span>
                </div>
                <div className="mt-1 text-ink dark:text-[#f5f5f7]">{c.text}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] p-3.5 text-[12px] text-muted dark:text-[#a1a1aa] flex items-start gap-2.5">
            <CircleAlert size={15} className="text-faint dark:text-[#8e8e93] shrink-0 mt-0.5" />
            <span>
              No new comments on this step. Comments already sent with an earlier rework are not sent again. Add guidance below.
            </span>
          </div>
        )}
      </div>

      <div className="mt-4">
        <label htmlFor={guidanceId} className="text-[12px] font-semibold text-ink dark:text-white">
          Additional guidance for the agent (optional)
        </label>
        <textarea
          id={guidanceId}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="e.g. Please ensure exception handling passes when salt is empty, and verify that test_validate.py tests all failure branches."
          rows={3}
          className="mt-1.5 w-full rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#141416] p-3 text-[12.5px] text-ink dark:text-[#f5f5f7] dark:placeholder-[#71717a] outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-sm"
        />
      </div>

      <div className="mt-6 flex justify-end gap-2.5 border-t border-black/[0.06] dark:border-white/[0.08] pt-4">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary">
          <RefreshCw size={14} className={submitting ? 'animate-spin' : ''} />
          <span>Send Feedback to Agent</span>
        </button>
      </div>
    </Dialog>
  )
}
