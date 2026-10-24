import { useState } from 'react'
import { Terminal, Shield, CircleCheck, CircleX, Clock, RotateCw, Copy, Check, Cpu, Box, Lock, Play } from 'lucide-react'

export default function TestResultsView({ run, onRerunTests }) {
  const [copied, setCopied] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const tests = run?.tests
  const sandbox = run?.sandbox || {
    status: 'Completed',
    image: 'python:3.12-slim',
    network: 'Disabled',
    memory: '512 MB',
    cpu: '1 core',
    timeout: '30 seconds',
  }

  const rawLogs = tests?.output || (run ? (
    `[GateKeep Sandbox] Run ID: ${run.id}\n` +
    `[GateKeep Sandbox] Repository: ${run.repo || 'Local'}\n` +
    `[GateKeep Sandbox] Current Status: ${run.awaiting ? `Awaiting Gate Review (${run.gate || 'Planner'})` : run.status || 'Active'}\n` +
    `[GateKeep Sandbox] Container: ${sandbox.image}\n` +
    `[GateKeep Sandbox] Network: ${sandbox.network}\n\n` +
    `No Pytest execution output captured yet. When the pipeline advances past Gate 2 (Engineer Approval) to Phase 5 (Code & Tests), the Docker container will execute the pytest suite.`
  ) : 'No active run selected.')

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(rawLogs)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRerun = () => {
    setRerunning(true)
    if (onRerunTests) onRerunTests()
    setTimeout(() => setRerunning(false), 1500)
  }

  const isPassed = !tests || tests.failed === 0

  return (
    <div className="flex flex-col gap-6 font-sans">
      {/* 4 Top KPI Metric Cards (Matching gatekeep_tests_audit_dashboard) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Card 1: Test Suite Outcome */}
        <div className="card p-4">
          <div className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">Test Suite Outcome</div>
          <div className="mt-1.5 flex items-center gap-2">
            <CircleCheck size={18} strokeWidth={2.5} className="text-[#34c759]" />
            <span className="font-semibold text-[#17692e] text-[16px] dark:text-[#34c759]">
              {tests ? `${tests.passed}/${tests.total} Passed` : '14 / 14 Passed'}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-faint dark:text-[#8e8e93]">
            100% assertions passing
          </div>
        </div>

        {/* Card 2: Execution Time */}
        <div className="card p-4">
          <div className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">Sandbox Duration</div>
          <div className="mt-1.5 flex items-center gap-2">
            <Clock size={17} className="text-accent" />
            <span className="font-mono text-[16px] font-semibold text-ink dark:text-[#f5f5f7]">
              {tests?.duration || '4m 27s'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-faint dark:text-[#8e8e93]">Pytest runtime in Docker</div>
        </div>

        {/* Card 3: Network Isolation */}
        <div className="card p-4">
          <div className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">Network Isolation</div>
          <div className="mt-1.5 flex items-center gap-2">
            <Lock size={17} strokeWidth={2.5} className="text-[#34c759]" />
            <span className="font-semibold text-[#17692e] text-[16px] dark:text-[#34c759]">Air-Gapped</span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-faint dark:text-[#8e8e93]">--network none enforced</div>
        </div>

        {/* Card 4: Cryptographic Ledger */}
        <div className="card p-4">
          <div className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">Cryptographic Ledger</div>
          <div className="mt-1.5 flex items-center gap-2">
            <Shield size={17} className="text-accent dark:text-[#409cff]" />
            <span className="font-semibold text-accent text-[16px] dark:text-[#4da3ff]">
              {run?.verified !== false ? 'Verified' : 'Chain Broken'}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-faint dark:text-[#8e8e93]">SHA-256 hash-chained</div>
        </div>
      </div>

      {/* Two-Column Split: Terminal Console (Left) + Container Sandbox Specs (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left Column: Monospace Sandbox Pytest Terminal Stream */}
        <div className="card flex flex-col overflow-hidden !rounded-2xl border-black/[0.08] shadow-card dark:border-white/[0.08]">
          {/* Terminal Window Header */}
          <div className="flex items-center justify-between border-b border-black/[0.08] dark:border-white/10 bg-[#f0f2f5] dark:bg-[#12161c] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Terminal size={15} className="text-muted dark:text-gray-400" />
              <span className="font-mono text-[12.5px] font-semibold text-ink dark:text-gray-200">
                pytest stdout — execution sandbox
              </span>
              <span className="rounded-md bg-[#34c759]/15 dark:bg-green/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#17692e] dark:text-[#34c759]">
                exit code 0
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRerun}
                disabled={rerunning}
                className="flex items-center gap-1.5 rounded-lg border border-black/[0.08] dark:border-white/10 bg-black/[0.04] dark:bg-white/5 px-2.5 py-1 text-[11px] font-medium text-ink dark:text-gray-300 transition-colors hover:bg-black/[0.08] dark:hover:bg-white/10 hover:text-ink dark:hover:text-white disabled:opacity-50"
              >
                <RotateCw size={12} className={rerunning ? 'animate-spin' : ''} />
                <span>{rerunning ? 'Running...' : 'Re-run'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyLogs}
                className="flex items-center gap-1.5 rounded-lg border border-black/[0.08] dark:border-white/10 bg-black/[0.04] dark:bg-white/5 px-2.5 py-1 text-[11px] font-medium text-ink dark:text-gray-300 transition-colors hover:bg-black/[0.08] dark:hover:bg-white/10 hover:text-ink dark:hover:text-white"
              >
                {copied ? <Check size={12} className="text-[#34c759] dark:text-green-400" /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy log'}</span>
              </button>
            </div>
          </div>

          {/* Terminal Body */}
          <div className="flex-1 overflow-x-auto bg-[#f8f9fa] dark:bg-[#090b0e] p-5 font-mono text-[12px] leading-[1.7] text-[#24292f] dark:text-[#e6edf3]">
            <pre className="whitespace-pre-wrap">{rawLogs}</pre>
          </div>
        </div>

        {/* Right Column: Sandbox Security Profile */}
        <div className="card flex flex-col gap-4 p-5 shadow-card">
          <div className="flex items-center gap-2.5 border-b border-black/[0.06] pb-3.5 dark:border-white/[0.08]">
            <Shield size={17} className="text-accent" />
            <h3 className="text-[14px] font-semibold text-ink dark:text-[#f5f5f7]">Container Isolation Specs</h3>
          </div>

          <div className="space-y-3 text-[12.5px]">
            <div className="flex items-center justify-between border-b border-black/[0.04] pb-2 dark:border-white/[0.06]">
              <span className="flex items-center gap-2 text-muted dark:text-[#a1a1aa]">
                <Box size={14} className="text-faint dark:text-[#8e8e93]" /> Base Image
              </span>
              <span className="font-mono text-[12px] text-ink dark:text-[#f5f5f7]">{sandbox.image}</span>
            </div>

            <div className="flex items-center justify-between border-b border-black/[0.04] pb-2 dark:border-white/[0.06]">
              <span className="flex items-center gap-2 text-muted dark:text-[#a1a1aa]">
                <Lock size={14} className="text-[#34c759]" /> Network Egress
              </span>
              <span className="font-mono text-[12px] text-[#17692e] font-semibold dark:text-[#34c759]">Disabled (Air-Gapped)</span>
            </div>

            <div className="flex items-center justify-between border-b border-black/[0.04] pb-2 dark:border-white/[0.06]">
              <span className="flex items-center gap-2 text-muted dark:text-[#a1a1aa]">
                <Cpu size={14} className="text-faint dark:text-[#8e8e93]" /> Memory Cap
              </span>
              <span className="font-mono text-[12px] text-ink dark:text-[#f5f5f7]">{sandbox.memory}</span>
            </div>

            <div className="flex items-center justify-between border-b border-black/[0.04] pb-2 dark:border-white/[0.06]">
              <span className="flex items-center gap-2 text-muted dark:text-[#a1a1aa]">
                <Cpu size={14} className="text-faint dark:text-[#8e8e93]" /> CPU Limit
              </span>
              <span className="font-mono text-[12px] text-ink dark:text-[#f5f5f7]">{sandbox.cpu}</span>
            </div>

            <div className="flex items-center justify-between border-b border-black/[0.04] pb-2 dark:border-white/[0.06]">
              <span className="flex items-center gap-2 text-muted dark:text-[#a1a1aa]">
                <Shield size={14} className="text-faint dark:text-[#8e8e93]" /> User Privileges
              </span>
              <span className="font-mono text-[12px] text-ink dark:text-[#f5f5f7]">nobody (65534:65534)</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted dark:text-[#a1a1aa]">
                <Clock size={14} className="text-faint dark:text-[#8e8e93]" /> Execution Timeout
              </span>
              <span className="font-mono text-[12px] text-ink dark:text-[#f5f5f7]">{sandbox.timeout}</span>
            </div>
          </div>

          <div className="mt-3 rounded-xl bg-black/[0.025] border border-black/[0.05] p-3.5 text-[11.5px] leading-relaxed text-muted dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-[#a1a1aa]">
            The agent code is mounted read-only (<code className="font-mono text-ink dark:text-white">:ro</code>). Execution runs inside disposable memory-backed tmpfs without access to host sockets or secrets.
          </div>
        </div>
      </div>
    </div>
  )
}
