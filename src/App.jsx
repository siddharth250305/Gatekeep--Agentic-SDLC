import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search, ChevronRight, ChevronDown, GitBranch, GitCommitHorizontal, Calendar, Ellipsis, CircleAlert, Plus, X, Zap,
  LayoutDashboard, FileText, Code, ShieldCheck, ShieldAlert, Download, Copy, RefreshCw, Check, ArrowRight,
  RotateCcw, Sparkles, Terminal, Sun, Moon
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

const NAV_TABS = [
  { key: 'overview', label: 'Overview', title: 'Overview Dashboard', Icon: LayoutDashboard },
  { key: 'specs', label: 'Specs & Design', title: 'Specs & Design Review', Icon: FileText },
  { key: 'code', label: 'Code Review', title: 'Code Review IDE', Icon: Code },
  { key: 'tests', label: 'Test Results', title: 'Test Results & Sandbox', Icon: ShieldCheck },
  { key: 'audit', label: 'Audit Chain', title: 'Cryptographic Audit Chain', Icon: Terminal },
]

// Segmented tab control. `full` stretches it across the mobile sub-bar with visible labels.
function NavTabs({ active, onChange, full = false }) {
  return (
    <div className={`${full ? 'flex w-full' : 'inline-flex'} h-9 items-center rounded-xl bg-black/[0.05] dark:bg-white/[0.06] p-1 border border-black/[0.04] dark:border-white/[0.08] shadow-inner gap-0.5`}>
      {NAV_TABS.map(({ key, label, title, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={title}
          aria-label={title}
          aria-current={active === key ? 'page' : undefined}
          className={`h-7 ${full ? 'flex-1 justify-center px-1' : 'px-2.5 sm:px-3'} flex items-center gap-1.5 rounded-lg text-[12px] transition-all whitespace-nowrap cursor-pointer ${
            active === key
              ? 'bg-white dark:bg-[#252529] font-semibold text-[#1d1d1f] dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
              : 'text-muted dark:text-[#a1a1aa] font-medium hover:text-[#1d1d1f] dark:hover:text-white hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
          }`}
        >
          <Icon size={13} className={`shrink-0 ${active === key ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'}`} />
          <span className={full ? 'hidden min-[420px]:inline truncate text-[11px]' : 'hidden xl:inline'}>{label}</span>
        </button>
      ))}
    </div>
  )
}

// Status bar pinned under the workspace: platform health on the left, run context on the right.
function AppFooter({ apiOnline, runs, run, activeAgents, isDarkMode, onToggleTheme }) {
  const awaiting = runs.filter((r) => r.awaiting).length
  const chainOk = run?.verified !== false
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0b0b0d] px-3 sm:px-4 font-mono text-[10.5px] text-muted dark:text-[#a1a1aa] select-none">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1.5 shrink-0" title={apiOnline ? 'GateKeep API reachable' : 'GateKeep API unreachable'}>
          <span className={`h-1.5 w-1.5 rounded-full ${apiOnline ? 'bg-[#34c759]' : 'bg-[#ff3b30]'}`} />
          <span className={apiOnline ? '' : 'text-red'}>{apiOnline ? 'API connected' : 'API offline'}</span>
        </span>
        <span className="hidden sm:inline text-faint dark:text-[#8e8e93]">·</span>
        <span className="hidden sm:inline shrink-0 tabnum">
          {runs.length} {runs.length === 1 ? 'run' : 'runs'}
          {awaiting > 0 && <span className="text-[#8f4700] dark:text-[#ff9f0a]"> · {awaiting} awaiting</span>}
        </span>
        <span className="hidden md:inline text-faint dark:text-[#8e8e93]">·</span>
        <span className="hidden md:inline shrink-0 tabnum">{activeAgents} active {activeAgents === 1 ? 'agent' : 'agents'}</span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {run && (
          <span
            className={`hidden min-[480px]:flex items-center gap-1 shrink-0 ${chainOk ? 'text-[#17692e] dark:text-[#34c759]' : 'text-red'}`}
            title={`Audit chain for ${run.id}`}
          >
            {chainOk ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
            <span>{chainOk ? 'Chain verified' : 'Chain broken'}</span>
          </span>
        )}
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex items-center gap-1 rounded px-1 text-muted dark:text-[#a1a1aa] hover:text-ink dark:hover:text-white transition-colors cursor-pointer"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDarkMode ? <Moon size={11} /> : <Sun size={11} />}
          <span>{isDarkMode ? 'Dark' : 'Light'}</span>
        </button>
        <span className="hidden sm:inline text-faint dark:text-[#8e8e93]">GateKeep v0.1.0</span>
      </div>
    </footer>
  )
}

export default function App() {
  const [runs, setRuns] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [runTab, setRunTab] = useState(() => {
    try {
      const urlTab = new URLSearchParams(window.location.search).get('tab')
      if (['overview', 'specs', 'code', 'tests', 'audit'].includes(urlTab)) return urlTab
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
  const [apiOnline, setApiOnline] = useState(true)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      if (typeof document !== 'undefined') {
        const saved = localStorage.getItem('gatekeep_theme')
        if (saved === 'dark') return true
        if (saved === 'light') return false
        if (document.documentElement.classList.contains('dark')) return true
      }
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      if (isDarkMode) {
        document.documentElement.classList.add('dark')
        document.body.classList.add('dark')
        document.documentElement.style.colorScheme = 'dark'
      } else {
        document.documentElement.classList.remove('dark')
        document.body.classList.remove('dark')
        document.documentElement.style.colorScheme = 'light'
      }
    } catch {}
  }, [isDarkMode])

  useEffect(() => {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = (e) => {
        const saved = localStorage.getItem('gatekeep_theme')
        if (!saved) {
          setIsDarkMode(e.matches)
        }
      }
      if (media?.addEventListener) {
        media.addEventListener('change', listener)
        return () => media.removeEventListener('change', listener)
      }
    } catch {}
  }, [])

  // Persist only on an explicit choice; until then the app follows the OS setting.
  const toggleTheme = () => setIsDarkMode((prev) => {
    try { localStorage.setItem('gatekeep_theme', prev ? 'light' : 'dark') } catch {}
    return !prev
  })

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
      setSelectedId((prev) => {
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const urlRunId = urlParams?.get('run')
        if (urlRunId && full.some((r) => r.id === urlRunId)) return urlRunId
        if (prev && full.some((r) => r.id === prev)) return prev
        return full.find((r) => r.awaiting)?.id || full[0]?.id || null
      })
      setErr(null)
      setApiOnline(true)
      // Fetch MCP session data (graceful — may 404 if schema not applied yet)
      try {
        const [sessions, stats] = await Promise.all([api.listMcpSessions(), api.getMcpStats()])
        setMcpSessions(sessions)
        setMcpStats(stats)
      } catch { /* MCP tables may not exist yet */ }
      return full
    } catch (e) {
      console.warn('Backend unavailable:', e.message)
      setApiOnline(false)
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
    <div className="flex h-[100dvh] w-[100dvw] flex-col overflow-hidden bg-canvas select-none font-sans transition-colors duration-150">
      {/* ========================================================= */}
      {/* UNIFIED 3-ZONE APPLICATION HEADER (Height: 52px)          */}
      {/* 3-Column Grid guarantees zero text collision / overlap    */}
      {/* ========================================================= */}
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0b0b0d] px-3 sm:px-4 select-none z-30 shadow-2xs gap-2 sm:gap-4">
        {/* ZONE 1 (Left): Geometric Logo + Active Run Switcher Capsule */}
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0">
          {/* GateKeep Geometric Wordmark */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer" onClick={() => setRunTab('overview')}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black text-white dark:bg-white dark:text-black font-bold text-[13px] tracking-tight shadow-xs">
              G
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[14px] font-bold tracking-tight text-ink dark:text-[#f5f5f7] hidden sm:inline">GateKeep</span>
              <span className="rounded bg-black/[0.05] dark:bg-white/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-faint dark:text-[#a1a1aa] hidden lg:inline">
                PROD
              </span>
            </div>
          </div>

          <div className="h-4 w-px bg-black/[0.1] dark:bg-white/[0.12] mx-0.5 shrink-0 hidden md:block" />

          {/* Active Run Status Capsule with Interactive Switcher */}
          <div className="relative min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setRunMenu((v) => !v)}
              className="flex h-8 items-center gap-1.5 sm:gap-2 rounded-xl bg-black/[0.03] hover:bg-black/[0.06] border border-black/[0.06] dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:border-white/[0.12] px-2 sm:px-2.5 text-[12px] font-semibold text-ink dark:text-[#f5f5f7] transition-colors shadow-2xs cursor-pointer"
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${
                run?.awaiting ? 'bg-[#ff9500] animate-pulse' : run?.status === 'approved' ? 'bg-[#34c759]' : run ? 'bg-[#0071e3]' : 'bg-muted'
              }`} />
              <span className="font-mono text-ink dark:text-[#f5f5f7] text-[11.5px] sm:text-[12px] max-w-[90px] sm:max-w-[150px] truncate">{run?.id || 'No Runs'}</span>
              {run && (
                <>
                  <span className="text-muted dark:text-[#8e8e93] hidden 2xl:inline">·</span>
                  <span className="text-muted dark:text-[#a1a1aa] hidden 2xl:inline font-normal truncate max-w-[130px]">
                    {run.awaiting ? `Awaiting ${run.gate || 'Gate'}` : run.status === 'approved' ? 'Approved' : run.status}
                  </span>
                </>
              )}
              <ChevronDown size={11} className="text-faint dark:text-[#a1a1aa] ml-0.5 shrink-0" />
            </button>

            {runMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setRunMenu(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white/95 dark:bg-[#18181b]/95 p-1.5 shadow-pop backdrop-blur-xl animate-rise">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#a1a1aa]">
                    Select Workflow Run
                  </div>
                  {runs.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => { setSelectedId(r.id); setRunMenu(false) }}
                      className={`flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors cursor-pointer ${
                        r.id === run?.id ? 'bg-accent/10 dark:bg-accent/20' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[12px] font-semibold text-ink dark:text-white">{r.id}</span>
                        <span className={`font-mono text-[10.5px] font-semibold ${
                          r.awaiting ? 'text-[#ff9500] dark:text-[#ff9f0a]' : r.status === 'approved' ? 'text-[#34c759]' : 'text-faint dark:text-[#8e8e93]'
                        }`}>
                          {r.awaiting ? 'Awaiting Gate' : r.status}
                        </span>
                      </div>
                      <span className="truncate text-[11.5px] text-muted dark:text-[#a1a1aa] mt-0.5">{r.brief}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ZONE 2 (Center): Segmented Navigation Pill (In-Flow, Zero Overlap). Phones use the sub-bar below. */}
        <div className="hidden md:flex items-center justify-center shrink-0">
          <NavTabs active={runTab} onChange={handleTabChange} />
        </div>

        {/* ZONE 3 (Right): Reviewer Role Popover + New Run + Primary Action */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 min-w-0 shrink-0">
          {/* Acting as (Role Switcher Popover) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setRoleMenuOpen((v) => !v)}
              className="flex h-8 items-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] px-2 sm:px-2.5 text-[12px] font-medium text-ink dark:text-[#f5f5f7] transition-colors cursor-pointer"
              title={`Reviewer role: ${reviewerRole} (click to switch)`}
            >
              <span className="text-[11px] text-faint dark:text-[#a1a1aa] hidden lg:inline xl:hidden 2xl:inline">Reviewer Role:</span>
              <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{reviewerRole}</span>
              <ChevronDown size={11} className="text-faint dark:text-[#a1a1aa] hidden sm:block" />
            </button>
            {roleMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setRoleMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white/95 dark:bg-[#18181b]/95 p-1.5 shadow-pop backdrop-blur-xl animate-rise">
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint dark:text-[#a1a1aa]">
                    Active Reviewer Identity
                  </div>
                  {['Engineer', 'Planner', 'Requester'].map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => { setReviewerRole(role); setRoleMenuOpen(false) }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer ${
                        reviewerRole === role ? 'font-semibold text-accent dark:text-[#4da3ff]' : 'text-ink dark:text-[#f5f5f7]'
                      }`}
                    >
                      <span>{role}</span>
                      {reviewerRole === role && <Check size={12} strokeWidth={2.5} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* New Run Button */}
          <button
            type="button"
            onClick={() => setNewRun({ brief: '', repo: '', branch: '' })}
            className="hidden sm:inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] px-2 lg:px-2.5 xl:px-2 2xl:px-2.5 text-[12px] font-medium text-ink dark:text-[#f5f5f7] transition-all active:scale-[0.98] shrink-0 cursor-pointer"
            title="Launch new agent workflow run"
            aria-label="New run"
          >
            <Plus size={13} className="text-faint dark:text-[#a1a1aa]" />
            <span className="hidden lg:inline xl:hidden 2xl:inline">New Run</span>
          </button>

          {/* Primary Action Button (Approve Gate ↗) */}
          <button
            type="button"
            disabled={!canAct}
            onClick={() => decide('approve')}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] px-2.5 sm:px-3.5 text-[12.5px] font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shrink-0 whitespace-nowrap cursor-pointer"
            title={canAct ? 'Approve the current gate' : run?.status === 'approved' ? 'This run is approved' : 'Nothing to approve right now'}
          >
            <Check size={14} strokeWidth={2.5} className="min-[360px]:hidden" aria-hidden="true" />
            <span className="sr-only min-[360px]:not-sr-only lg:hidden">{run?.status === 'approved' && !canAct ? 'Approved' : 'Approve'}</span>
            <span className="hidden lg:inline">{canAct ? 'Approve Gate ↗' : run?.status === 'approved' ? 'Approved ✓' : 'Approve Gate'}</span>
          </button>

          {/* Dark / Light Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-muted dark:text-[#a1a1aa] hover:text-ink dark:hover:text-white transition-colors cursor-pointer shrink-0"
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle Dark / Light Theme"
          >
            <span
              className={`flex items-center justify-center transition-transform duration-200 ease-out ${isDarkMode ? 'rotate-[360deg]' : 'rotate-0'}`}
              aria-hidden="true"
            >
              {isDarkMode ? (
                <Sun size={14} className="text-[#ff9500]" />
              ) : (
                <Moon size={14} className="text-muted" />
              )}
            </span>
          </button>

          {/* More Actions Menu */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMoreMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-muted dark:text-[#a1a1aa] hover:text-ink dark:hover:text-white transition-colors cursor-pointer"
              title="More actions"
              aria-label="More actions"
            >
              <Ellipsis size={14} />
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white/95 dark:bg-[#18181b]/95 p-1.5 shadow-pop backdrop-blur-xl animate-rise text-[12px]">
                <button
                  type="button"
                  onClick={() => { setNewRun({ brief: '', repo: '', branch: '' }); setMoreMenuOpen(false) }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] sm:hidden cursor-pointer"
                >
                  <Plus size={13} className="text-faint dark:text-[#a1a1aa]" />
                  <span>New Run</span>
                </button>
                <button
                  type="button"
                  onClick={copyRunId}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <Copy size={13} className="text-faint dark:text-[#a1a1aa]" />
                  <span>Copy Run ID ({run?.id})</span>
                </button>
                <button
                  type="button"
                  onClick={copyBranchCheckout}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <GitBranch size={13} className="text-faint dark:text-[#a1a1aa]" />
                  <span>Copy Git Checkout</span>
                </button>
                <button
                  type="button"
                  onClick={downloadPatch}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <Download size={13} className="text-faint dark:text-[#a1a1aa]" />
                  <span>Download .patch</span>
                </button>
                <button
                  type="button"
                  onClick={exportAuditJson}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <FileText size={13} className="text-faint dark:text-[#a1a1aa]" />
                  <span>Export Audit JSON</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Phone/tablet navigation sub-bar: the tabs move here so the header never collides. */}
      <nav className="md:hidden shrink-0 border-b border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-[#0b0b0d] px-3 py-1.5" aria-label="Run views">
        <NavTabs active={runTab} onChange={handleTabChange} full />
      </nav>

      {/* ========================================================= */}
      {/* WORKSPACE CANVAS (Dedicated Dashboard per Route)          */}
      {/* ========================================================= */}
      <main className="flex flex-1 min-w-0 min-h-0 overflow-hidden bg-canvas">
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
          <div className="flex-1 h-full overflow-y-auto bg-canvas p-6">
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
          <div className="flex-1 h-full overflow-y-auto bg-canvas p-6">
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
          <div className="flex-1 h-full overflow-y-auto bg-canvas p-6">
            <div className="mx-auto max-w-5xl">
              <TestResultsView run={run} onRerunTests={startPipeline} />
            </div>
          </div>
        )}

        {/* Route 5: Audit Chain */}
        {runTab === 'audit' && (
          <div className="flex-1 h-full overflow-y-auto bg-canvas p-6">
            <div className="mx-auto max-w-5xl">
              <AuditLogView runs={runs} activeRun={run} onOpenRun={openRun} onTamper={doTamper} onRefresh={refresh} />
            </div>
          </div>
        )}
      </main>

      <AppFooter
        apiOnline={apiOnline}
        runs={runs}
        run={run}
        activeAgents={mcpStats?.active_sessions ?? mcpSessions.filter((s) => s.status === 'active').length}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
      />

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4 backdrop-blur-sm" onClick={() => setNewRun(null)}>
          <div className="w-full max-w-md rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#18181b] p-6 shadow-pop animate-rise" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-ink dark:text-white">Launch New Agent Workflow Run</h2>
              <button onClick={() => setNewRun(null)} className="rounded-lg p-1 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-ink dark:hover:text-white cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-[13px] text-muted dark:text-[#a1a1aa]">
              Specify your engineering task. The multi-agent pipeline will generate specs, write the implementation, and run tests in container isolation.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="text-[11px] font-medium text-faint dark:text-[#8e8e93]">Presets:</span>
              <button
                type="button"
                onClick={() => setNewRun({
                  brief: "Add rate limiting (60 req/min per merchant) to checkout webhook with HMAC signature verification in src/checkout/webhook.py",
                  repo: "commerce-core",
                  branch: "feat/webhook-throttle"
                })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] dark:border-white/[0.1] bg-black/[0.025] dark:bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-ink dark:text-[#f5f5f7] transition-colors hover:border-accent hover:text-accent cursor-pointer"
              >
                <Zap size={12} className="text-amber" />
                <span>Webhook Rate Limiting</span>
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">Brief <span className="text-red">*</span></label>
                <input
                  autoFocus
                  value={newRun.brief}
                  onChange={(e) => setNewRun({ ...newRun, brief: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && createRun()}
                  placeholder="e.g. Add rate limiting to the checkout webhook"
                  className="mt-1 w-full rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2 text-[13px] text-ink dark:text-white outline-none focus:border-accent focus:bg-white dark:focus:bg-[#121214] focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">Repository</label>
                  <input
                    value={newRun.repo}
                    onChange={(e) => setNewRun({ ...newRun, repo: e.target.value })}
                    placeholder="commerce-core"
                    className="mt-1 w-full rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2 text-[13px] text-ink dark:text-white outline-none focus:border-accent focus:bg-white dark:focus:bg-[#121214] focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">Branch</label>
                  <input
                    value={newRun.branch}
                    onChange={(e) => setNewRun({ ...newRun, branch: e.target.value })}
                    placeholder="feat/webhook-throttle"
                    className="mt-1 w-full rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2 text-[13px] text-ink dark:text-white outline-none focus:border-accent focus:bg-white dark:focus:bg-[#121214] focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewRun(null)}
                className="rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] px-4 py-2 text-[13px] font-medium text-ink dark:text-[#f5f5f7] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createRun}
                className="rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-hover active:scale-[0.98] cursor-pointer"
              >
                Create Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white/95 dark:bg-[#1c1c1f]/95 px-4.5 py-2.5 text-[13px] font-medium text-ink dark:text-[#f5f5f7] shadow-pop backdrop-blur-xl animate-rise">
          {toast}
        </div>
      )}
    </div>
  )
}
