import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, connectRealtime, loadSession, onSessionExpired, setSession } from './api'
import LoginScreen from './components/LoginScreen'
import CodeReview from './components/CodeReview'
import OverviewDashboardView from './components/views/OverviewDashboardView'
import SpecsDesignView from './components/views/SpecsDesignView'
import TestResultsView from './components/views/TestResultsView'
import AuditLogView from './components/views/AuditLogView'
import ReworkModal from './components/ReworkModal'
import NewRunDialog from './components/NewRunDialog'
import GateBanner from './components/GateBanner'
import AppHeader from './components/layout/AppHeader'
import AppFooter from './components/layout/AppFooter'
import NavTabs, { NAV_TABS } from './components/layout/NavTabs'
import { useTheme } from './hooks/useTheme'
import { useDebouncedCallback } from './hooks/useDebouncedCallback'
import { useRunActions } from './hooks/useRunActions'


const TAB_KEYS = NAV_TABS.map((t) => t.key)

// Live events arrive in bursts (one per tool call); reload once per burst (F8).
const REFRESH_DEBOUNCE_MS = 250

function initialTab() {
  try {
    const urlTab = new URLSearchParams(window.location.search).get('tab')
    if (TAB_KEYS.includes(urlTab)) return urlTab
    return localStorage.getItem('gatekeep_active_tab') || 'overview'
  } catch {
    return 'overview'
  }
}

