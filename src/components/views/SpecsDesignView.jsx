import { useState } from 'react'
import { FileText, ShieldAlert, Cpu, CircleCheck, MessageSquare, Trash, Send, Lock, FileCode } from 'lucide-react'

export default function SpecsDesignView({ run, reviewerRole, onAddComment, onDeleteComment }) {
  const [activeTab, setActiveTab] = useState('requirements')
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!run) {
    return (
      <div className="card p-12 text-center text-[13px] text-muted shadow-card">
        <FileText size={32} className="mx-auto text-faint mb-3" />
        <h3 className="text-[16px] font-semibold text-ink">No Run Selected</h3>
        <p className="mt-1 text-[13px] text-muted">Select an active run from the header or launch a new workflow to view requirements.</p>
      </div>
    )
  }

  const reqText = run?.requirements || (run?.summary ? `${run.summary.headline}\n\n${run.summary.sub}\n\n- ${run.summary.checks?.join('\n- ')}` : null)
  const design = run?.design || {}

  const comments = (run?.comments || []).filter(
    (c) => c.phase === activeTab || (activeTab === 'requirements' && c.phase === 'req')
  )

  const handlePostComment = async () => {
    if (!commentText.trim() || !onAddComment) return
    setSubmitting(true)
    try {
      await onAddComment({
        text: commentText.trim(),
        phase: activeTab,
        role: reviewerRole,
        file: activeTab === 'design' ? (design.files_to_modify?.[0] || 'design.json') : 'requirements.md',
        line: null,
      })
      setCommentText('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Run Context Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl bg-black/[0.025] border border-black/[0.05] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent font-mono font-bold text-[13px]">
            {run?.id?.slice(0, 4) || 'RUN'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-bold text-ink">{run?.id}</span>
              <span className="text-muted">·</span>
              <span className="text-[12px] font-semibold text-accent">{run?.repo || 'Local Workspace'}</span>
              {run?.branch && <span className="font-mono text-[11px] text-faint">({run.branch})</span>}
            </div>
            <p className="text-[12.5px] text-muted line-clamp-1 mt-0.5">{run?.brief}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] font-semibold ${
            run?.awaiting ? 'bg-[#ff9500]/15 text-[#b25000] border border-[#ff9500]/25' :
            run?.status === 'approved' ? 'bg-[#34c759]/15 text-[#1f7a37] border border-[#34c759]/25' :
            'bg-black/[0.04] text-muted'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${run?.awaiting ? 'bg-[#ff9500] animate-pulse' : 'bg-[#34c759]'}`} />
            <span>{run?.awaiting ? `Awaiting Gate: ${run?.gate || 'Review'}` : run?.status || 'Active'}</span>
          </span>
        </div>
      </div>

      {/* Sub-header navigation with Apple Segmented Control */}
      <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
        <div className="segmented-control">
          <button
            type="button"
            onClick={() => setActiveTab('requirements')}
            className={`segmented-item ${activeTab === 'requirements' ? 'segmented-item-active' : ''}`}
          >
            <FileText size={14} />
            <span>Phase 1: Requirements</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('design')}
            className={`segmented-item ${activeTab === 'design' ? 'segmented-item-active' : ''}`}
          >
            <Cpu size={14} />
            <span>Phase 2: Technical Design</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-faint">
          <span className="flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1">
            <MessageSquare size={13} className="text-accent" />
            <span className="font-mono tabnum font-semibold text-ink">{comments.length}</span> review notes
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Main Content Area */}
        <div className="card min-w-0 p-6">
          {activeTab === 'requirements' && (
            <div>
              <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
                <div>
                  <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Engineering Requirements</h2>
                  <p className="mt-0.5 text-[13px] text-muted">
                    Formal user stories, acceptance criteria, and injection boundaries.
                  </p>
                </div>
                <span className="rounded-full bg-accent/10 px-3 py-1 font-mono text-[11px] font-semibold text-accent border border-accent/20">
                  Reviewed by Planner
                </span>
              </div>

              {reqText ? (
                <div className="mt-5 space-y-5">
                  <div className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-5 font-mono text-[12.5px] leading-relaxed text-ink whitespace-pre-wrap">
                    {reqText}
                  </div>

                  <div className="rounded-2xl border border-green/20 bg-green/[0.04] p-5">
                    <h3 className="text-[13.5px] font-semibold text-[#1f7a37] flex items-center gap-2">
                      <CircleCheck size={16} strokeWidth={2.5} /> Verification Criteria
                    </h3>
                    <ul className="mt-3 space-y-2.5 text-[13px] text-muted">
                      <li className="flex items-start gap-2.5">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#34c759] shrink-0" />
                        <span>Every acceptance scenario mapped to deterministic unit tests.</span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#34c759] shrink-0" />
                        <span>Prompt injection patterns and malformed inputs quarantined.</span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#34c759] shrink-0" />
                        <span>No speculative features beyond approved user requirements.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-[13px] text-muted">
                  No requirements generated for this run yet. Run the pipeline to begin.
                </div>
              )}
            </div>
          )}

          {activeTab === 'design' && (
            <div>
              <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
                <div>
                  <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Technical Architecture &amp; File Plan</h2>
                  <p className="mt-0.5 text-[13px] text-muted">
                    Concrete module targets, threat mitigations, and implementation structure.
                  </p>
                </div>
                <span className="rounded-full bg-accent/10 px-3 py-1 font-mono text-[11px] font-semibold text-accent border border-accent/20">
                  Reviewed by Engineer
                </span>
              </div>

              <div className="mt-5 space-y-6">
                {/* Files to modify / create */}
                <div>
                  <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">Target File Plan</h3>
                  <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4">
                      <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                        <FileCode size={14} className="text-accent" /> Files to Modify
                      </div>
                      <div className="mt-2 flex flex-col gap-1 font-mono text-[12px] text-accent">
                        {design.files_to_modify?.length ? (
                          design.files_to_modify.map((f) => <span key={f}>• {f}</span>)
                        ) : (
                          <span className="text-muted">None specified</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4">
                      <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                        <FileCode size={14} className="text-[#1f7a37]" /> Files to Create
                      </div>
                      <div className="mt-2 flex flex-col gap-1 font-mono text-[12px] text-[#1f7a37]">
                        {design.files_to_create?.length ? (
                          design.files_to_create.map((f) => <span key={f}>+ {f}</span>)
                        ) : (
                          <span className="text-muted">None specified</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* STRIDE threat model */}
                <div>
                  <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-amber" /> STRIDE Threat &amp; Risk Mitigation
                  </h3>
                  <div className="mt-2.5 rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4 text-[13px] text-muted">
                    {design.threat_model ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{design.threat_model}</p>
                    ) : (
                      <ul className="space-y-2.5">
                        <li className="flex items-start gap-2">
                          <Lock size={14} className="text-accent shrink-0 mt-0.5" />
                          <span><strong className="text-ink">Spoofing:</strong> Tamper-evident SHA-256 HMAC signature verification on all payloads.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Lock size={14} className="text-accent shrink-0 mt-0.5" />
                          <span><strong className="text-ink">Tampering:</strong> Read-only root container mount with temporary scratch volumes only.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Lock size={14} className="text-accent shrink-0 mt-0.5" />
                          <span><strong className="text-ink">Information Disclosure:</strong> Repository context scanner strips tokens, keys, and private env variables.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Lock size={14} className="text-accent shrink-0 mt-0.5" />
                          <span><strong className="text-ink">Denial of Service:</strong> Sandbox cgroup constraints capped at 512MB RAM, 1 CPU, 30s timeout.</span>
                        </li>
                      </ul>
                    )}
                  </div>
                </div>

                {/* Raw Design JSON toggle */}
                {Object.keys(design).length > 0 && (
                  <div>
                    <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">Architecture Manifest</h3>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-2xl border border-black/[0.06] bg-[#0d1117] p-4 font-mono text-[11px] text-[#e6edf3]">
                      {JSON.stringify(design, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Phase Review Comments Sidebar */}
        <div className="flex flex-col gap-4">
          <div className="card p-5">
            <h3 className="text-[14px] font-semibold text-ink flex items-center gap-2">
              <MessageSquare size={16} className="text-accent" />
              <span>Phase Review Notes</span>
            </h3>
            <p className="mt-1 text-[12px] text-muted">
              Add feedback on this {activeTab} phase. These comments are fed to the agent during rework.
            </p>

            <div className="mt-4 flex flex-col gap-2.5">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={`Leave feedback on ${activeTab}...`}
                rows={3}
                className="w-full rounded-xl border border-black/[0.08] bg-white p-3 text-[12.5px] text-ink outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-sm"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handlePostComment}
                  disabled={!commentText.trim() || submitting}
                  className="btn-primary !text-[12px] !py-1.5 !px-3"
                >
                  <Send size={12} /> Post Note
                </button>
              </div>
            </div>

            {/* List of comments */}
            <div className="mt-5 border-t border-black/[0.06] pt-4">
              <div className="text-[12px] font-semibold text-ink">
                Review Notes ({comments.length})
              </div>
              {comments.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-faint">
                  No review comments yet on this phase.
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2.5">
                  {comments.map((c) => (
                    <div key={c.id} className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-3 text-[12px]">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-ink">{c.author || 'Reviewer'}</span>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-accent/10 px-2 py-0.2 font-mono text-[9.5px] text-accent font-medium">
                            {c.role}
                          </span>
                          {onDeleteComment && (
                            <button
                              type="button"
                              onClick={() => onDeleteComment(c.id)}
                              className="text-faint hover:text-red transition-colors"
                              title="Delete note"
                            >
                              <Trash size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1.5 text-ink leading-relaxed whitespace-pre-wrap">{c.text}</p>
                      <div className="mt-1 font-mono text-[10px] text-faint">
                        {new Date(c.createdAt || Date.now()).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
