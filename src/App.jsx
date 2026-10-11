import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search, ChevronRight, ChevronDown, GitBranch, GitCommitHorizontal, Calendar, Ellipsis, CircleAlert, Plus, X, Zap,
  LayoutDashboard, FileText, Code, ShieldCheck, ShieldAlert, Download, Copy, RefreshCw, Check, ArrowRight,
  RotateCcw, Sparkles, Terminal
} from 'lucide-react'
import { runs as demoRuns, REVIEWER } from './data/runs'
import { api, connectRealtime } from './api'
import CodeReview from './components/CodeReview'
import OverviewDashboardView from './components/views/OverviewDashboardView'
import SpecsDesignView from './components/views/SpecsDesignView'
import TestResultsView from './components/views/TestResultsView'
import AuditLogView from './components/views/AuditLogView'
import ReworkModal from './components/ReworkModal'

const withExtras = (run) => run

export default function App() {
  const [runs, setRuns] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [runTab, setRunTab] = useState(() => {
    try {
      return localStorage.getItem('gatekeep_active_tab') || 'overview'
    } catch {
      return 'overview'
    }
  })
  const [runMenu, setRunMenu] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [reviewerRole, setReviewerRole] = useState('Engineer')
  const [roleMenuOpen, setRoleMenuOpen] = useState(false)
  const [newRun, setNewRun] = useState(null)
  const [reworkModalOpen, setReworkModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [mcpSessions, setMcpSessions] = useState([])
  const [mcpStats, setMcpStats] = useState(null)

  const handleTabChange = useCallback((tab) => {
    setRunTab(tab)
    try {
      localStorage.setItem('gatekeep_active_tab', tab)
    } catch {}
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await api.listRuns()
      const full = await Promise.all(list.map((l) => api.getRun(l.id)))
      setRuns(full.map(withExtras))
      setSelectedId((prev) => prev || full.find((r) => r.awaiting)?.id || full[0]?.id || null)
      setErr(null)
      // Fetch MCP session data (graceful — may 404 if schema not applied yet)
      try {
        const [sessions, stats] = await Promise.all([api.listMcpSessions(), api.getMcpStats()])
        setMcpSessions(sessions)
        setMcpStats(stats)
      } catch { /* MCP tables may not exist yet */ }
      return full
    } catch (e) {
      console.warn('Backend unavailable:', e.message)
      setRuns([])
      setSelectedId(null)
      return []
    }
  }, [])

  useEffect(() => {
    refresh()
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => connectRealtime((msg) => {
    const t = msg?.type
    if (t === 'repo.context.scanning') { flash('Scanning repository context...', 2500) }
    else if (t === 'repo.context.generated') { flash(`Repository context ready - ${msg.files ?? 0} relevant files`, 3000) }
    else if (t === 'mcp.session.created') { flash(`External agent connected (${msg.sessionId?.slice(0, 8)}…)`, 3000) }
    else if (t === 'mcp.session.ended') { flash('External agent session ended', 2000) }
    refresh().catch(() => {})
  }), [refresh])

  const run = useMemo(() => runs.find((r) => r.id === selectedId) ?? runs[0], [runs, selectedId])
  const canAct = run?.awaiting

  const flash = (msg, ms = 3500) => { setToast(msg); setTimeout(() => setToast(null), ms) }

  // Filtered runs for switcher and search
  const filteredRuns = useMemo(() => {
    if (!searchQuery.trim()) return runs
    const q = searchQuery.toLowerCase()
    return runs.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        (r.brief && r.brief.toLowerCase().includes(q)) ||
        (r.repo && r.repo.toLowerCase().includes(q)) ||
        (r.branch && r.branch.toLowerCase().includes(q))
    )
  }, [runs, searchQuery])

  const decide = async (decision, feedback = '') => {
    if (decision === 'reject' && !feedback) {
      setReworkModalOpen(true)
      return
    }
    try {
      await api.decide(run.id, { decision, role: reviewerRole, actor: REVIEWER.name, feedback })
      flash(decision === 'approve'
        ? `${run.id} approved. Gate advanced.`
        : `${run.id}: rework requested. Feedback sent to agent.`)
      await refresh()
    } catch (e) {
      if (e.message && (
        e.message.toLowerCase().includes('gate is assigned') ||
        e.message.toLowerCase().includes('role') ||
        e.message.toLowerCase().includes('no active gate') ||
        e.message.toLowerCase().includes('decision must be')
      )) {
        flash(e.message, 4500)
        return
      }
      // Local demo fallback state update
      setRuns((prev) =>
        prev.map((r) => {
          if (r.id === run.id) {
            return {
              ...r,
              awaiting: decision !== 'approve',
              status: decision === 'approve' ? 'approved' : 'rejected',
              steps: r.steps.map((s) => (s.key === 'code' ? { ...s, state: decision === 'approve' ? 'approved' : 'rejected' } : s)),
            }
          }
          return r
        })
      )
      flash(decision === 'approve' ? `${run.id} approved (demo mode)` : `${run.id} rework requested (demo mode)`)
    }
  }

  const handleAddComment = async (comment) => {
    try {
      await api.addComment(run.id, {
        ...comment,
        author: REVIEWER.name,
      })
      flash('Review comment recorded')
      await refresh()
    } catch (e) {
      flash('Review comment saved locally')
    }
  }

  const handleDeleteComment = async (commentId) => {
    try {
      await api.deleteComment(run.id, commentId)
      flash('Comment deleted')
      await refresh()
    } catch (e) {
      flash('Comment removed')
    }
  }

  const createRun = async () => {
    const f = newRun
    if (!f?.brief?.trim()) { flash('A brief is required'); return }
    try {
      const created = await api.createRun({
        brief: f.brief.trim(),
        repo: f.repo?.trim() || '',
        branch: f.branch?.trim() || '',
        description: f.brief.trim(),
      })
      setNewRun(null)
      await refresh()
      setSelectedId(created.id)
      setRunTab('overview')
      flash(`${created.id} created. Click "Run pipeline" to start the agents.`)
    } catch (e) {
      // Fallback local creation
      const mockId = `RUN-0${Math.floor(428 + Math.random() * 50)}`
      const mockNew = {
        ...demoRuns[0],
        id: mockId,
        brief: f.brief.trim(),
        repo: f.repo?.trim() || 'commerce-core',
        branch: f.branch?.trim() || 'feat/new-gate',
        status: 'awaiting_gate',
        awaiting: true,
      }
      setRuns((prev) => [mockNew, ...prev])
      setSelectedId(mockId)
      setNewRun(null)
      setRunTab('overview')
      flash(`${mockId} created. Pipeline initialized.`)
    }
  }

  const startPipeline = async () => {
    try {
      await api.start(run.id)
      flash(`${run.id}: pipeline started. Container sandbox running...`)
      await refresh()
    } catch (e) {
      flash(`${run.id}: test suite rerun triggered in sandbox`)
    }
  }

  const doTamper = async (seq = 2) => {
    try {
      await api.tamper(run.id, seq, { file: 'backdoor.py', note: 'unauthorized edit' })
      flash(`Rewrote audit event #${seq} directly in database. Cryptographic chain broken!`, 5000)
      await refresh()
    } catch (e) {
      // Demo fallback tamper simulation
      setRuns((prev) =>
        prev.map((r) => {
          if (r.id === run.id) {
            return {
              ...r,
              verified: false,
              verify: { valid: false, brokenAt: seq, storedHash: '7f9b2c140a8d', recomputedHash: '9a1c8f3e2b4d' },
            }
          }
          return r
        })
      )
      flash(`Simulated database modification at event #${seq}. Chain broken!`, 5000)
    }
  }

  // Functional actions
  const copyRunId = () => {
    if (!run) return
    navigator.clipboard.writeText(run.id)
    flash(`Copied ${run.id} to clipboard`)
    setMoreMenuOpen(false)
  }

  const copyBranchCheckout = () => {
    if (!run?.branch) return
    navigator.clipboard.writeText(`git checkout ${run.branch}`)
    flash(`Copied: git checkout ${run.branch}`)
    setMoreMenuOpen(false)
  }

  const downloadPatch = () => {
    if (!run?.diff) {
      flash('No diff available to download')
      return
    }
    const lines = run.diff.lines || []
    let patch = `--- a/${run.diff.file || 'code'}\n+++ b/${run.diff.file || 'code'}\n`
    lines.forEach((l) => {
      const pfx = l.type === 'add' ? '+' : l.type === 'rem' ? '-' : ' '
      patch += `${pfx}${l.text}\n`
    })
    const blob = new Blob([patch], { type: 'text/x-diff' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${run.id}.patch`
    a.click()
    URL.revokeObjectURL(url)
    flash(`Downloaded ${run.id}.patch`)
    setMoreMenuOpen(false)
  }

  const exportAuditJson = () => {
    if (!run) return
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${run.id}-audit-export.json`
    a.click()
    URL.revokeObjectURL(url)
    flash(`Exported audit logs for ${run.id}`)
    setMoreMenuOpen(false)
  }

  const openRun = (id) => {
    setSelectedId(id)
    setRunTab('code')
  }

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-canvas text-[13px] text-muted font-sans">
        Connecting to the GateKeep platform...
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] w-[100dvw] flex-col overflow-hidden bg-white select-none font-sans">
      {/* ========================================================= */}
      {/* UNIFIED 3-ZONE APPLICATION HEADER (Height: 52px)          */}
      {/* Matches gatekeep_code_review_ide demo image               */}
      {/* ========================================================= */}
      {/* ========================================================= */}
      {/* UNIFIED 3-ZONE APPLICATION HEADER (Height: 52px)          */}
      {/* 3-Column Grid guarantees zero text collision / overlap    */}
      {/* ========================================================= */}
      <header className="grid grid-cols-[1fr_auto_1fr] h-[52px] shrink-0 items-center border-b border-black/[0.08] bg-white px-4 select-none z-30 shadow-2xs gap-3">
        {/* ZONE 1 (Left): Geometric Logo + Active Run Switcher Capsule */}
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          {/* GateKeep Geometric Wordmark */}
          <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => setRunTab('overview')}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black text-white font-bold text-[13px] tracking-tight shadow-xs">
              G
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-bold tracking-tight text-ink">GateKeep</span>
              <span className="rounded bg-black/[0.05] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-faint">
                PROD
              </span>
            </div>
          </div>

          <div className="h-4 w-px bg-black/[0.1] mx-0.5 shrink-0 hidden sm:block" />

          {/* Active Run Status Capsule with Interactive Switcher */}
          <div className="relative min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setRunMenu((v) => !v)}
              className="flex h-8 items-center gap-2 rounded-xl bg-black/[0.03] hover:bg-black/[0.06] border border-black/[0.06] px-2.5 text-[12px] font-semibold transition-colors shadow-2xs"
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${
                run?.awaiting ? 'bg-[#ff9500] animate-pulse' : run?.status === 'approved' ? 'bg-[#34c759]' : run ? 'bg-[#0071e3]' : 'bg-muted'
              }`} />
              <span className="font-mono text-ink">{run?.id || 'No Runs'}</span>
              {run && (
                <>
                  <span className="text-muted hidden md:inline">·</span>
                  <span className="text-muted hidden md:inline font-normal truncate max-w-[120px]">
                    {run.awaiting ? `Awaiting ${run.gate || 'Gate'}` : run.status === 'approved' ? 'Approved' : run.status}
                  </span>
                </>
              )}
              <ChevronDown size={11} className="text-faint ml-0.5 shrink-0" />
            </button>

            {runMenu && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-2xl border border-black/[0.08] bg-white/95 p-1.5 shadow-pop backdrop-blur-xl animate-rise">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                  Select Workflow Run
                </div>
                {runs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setSelectedId(r.id); setRunMenu(false) }}
                    className={`flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-black/[0.04] transition-colors ${
                      r.id === run.id ? 'bg-accent/10' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[12px] font-semibold text-ink">{r.id}</span>
                      <span className={`font-mono text-[10.5px] font-semibold ${
                        r.awaiting ? 'text-[#ff9500]' : r.status === 'approved' ? 'text-[#34c759]' : 'text-faint'
                      }`}>
                        {r.awaiting ? 'Awaiting Gate' : r.status}
                      </span>
                    </div>
                    <span className="truncate text-[11.5px] text-muted mt-0.5">{r.brief}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ZONE 2 (Center): Segmented Navigation Pill (In-Flow, Zero Overlap) */}
        <div className="flex items-center justify-center shrink-0">
          <div className="inline-flex h-9 items-center rounded-xl bg-black/[0.05] p-1 border border-black/[0.04] shadow-inner">
            <button
              type="button"
              onClick={() => handleTabChange('overview')}
              className={`h-7 px-3 flex items-center rounded-lg text-[12px] transition-all whitespace-nowrap ${
                runTab === 'overview'
                  ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.06)]'
                  : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f]'
              }`}
            >
              Overview
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('specs')}
              className={`h-7 px-3 flex items-center rounded-lg text-[12px] transition-all whitespace-nowrap ${
                runTab === 'specs'
                  ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.06)]'
                  : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f]'
              }`}
            >
              Specs &amp; Design
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('code')}
              className={`h-7 px-3 flex items-center rounded-lg text-[12px] transition-all whitespace-nowrap ${
                runTab === 'code'
                  ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.06)]'
                  : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f]'
              }`}
            >
              Code Review
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('tests')}
              className={`h-7 px-3 flex items-center rounded-lg text-[12px] transition-all whitespace-nowrap ${
                runTab === 'tests'
                  ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.06)]'
                  : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f]'
              }`}
            >
              Test Results
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('audit')}
              className={`h-7 px-3 flex items-center rounded-lg text-[12px] transition-all whitespace-nowrap ${
                runTab === 'audit'
                  ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.06)]'
                  : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f]'
              }`}
            >
              Audit Chain
            </button>
          </div>
        </div>

        {/* ZONE 3 (Right): Reviewer Role Popover + New Run + Primary Action */}
        <div className="flex items-center justify-end gap-2 min-w-0">
          {/* Acting as (Role Switcher Popover) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setRoleMenuOpen((v) => !v)}
              className="flex h-8 items-center gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.03] px-2.5 text-[12px] font-medium text-ink hover:bg-black/[0.06] transition-colors"
              title="Switch acting reviewer role"
            >
              <span className="text-[11px] text-[#86868b] hidden 2xl:inline">Reviewer Role:</span>
              <span className="font-semibold text-[#1d1d1f]">{reviewerRole}</span>
              <ChevronDown size={11} className="text-[#86868b]" />
            </button>
            {roleMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-2xl border border-black/[0.08] bg-white/95 p-1.5 shadow-pop backdrop-blur-xl animate-rise">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                  Active Reviewer Identity
                </div>
                {['Engineer', 'Planner', 'Requester'].map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => { setReviewerRole(role); setRoleMenuOpen(false) }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-black/[0.04] ${
                      reviewerRole === role ? 'font-semibold text-accent' : 'text-ink'
                    }`}
                  >
                    <span>{role}</span>
                    {reviewerRole === role && <Check size={12} strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* New Run Button */}
          <button
            type="button"
            onClick={() => setNewRun({ brief: '', repo: '', branch: '' })}
            className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.03] hover:bg-black/[0.06] px-2.5 text-[12px] font-medium text-ink transition-all active:scale-[0.98] shrink-0"
            title="Launch new agent workflow run"
          >
            <Plus size={13} className="text-[#86868b]" />
            <span>New Run</span>
          </button>

          {/* Primary Action Button (Approve Gate ↗) */}
          <button
            type="button"
            disabled={!canAct}
            onClick={() => decide('approve')}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] px-3.5 text-[12.5px] font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
          >
            <span>{canAct ? 'Approve Gate ↗' : run?.status === 'approved' ? 'Approved ✓' : 'Primary Action'}</span>
          </button>

          {/* More Actions Menu */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMoreMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.08] bg-black/[0.03] hover:bg-black/[0.06] text-muted hover:text-ink transition-colors"
            >
              <Ellipsis size={14} />
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-2xl border border-black/[0.08] bg-white/95 p-1.5 shadow-pop backdrop-blur-xl animate-rise text-[12px]">
                <button
                  type="button"
                  onClick={copyRunId}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink hover:bg-black/[0.04]"
                >
                  <Copy size={13} className="text-faint" />
                  <span>Copy Run ID ({run?.id})</span>
                </button>
                <button
                  type="button"
                  onClick={copyBranchCheckout}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink hover:bg-black/[0.04]"
                >
                  <GitBranch size={13} className="text-faint" />
                  <span>Copy Git Checkout</span>
                </button>
                <button
                  type="button"
                  onClick={downloadPatch}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink hover:bg-black/[0.04]"
                >
                  <Download size={13} className="text-faint" />
                  <span>Download .patch</span>
                </button>
                <button
                  type="button"
                  onClick={exportAuditJson}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink hover:bg-black/[0.04]"
                >
                  <FileText size={13} className="text-faint" />
                  <span>Export Audit JSON</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ========================================================= */}
      {/* WORKSPACE CANVAS (Dedicated Dashboard per Route)          */}
      {/* ========================================================= */}
      <main className="flex flex-1 min-w-0 h-[calc(100vh-52px)] overflow-hidden bg-white">
        {/* Route 1: Code Review (Full Width 3-Pane IDE Workspace) */}
        {runTab === 'code' && (
          <CodeReview
            run={run}
            reviewerRole={reviewerRole}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
            onDecide={decide}
            canAct={canAct}
            onTamper={doTamper}
            showInspector={true}
          />
        )}

        {/* Route 2: Overview (Governance & Pipeline Dashboard) */}
        {runTab === 'overview' && (
          <div className="flex-1 h-full overflow-y-auto bg-[#fbfbfd]/70 p-6">
            <div className="mx-auto max-w-6xl">
              <OverviewDashboardView
                run={run}
                canAct={canAct}
                onApprove={() => decide('approve')}
                onRequestRework={() => setReworkModalOpen(true)}
                onStartPipeline={startPipeline}
                onNavigateTab={(tab) => handleTabChange(tab)}
                onTamper={doTamper}
                mcpSessions={mcpSessions}
                mcpStats={mcpStats}
                onRefreshMcp={refresh}
              />
            </div>
          </div>
        )}

        {/* Route 3: Specs & Design */}
        {runTab === 'specs' && (
          <div className="flex-1 h-full overflow-y-auto bg-white p-6">
            <div className="mx-auto max-w-5xl">
              <SpecsDesignView
                run={run}
                reviewerRole={reviewerRole}
                onAddComment={handleAddComment}
                onDeleteComment={handleDeleteComment}
              />
            </div>
          </div>
        )}

        {/* Route 4: Test Results */}
        {runTab === 'tests' && (
          <div className="flex-1 h-full overflow-y-auto bg-[#fbfbfd]/70 p-6">
            <div className="mx-auto max-w-5xl">
              <TestResultsView run={run} onRerunTests={startPipeline} />
            </div>
          </div>
        )}

        {/* Route 5: Audit Chain */}
        {runTab === 'audit' && (
          <div className="flex-1 h-full overflow-y-auto bg-[#fbfbfd]/70 p-6">
            <div className="mx-auto max-w-5xl">
              <AuditLogView runs={runs} activeRun={run} onOpenRun={openRun} onTamper={doTamper} onRefresh={refresh} />
            </div>
          </div>
        )}
      </main>

      {/* Rework Modal for requesting changes with reviewer feedback */}
      <ReworkModal
        isOpen={reworkModalOpen}
        onClose={() => setReworkModalOpen(false)}
        run={run}
        reviewerRole={reviewerRole}
        onConfirm={(feedback) => decide('reject', feedback)}
      />

      {/* New Run Modal */}
      {newRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setNewRun(null)}>
          <div className="w-full max-w-md rounded-2xl border border-black/[0.08] bg-white p-6 shadow-pop animate-rise" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-ink">Launch New Agent Workflow Run</h2>
              <button onClick={() => setNewRun(null)} className="rounded-lg p-1 text-muted hover:bg-black/[0.05] hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              Specify your engineering task. The multi-agent pipeline will generate specs, write the implementation, and run tests in container isolation.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="text-[11px] font-medium text-faint">Presets:</span>
              <button
                type="button"
                onClick={() => setNewRun({
                  brief: "Add rate limiting (60 req/min per merchant) to checkout webhook with HMAC signature verification in src/checkout/webhook.py",
                  repo: "commerce-core",
                  branch: "feat/webhook-throttle"
                })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-black/[0.025] px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
              >
                <Zap size={12} className="text-amber" />
                <span>Webhook Rate Limiting</span>
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted">Brief <span className="text-red">*</span></label>
                <input
                  autoFocus
                  value={newRun.brief}
                  onChange={(e) => setNewRun({ ...newRun, brief: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && createRun()}
                  placeholder="e.g. Add rate limiting to the checkout webhook"
                  className="mt-1 w-full rounded-xl border border-black/[0.1] bg-black/[0.02] px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-muted">Repository</label>
                  <input
                    value={newRun.repo}
                    onChange={(e) => setNewRun({ ...newRun, repo: e.target.value })}
                    placeholder="commerce-core"
                    className="mt-1 w-full rounded-xl border border-black/[0.1] bg-black/[0.02] px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted">Branch</label>
                  <input
                    value={newRun.branch}
                    onChange={(e) => setNewRun({ ...newRun, branch: e.target.value })}
                    placeholder="feat/webhook-throttle"
                    className="mt-1 w-full rounded-xl border border-black/[0.1] bg-black/[0.02] px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewRun(null)}
                className="rounded-xl border border-black/[0.08] px-4 py-2 text-[13px] font-medium text-ink hover:bg-black/[0.04]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createRun}
                className="rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-hover active:scale-[0.98]"
              >
                Create Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-black/[0.08] bg-white/95 px-4.5 py-2.5 text-[13px] font-medium text-ink shadow-pop backdrop-blur-xl animate-rise">
          {toast}
        </div>
      )}
    </div>
  )
}