export default function App() {
  const [runs, setRuns] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [runTab, setRunTab] = useState(initialTab)
  // Which half of Specs & Design to open, set by the gate banner's review link.
  const [specsSection, setSpecsSection] = useState({ section: null, nonce: 0 })
  // Logged-in reviewer. Their role decides which gates they may approve; the
  // server checks it again on every decision.
  const [session, setSessionState] = useState(() => loadSession())
  const [loginNotice, setLoginNotice] = useState(null)
  const reviewerRole = session?.user?.role
  const [newRunOpen, setNewRunOpen] = useState(false)
  const [reworkOpen, setReworkOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mcpSessions, setMcpSessions] = useState([])
  const [mcpStats, setMcpStats] = useState(null)
  const [apiOnline, setApiOnline] = useState(true)
  // Demo-only tools (the audit tamper test) appear only when the API says demo mode is on.
  const [demoMode, setDemoMode] = useState(false)
  const { isDarkMode, toggleTheme } = useTheme()
  // A decision is on its way to the server: the banner buttons wait for it.
  const [deciding, setDeciding] = useState(false)
  const decidingRef = useRef(false)
  // Each reload gets a number; an answer from an older reload is dropped.
  const loadSeq = useRef(0)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const toastTimer = useRef(null)

  const flash = (msg, ms = 3500) => {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  const handleTabChange = useCallback((tab) => {
    setRunTab(tab)
    try { localStorage.setItem('gatekeep_active_tab', tab) } catch { /* storage unavailable */ }
  }, [])

  // A failed reload keeps the last good data on screen (marked "API offline");
  // the server still checks every action against the real state.
  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const list = await api.listRuns()
      const full = await Promise.all(list.map((l) => api.getRun(l.id)))
      if (seq !== loadSeq.current) return full // a newer reload has started; it wins
      setRuns(full)
      setSelectedId((prev) => {
        const urlRunId = new URLSearchParams(window.location.search).get('run')
        if (urlRunId && full.some((r) => r.id === urlRunId)) return urlRunId
        if (prev && full.some((r) => r.id === prev)) return prev
        return full.find((r) => r.awaiting)?.id || full[0]?.id || null
      })
      setApiOnline(true)
      // MCP session data is optional: the tables may not exist yet.
      try {
        const [sessions, stats] = await Promise.all([api.listMcpSessions(), api.getMcpStats()])
        setMcpSessions(sessions)
        setMcpStats(stats)
      } catch { /* MCP tables may not exist yet */ }
      return full
    } catch (e) {
      if (seq !== loadSeq.current) return []
      console.warn('Backend unavailable:', e.message)
      setApiOnline(false)
      return []
    }
  }, [])
  const refreshSoon = useDebouncedCallback(() => { refresh().catch(() => {}) }, REFRESH_DEBOUNCE_MS)

  const signOut = useCallback((notice = null) => {
    loadSeq.current++ // answers to reloads started before signing out are dropped
    sessionRef.current = null
    setSession(null)
    setSessionState(null)
    setLoginNotice(notice)
    setRuns([])
    setSelectedId(null)
  }, [])

  useEffect(() => {
    // Only a signed-in reviewer can have their session expire.
    onSessionExpired(() => { if (sessionRef.current) signOut('Your session expired. Please sign in again.') })
  }, [signOut])

  const handleLoggedIn = (next) => {
    setSession(next)
    setSessionState(next)
    setLoginNotice(null)
    setLoading(true)
  }

  const handleSignOut = async () => {
    await api.logout().catch(() => {})
    signOut()
  }

  useEffect(() => {
    api.health().then((h) => setDemoMode(h.demoMode === true)).catch(() => setDemoMode(false))
    if (!session) { setLoading(false); return }
    refresh().finally(() => setLoading(false))
  }, [refresh, session])

  // Live updates (F8): a burst of events reloads once; after a dropped
  // connection comes back, reload once to catch up on what was missed.
  // An effect must return a cleanup function or undefined (never null).
  useEffect(() => {
    if (!session) return undefined
    const stop = connectRealtime((msg) => {
      const t = msg?.type
      if (t === 'repo.context.scanning') flash('Scanning repository context...', 2500)
      else if (t === 'repo.context.generated') flash(`Repository context ready - ${msg.files ?? 0} relevant files`, 3000)
      else if (t === 'mcp.session.created') flash(`External agent connected (${msg.sessionId?.slice(0, 8)}…)`, 3000)
      else if (t === 'mcp.session.ended') flash('External agent session ended', 2000)
      refreshSoon()
    }, { onReconnect: refreshSoon })
    return () => {
      stop()
      refreshSoon.cancel() // no reload after sign-out
    }
  }, [refreshSoon, session])

  const run = useMemo(() => runs.find((r) => r.id === selectedId) ?? runs[0], [runs, selectedId])

  // target: where a Gate 3 reject sends the work back ('code' or 'design').
  // Resolves true only when the server recorded the decision.
  const decide = async (decision, feedback = '', target) => {
    if (decision === 'reject' && !feedback) {
      setReworkOpen(true)
      return false
    }
    if (decidingRef.current) return false // a double click sends one decision
    decidingRef.current = true
    setDeciding(true)
    try {
      // Who decides comes from the login on the server, not from this request.
      // gate is the step the reviewer is looking at: if the run has moved on
      // (a double click, a slow network), the server refuses instead of
      // applying the decision to the next gate.
      const body = { decision, feedback, gate: run.step }
      if (target) body.target = target
      await api.decide(run.id, body)
      flash(decision === 'approve'
        ? `${run.id} approved. Gate advanced.`
        : `${run.id}: rework requested. Feedback sent to agent.`)
      await refresh()
      return true
    } catch (e) {
      // Never show a decision the server did not record.
      flash(`Decision NOT recorded for ${run.id}: ${e.message}`, 6000)
      return false
    } finally {
      decidingRef.current = false
      setDeciding(false)
    }
  }

  const handleAddComment = async (comment) => {
    try {
      await api.addComment(run.id, comment)
      flash('Review comment recorded')
      await refresh()
    } catch (e) {
      flash(`Comment NOT saved: ${e.message}`, 5000)
      throw e
    }
  }

  const handleDeleteComment = async (commentId) => {
    try {
      await api.deleteComment(run.id, commentId)
      flash('Comment deleted')
      await refresh()
    } catch (e) {
      flash(`Comment NOT deleted: ${e.message}`, 5000)
    }
  }

  const createRun = async (form) => {
    if (!form.brief?.trim()) { flash('A brief is required'); return }
    try {
      const created = await api.createRun({
        brief: form.brief.trim(),
        repo: form.repo?.trim() || '',
        branch: form.branch?.trim() || '',
        description: form.brief.trim(),
      })
      setNewRunOpen(false)
      await refresh()
      setSelectedId(created.id)
      setRunTab('overview')
      flash(`${created.id} created. Click "Run pipeline" to start the agents.`)
    } catch (e) {
      // Keep the dialog open so nothing typed is lost.
      flash(`Run NOT created: ${e.message}`, 5000)
    }
  }

  const startPipeline = async () => {
    try {
      await api.start(run.id)
      flash(`${run.id}: pipeline started. Container sandbox running...`)
      await refresh()
    } catch (e) {
      flash(`${run.id}: pipeline NOT started: ${e.message}`, 5000)
    }
  }

  const { doTamper, copyRunId, copyBranchCheckout, downloadPatch, exportAuditJson } = useRunActions(run, flash, refresh)

  const openRun = (id) => {
    setSelectedId(id)
    setRunTab('code')
  }

  // The banner's "Open the ..." link: the page where this gate is reviewed.
  const openReview = ({ tab, section }) => {
    handleTabChange(tab)
    if (section) setSpecsSection((prev) => ({ section, nonce: prev.nonce + 1 }))
  }

  if (!session) {
    return <LoginScreen onLoggedIn={handleLoggedIn} notice={loginNotice} />
  }

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-canvas text-[13px] text-muted font-sans">
        Connecting to the GateKeep platform...
      </div>
    )
  }

  const page = (width, child) => (
    <div className="flex-1 h-full overflow-y-auto bg-canvas p-6">
      <div className={`mx-auto ${width}`}>{child}</div>
    </div>
  )
  const specsDefault = run?.step === 'design' || run?.step === 'g2' ? 'design' : 'requirements'

  return (
    <div className="flex h-[100dvh] w-[100dvw] flex-col overflow-hidden bg-canvas font-sans transition-colors duration-150">
      <AppHeader
        runs={runs}
        run={run}
        user={session.user}
        runTab={runTab}
        onTabChange={handleTabChange}
        onSelectRun={setSelectedId}
        onSignOut={handleSignOut}
        onNewRun={() => setNewRunOpen(true)}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        onCopyRunId={copyRunId}
        onCopyCheckout={copyBranchCheckout}
        onDownloadPatch={downloadPatch}
        onExportAudit={exportAuditJson}
      />

      {/* Phone/tablet navigation sub-bar: the tabs move here so the header never collides. */}
      <nav className="md:hidden shrink-0 border-b border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-[#0b0b0d] px-3 py-1.5" aria-label="Run views">
        <NavTabs active={runTab} onChange={handleTabChange} full />
      </nav>

      {/* One gate banner on every page (F4) */}
      <GateBanner
        run={run}
        user={session.user}
        busy={deciding}
        onApprove={() => decide('approve')}
        onRequestChanges={() => setReworkOpen(true)}
        onOpenReview={openReview}
      />

      <main className="flex flex-1 min-w-0 min-h-0 overflow-hidden bg-canvas">
        {runTab === 'code' && (
          <CodeReview run={run} reviewerRole={reviewerRole} onAddComment={handleAddComment} />
        )}

        {runTab === 'overview' && page('max-w-6xl', (
          <OverviewDashboardView
            run={run}
            onStartPipeline={startPipeline}
            onNavigateTab={handleTabChange}
            onTamper={demoMode ? doTamper : undefined}
            mcpSessions={mcpSessions}
            mcpStats={mcpStats}
            onRefreshMcp={refresh}
          />
        ))}

        {runTab === 'specs' && page('max-w-5xl', (
          <SpecsDesignView
            key={`${run?.id}:${specsSection.nonce}`}
            initialSection={specsSection.section || specsDefault}
            run={run}
            reviewerRole={reviewerRole}
            currentUser={session.user}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
          />
        ))}

        {runTab === 'tests' && page('max-w-5xl', <TestResultsView run={run} onRerunTests={startPipeline} />)}

        {runTab === 'audit' && page('max-w-5xl', (
          <AuditLogView runs={runs} activeRun={run} onOpenRun={openRun} onTamper={demoMode ? doTamper : undefined} onRefresh={refresh} />
        ))}
      </main>

      <AppFooter
        apiOnline={apiOnline}
        runs={runs}
        run={run}
        activeAgents={mcpStats?.active_sessions ?? mcpSessions.filter((s) => s.status === 'active').length}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
      />

      {reworkOpen && run && (
        <ReworkModal
          onClose={() => setReworkOpen(false)}
          run={run}
          reviewerRole={reviewerRole}
          onConfirm={(feedback, target) => decide('reject', feedback, target)}
        />
      )}

      {newRunOpen && <NewRunDialog onClose={() => setNewRunOpen(false)} onCreate={createRun} />}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white/95 dark:bg-[#1c1c1f]/95 px-4.5 py-2.5 text-[13px] font-medium text-ink dark:text-[#f5f5f7] shadow-pop backdrop-blur-xl animate-rise">
          {toast}
        </div>
      )}
    </div>
  )
}
