import { useState } from 'react'
import {
  CircleCheck, Clock, GitBranch, GitCommitHorizontal, ShieldCheck, ShieldAlert,
  ArrowRight, Check, RotateCcw, TriangleAlert, Layers, Cpu, Box, Lock, Terminal, FileCode, Play
} from 'lucide-react'
import PipelineStepper from '../PipelineStepper'
import McpSessionsPanel from './McpSessionsPanel'

export default function OverviewDashboardView({
  run,
  canAct,
  onApprove,
  onRequestRework,
  onStartPipeline,
  onNavigateTab,
  onTamper,
  mcpSessions,
  mcpStats,
  onRefreshMcp,
}) {
  if (!run) {
    return (
      <div className="flex flex-col gap-6 font-sans">
        <div className="card flex flex-col items-center justify-center p-12 text-center shadow-card bg-white">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/[0.03] text-accent mb-4">
            <Layers size={28} />
          </div>
          <h2 className="text-[17px] font-semibold text-ink">No Active Runs</h2>
          <p className="mt-1.5 max-w-md text-[13px] text-muted leading-relaxed">
            There are currently no runs in the system. Click <strong>+ New Run</strong> in the top navigation bar to launch an AI workflow on any Git repository.
          </p>
        </div>

        {/* MCP Sessions */}
        <McpSessionsPanel
          sessions={mcpSessions}
          stats={mcpStats}
          onRefresh={onRefreshMcp}
        />
      </div>
    )
  }

  const steps = run?.steps || []
  const summary = run?.summary || {
    headline: run?.brief || 'Workflow in progress',
    sub: run?.repo ? `Repository: ${run.repo}${run.branch ? ` (${run.branch})` : ''}` : 'Governed agent pipeline',
    checks: run?.steps?.filter((s) => s.state === 'approved').map((s) => `${s.label} (${s.role}) approved`) || [
      'Workflow initialized with air-gapped security controls',
      'Deterministic cryptographic audit ledger active',
    ],
  }
  const totals = run?.totals || { cost: '$0.00', tokens: '0', wall: '—' }
  const tests = run?.tests || { passed: 0, failed: 0, total: 0, iterations: 0, duration: '—' }
  const sandbox = run?.sandbox || {
    status: run?.status === 'approved' ? 'Completed' : 'Standby',
    image: 'gatekeep-sandbox',
    network: 'Disabled',
    memory: '512 MB',
    cpu: '1 core',
    timeout: '30 seconds',
  }
  const isVerified = run?.verified !== false && run?.verify?.valid !== false

  const additions = run?.files ? run.files.reduce((a, f) => a + (f.additions || 0), 0) : 0
  const deletions = run?.files ? run.files.reduce((a, f) => a + (f.deletions || 0), 0) : 0
  const linesText = (additions > 0 || deletions > 0) ? `+${additions}, -${deletions}` : '—'

  return (
    <div className="flex flex-col gap-6 font-sans">
      {/* 1. Top Card: Horizontal Multi-Agent Stepper */}
      <div className="card p-6 shadow-card">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3 mb-5">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-ink">Multi-Agent Pipeline Progression</h2>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
            <span className="font-semibold text-ink">{totals.cost}</span>
            <span>·</span>
            <span>{totals.tokens} tokens</span>
            <span>·</span>
            <span>{totals.wall}</span>
          </div>
        </div>

        <PipelineStepper steps={steps} />
      </div>

      {/* 2. Three-Card Bento Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Bento Card 1: Executive Summary */}
        <div className="card flex flex-col p-6 shadow-card">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-3.5">
            <h3 className="text-[14px] font-semibold text-ink">Executive Summary</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              tests.total > 0 && tests.failed === 0
                ? 'bg-[#34c759]/15 text-[#1f7a37]'
                : run?.status === 'approved'
                ? 'bg-[#34c759]/15 text-[#1f7a37]'
                : 'bg-black/[0.04] text-muted'
            }`}>
              {tests.total > 0
                ? `Passed ${tests.passed}/${tests.total}`
                : run?.status === 'approved'
                ? 'Completed'
                : run?.awaiting
                ? `Gate: ${run.gate || 'Review'}`
                : run?.status || 'In Progress'}
            </span>
          </div>

          <div className="mt-4 flex-1">
            <div className="text-[14px] font-semibold text-ink">{summary.headline}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{summary.sub}</p>

            <div className="mt-4 space-y-2.5">
              {summary.checks && summary.checks.length > 0 ? (
                summary.checks.map((c, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-[12px] text-ink">
                    <CircleCheck size={15} strokeWidth={2.5} className="mt-0.5 shrink-0 text-[#34c759]" />
                    <span className="leading-snug">{c}</span>
                  </div>
                ))
              ) : (
                <div className="text-[12px] text-muted italic">No checks executed yet.</div>
              )}
            </div>
          </div>

          {/* Metric Chips */}
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-black/[0.06] pt-4 text-center">
            <div className="rounded-xl bg-black/[0.025] p-2">
              <div className="font-mono text-[13px] font-semibold text-[#1f7a37]">{linesText}</div>
              <div className="text-[10px] text-faint uppercase font-medium">Lines</div>
            </div>
            <div className="rounded-xl bg-black/[0.025] p-2">
              <div className="font-mono text-[13px] font-semibold text-ink">{tests.iterations || 0}</div>
              <div className="text-[10px] text-faint uppercase font-medium">Self-Heal</div>
            </div>
            <div className="rounded-xl bg-black/[0.025] p-2">
              <div className="font-mono text-[13px] font-semibold text-accent">
                {tests.total > 0 ? `${Math.round((tests.passed / tests.total) * 100)}%` : '—'}
              </div>
              <div className="text-[10px] text-faint uppercase font-medium">Tests</div>
            </div>
          </div>

          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('code')}
              className="mt-4 flex items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.025] hover:bg-black/[0.05] py-2 text-[12px] font-semibold text-ink transition-colors"
            >
              <span>Open Code Review IDE</span>
              <ArrowRight size={13} className="text-muted" />
            </button>
          )}
        </div>

        {/* Bento Card 2: Repository & Execution Context */}
        <div className="card flex flex-col p-6 shadow-card">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-3.5">
            <h3 className="text-[14px] font-semibold text-ink">Repository &amp; Sandbox</h3>
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
              Air-Gapped
            </span>
          </div>

          <div className="mt-4 flex-1 space-y-3.5 text-[12.5px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <GitBranch size={14} className="text-faint" /> Target Branch
              </span>
              <span className="font-mono text-[12px] font-semibold text-ink truncate max-w-[180px]">
                {run?.branch || 'main'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <GitCommitHorizontal size={14} className="text-faint" /> Commit SHA
              </span>
              <span className="font-mono text-[12px] text-muted">
                {run?.commit || run?.repositoryContext?.repository?.commit_sha || '—'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <Box size={14} className="text-faint" /> Sandbox Container
              </span>
              <span className="font-mono text-[12px] text-ink">{sandbox.image}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <Lock size={14} className="text-[#34c759]" /> Network Egress
              </span>
              <span className="font-mono text-[12px] font-semibold text-[#1f7a37]">
                Disabled (--network none)
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <Cpu size={14} className="text-faint" /> Resource Limit
              </span>
              <span className="font-mono text-[12px] text-ink">
                {sandbox.memory}, {sandbox.cpu}
              </span>
            </div>
          </div>

          {onNavigateTab ? (
            <button
              type="button"
              onClick={() => onNavigateTab('tests')}
              className="mt-4 flex items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.025] hover:bg-black/[0.05] py-2 text-[12px] font-semibold text-ink transition-colors"
            >
              <span>View Pytest Container Logs</span>
              <ArrowRight size={13} className="text-muted" />
            </button>
          ) : (
            <div className="mt-5 rounded-xl bg-black/[0.025] border border-black/[0.04] p-3 text-[11px] text-muted leading-relaxed">
              All code modifications were generated inside an ephemeral container. Code is verified against pytest suite with zero network capabilities.
            </div>
          )}
        </div>

        {/* Bento Card 3: Cryptographic Audit Seal & Signatures */}
        <div className="card flex flex-col p-6 shadow-card">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-3.5">
            <h3 className="text-[14px] font-semibold text-ink">Audit Ledger Seal</h3>
            {isVerified ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#34c759]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#1f7a37]">
                <ShieldCheck size={13} /> Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ff3b30]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#d70015]">
                <ShieldAlert size={13} /> Tampered
              </span>
            )}
          </div>

          <div className="mt-4 flex-1 space-y-3 text-[12.5px]">
            <div className="flex items-center justify-between">
              <span className="text-muted">Ledger Algorithm:</span>
              <span className="font-mono text-[12px] font-semibold text-ink">SHA-256 HMAC</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted">Chain Length:</span>
              <span className="font-mono text-[12px] text-ink">{run?.auditChain?.length || 0} verified blocks</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted">Genesis Hash:</span>
              <span className="font-mono text-[11px] text-faint">
                {run?.auditChain?.[0]?.hash ? `${run.auditChain[0].hash.slice(0, 10)}…` : '—'}
              </span>
            </div>

            {/* Reviewer Signatures */}
            <div className="mt-3 border-t border-black/[0.06] pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-faint mb-2">
                Signatures on Record
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Requester</span>
                  <span className="font-mono text-[10.5px] text-[#1f7a37]">✓ Submitted</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Planner (Gate 1)</span>
                  <span className={`font-mono text-[10.5px] ${
                    steps.find((s) => s.key === 'g1')?.state === 'approved' ? 'text-[#1f7a37]' : run?.gate === 'Planner' ? 'text-accent' : 'text-faint'
                  }`}>
                    {steps.find((s) => s.key === 'g1')?.state === 'approved' ? '✓ Approved' : run?.gate === 'Planner' ? '● Awaiting' : 'Pending'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Engineer (Gate 2)</span>
                  <span className={`font-mono text-[10.5px] ${
                    steps.find((s) => s.key === 'g2')?.state === 'approved' ? 'text-[#1f7a37]' : run?.gate === 'Engineer' ? 'text-accent' : 'text-faint'
                  }`}>
                    {steps.find((s) => s.key === 'g2')?.state === 'approved' ? '✓ Approved' : run?.gate === 'Engineer' ? '● Awaiting' : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Tamper test trigger & Audit tab navigation */}
          <div className="mt-4 flex flex-col gap-2">
            {onTamper && run?.auditChain?.length > 1 && (
              <button
                type="button"
                onClick={() => onTamper(2)}
                className="w-full rounded-xl border border-black/[0.08] bg-black/[0.025] hover:bg-black/[0.05] py-2 text-[11.5px] font-medium text-ink transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <TriangleAlert size={13} className="text-[#ff9500]" />
                <span>Simulate Tamper Test</span>
              </button>
            )}
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('audit')}
                className="w-full rounded-xl border border-black/[0.08] bg-black/[0.015] hover:bg-black/[0.04] py-2 text-[12px] font-semibold text-ink transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Inspect Cryptographic Ledger</span>
                <ArrowRight size={13} className="text-muted" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2.5. MCP External Agent Sessions */}
      <McpSessionsPanel
        sessions={mcpSessions}
        stats={mcpStats}
        onRefresh={onRefreshMcp}
      />

      {/* 3. Bottom Gate Decision Panel (Responsive to Workflow State) */}
      <div className="card p-6 shadow-card bg-gradient-to-r from-white via-white to-accent/[0.02]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  run?.awaiting ? 'bg-accent animate-ping' : run?.status === 'approved' ? 'bg-[#34c759]' : 'bg-muted'
                }`} />
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  run?.awaiting ? 'bg-accent' : run?.status === 'approved' ? 'bg-[#34c759]' : 'bg-muted'
                }`} />
              </span>
              <h3 className="text-[16px] font-semibold text-ink">
                {run?.awaiting
                  ? 'Gate Decision Required'
                  : run?.status === 'approved'
                  ? 'Pipeline Completed & Approved'
                  : run?.status === 'rejected'
                  ? 'Gate Rejected — Rework Queued'
                  : 'Workflow Ready to Run'}
              </h3>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                run?.awaiting
                  ? 'bg-accent/15 text-accent'
                  : run?.status === 'approved'
                  ? 'bg-[#34c759]/15 text-[#1f7a37]'
                  : run?.status === 'rejected'
                  ? 'bg-[#ff3b30]/15 text-[#d70015]'
                  : 'bg-black/[0.04] text-muted'
              }`}>
                {run?.awaiting ? `Awaiting ${run?.gate || 'Review'}` : run?.status || 'idle'}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {run?.awaiting
                ? `Role "${run?.gate || 'Reviewer'}" must approve or request rework to advance the pipeline.`
                : run?.status === 'approved'
                ? 'All phases approved and verified against cryptographic audit ledger.'
                : run?.status === 'rejected'
                ? 'Rework requested. Awaiting pipeline rerun.'
                : 'Click Start Pipeline to begin agent reasoning, testing, and approval gates.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {run?.awaiting ? (
              <>
                <button
                  type="button"
                  onClick={onRequestRework}
                  className="rounded-xl border border-black/[0.08] bg-black/[0.03] hover:bg-black/[0.06] px-4 py-2 text-[12.5px] font-semibold text-ink transition-colors flex items-center gap-1.5"
                >
                  <RotateCcw size={13} className="text-muted" />
                  <span>Request Rework</span>
                </button>
                <button
                  type="button"
                  disabled={!canAct}
                  onClick={onApprove}
                  className="rounded-xl bg-[#0071e3] hover:bg-[#0077ed] px-5 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <span>Approve {run?.gate || 'Gate'} ↗</span>
                </button>
              </>
            ) : run?.status === 'approved' ? (
              <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1f7a37]">
                <Check size={16} strokeWidth={2.5} />
                <span>Production Ready</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onStartPipeline && onStartPipeline(run?.id)}
                className="rounded-xl bg-[#0071e3] hover:bg-[#0077ed] px-5 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all active:scale-[0.98] flex items-center gap-1.5"
              >
                <Play size={13} fill="currentColor" />
                <span>Start Pipeline ▶</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
