import { useState, useMemo } from 'react'
import { FileText, Cpu, MessageSquare } from 'lucide-react'
import RequirementsPanel from '../specs/RequirementsPanel'
import DesignPanel from '../specs/DesignPanel'
import ReviewNotes from '../specs/ReviewNotes'
import { plannedFiles, requirementsText } from '../../lib/markdown'

// =========================================================================
// SPECS & DESIGN VIEW: Gate 1 (requirements) and Gate 2 (design) review
// =========================================================================

// initialSection: which half opens first ('requirements' or 'design').
export default function SpecsDesignView({ run, reviewerRole, currentUser, onAddComment, onDeleteComment, initialSection = 'requirements' }) {
  const [activeTab, setActiveTab] = useState(initialSection)

  const reqText = requirementsText(run)
  const design = run?.design ?? null
  const { filesToCreate, filesToModify, filesSource } = useMemo(
    () => plannedFiles(design, run?.files),
    [design, run?.files],
  )

  if (!run) {
    return (
      <div className="card p-12 text-center text-[13px] text-muted shadow-card">
        <FileText size={32} className="mx-auto mb-3 text-faint" />
        <h3 className="text-[16px] font-semibold text-ink">No Run Selected</h3>
        <p className="mt-1 text-[13px] text-muted">Select an active run from the header or launch a new workflow to view requirements.</p>
      </div>
    )
  }

  const comments = (run?.comments || []).filter(
    (c) => c.phase === activeTab || (activeTab === 'requirements' && c.phase === 'req')
  )

  const postNote = (text) => onAddComment?.({
    text,
    phase: activeTab,
    role: reviewerRole,
    file: activeTab === 'design' ? (filesToModify[0]?.path || filesToCreate[0]?.path || 'design.md') : 'requirements.md',
    line: null,
  })

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Run Context Header Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.05] bg-black/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 font-mono text-[13px] font-bold text-accent">
            {run?.id?.replace(/^RUN-/, '').slice(0, 4) || 'RUN'}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span className="font-mono text-[13px] font-bold text-ink dark:text-[#f5f5f7]">{run?.id}</span>
              <span className="text-muted dark:text-[#a1a1aa]">·</span>
              <span className="truncate text-[12px] font-semibold text-accent">{run?.repo || 'Local Workspace'}</span>
              {run?.branch && <span className="font-mono text-[11px] text-faint dark:text-[#8e8e93]">({run.branch})</span>}
            </div>
            <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted dark:text-[#a1a1aa]">{run?.brief}</p>
          </div>
        </div>
      </div>

      {/* Sub-header navigation with Apple Segmented Control */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.08]">
        <div className="segmented-control">
          <button type="button" onClick={() => setActiveTab('requirements')} aria-pressed={activeTab === 'requirements'}
            className={`segmented-item ${activeTab === 'requirements' ? 'segmented-item-active' : ''}`}>
            <FileText size={14} />
            <span><span className="hidden sm:inline">Phase 1: </span>Requirements</span>
          </button>
          <button type="button" onClick={() => setActiveTab('design')} aria-pressed={activeTab === 'design'}
            className={`segmented-item ${activeTab === 'design' ? 'segmented-item-active' : ''}`}>
            <Cpu size={14} />
            <span><span className="hidden sm:inline">Phase 2: Technical </span>Design</span>
          </button>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-[12px] text-faint dark:bg-white/[0.06] dark:text-[#8e8e93]">
          <MessageSquare size={13} className="text-accent" />
          <span className="tabnum font-mono font-semibold text-ink dark:text-[#f5f5f7]">{comments.length}</span> review notes
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="card min-w-0 p-4 shadow-card sm:p-6">
          {activeTab === 'requirements' && <RequirementsPanel run={run} reqText={reqText} />}
          {activeTab === 'design' && (
            <DesignPanel run={run} design={design} filesToCreate={filesToCreate} filesToModify={filesToModify} filesSource={filesSource} />
          )}
        </div>

        {/* Phase Review Comments Sidebar */}
        <div className="flex min-w-0 flex-col gap-4">
          <ReviewNotes
            key={activeTab}
            phase={activeTab}
            comments={comments}
            currentUser={currentUser}
            onPost={postNote}
            onDeleteComment={onDeleteComment}
          />
        </div>
      </div>
    </div>
  )
}
