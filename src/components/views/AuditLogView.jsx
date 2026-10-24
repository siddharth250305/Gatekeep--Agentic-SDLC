import { useState } from 'react'
import {
  ShieldCheck, ShieldAlert, TriangleAlert, ArrowRight, Download, Link2, Copy, Check,
  Key, Clock, User, Layers, RefreshCw
} from 'lucide-react'

function shortHash(h) {
  if (!h) return ''
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

export default function AuditLogView({ runs = [], onOpenRun, activeRun, onTamper, onRefresh }) {
  const [copiedHash, setCopiedHash] = useState(null)
  const [filterQuery, setFilterQuery] = useState('')

  // Determine active run for block sequence inspection
  const targetRun = activeRun || runs[0]
  const auditChain = targetRun?.auditChain || []
  const verify = targetRun?.verify || {}
  const isVerified = targetRun?.verified !== false && verify?.valid !== false
  const brokenAt = verify?.brokenAt ?? (targetRun?.verified === false ? 2 : null)

  // Collect all events across all runs for the historical table
  const allRows = runs.flatMap((r) =>
    (r.auditChain || []).map((e) => ({
      runId: r.id,
      seq: e.seq,
      event: e.event,
      actor: e.actor || 'System',
      hash: e.hash,
      prevHash: e.prevHash || e.prev_hash,
      timestamp: e.timestamp || e.at || 'Just now',
      payload: e.payload,
      verified: r.verified,
    })),
  )

  const filteredRows = allRows.filter((r) => {
    if (!filterQuery.trim()) return true
    const q = filterQuery.toLowerCase()
    return (
      r.runId.toLowerCase().includes(q) ||
      r.event.toLowerCase().includes(q) ||
      r.actor.toLowerCase().includes(q) ||
      (r.hash && r.hash.toLowerCase().includes(q))
    )
  })

  const handleCopy = (hash) => {
    navigator.clipboard.writeText(hash)
    setCopiedHash(hash)
    setTimeout(() => setCopiedHash(null), 2000)
  }

  const exportAuditJson = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      runId: targetRun?.id,
      verified: isVerified,
      chain: auditChain,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-chain-${targetRun?.id || 'export'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 font-sans">
      {/* Top Header Card */}
      <div className="card p-6 shadow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[20px] font-semibold text-ink dark:text-[#f5f5f7]">Cryptographic Audit Ledger</h1>
              {isVerified ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#34c759]/12 border border-[#34c759]/25 px-3 py-0.5 text-[11.5px] font-semibold text-[#17692e] dark:bg-[#34c759]/20 dark:border-[#34c759]/30 dark:text-[#34c759]">
                  <ShieldCheck size={14} strokeWidth={2.5} /> Unbroken Chain
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ff3b30]/12 border border-[#ff3b30]/25 px-3 py-0.5 text-[11.5px] font-semibold text-[#d70015] dark:bg-[#ff453a]/20 dark:border-[#ff453a]/30 dark:text-[#ff453a]">
                  <ShieldAlert size={14} strokeWidth={2.5} /> Tamper Detected (#{brokenAt})
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted dark:text-[#a1a1aa]">
              Tamper-evident, SHA-256 hash-chained immutable record. Any database modification immediately breaks downstream block hashes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.03] hover:bg-black/[0.06] px-3.5 py-2 text-[12px] font-medium text-ink transition-colors shadow-2xs dark:border-white/[0.1] dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:text-[#f5f5f7]"
                title="Query backend to re-verify cryptographic hashes"
              >
                <RefreshCw size={13} className="text-muted dark:text-[#a1a1aa]" />
                <span>Re-verify Chain</span>
              </button>
            )}
            <button
              type="button"
              onClick={exportAuditJson}
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.03] hover:bg-black/[0.06] px-3.5 py-2 text-[12px] font-medium text-ink transition-colors shadow-2xs dark:border-white/[0.1] dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:text-[#f5f5f7]"
            >
              <Download size={13} className="text-muted dark:text-[#a1a1aa]" />
              <span>Export Audit JSON</span>
            </button>
          </div>
        </div>

        {/* Cryptographic Tamper Alert Banner */}
        {!isVerified && (
          <div className="mt-5 rounded-2xl border border-red/30 bg-red/[0.06] p-4.5 text-[13px] text-ink animate-rise dark:border-red/40 dark:bg-red/15 dark:text-[#f5f5f7]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red text-white shadow-xs">
                <TriangleAlert size={14} strokeWidth={2.5} />
              </span>
              <div className="space-y-1">
                <div className="font-semibold text-red text-[14px]">
                  Cryptographic Integrity Failure Detected at Block #{brokenAt}
                </div>
                <div className="text-muted text-[12.5px] leading-relaxed dark:text-[#d1d5db]">
                  An attacker or unauthorized process modified the underlying database record for audit event #{brokenAt}.
                  Because the hash was calculated using the original payload, the recomputed SHA-256 hash does not match the stored cryptographic chain.
                </div>
                {verify?.storedHash && verify?.recomputedHash && (
                  <div className="mt-2 font-mono text-[11px] text-red/90 bg-red/10 rounded-lg p-2.5 dark:text-red-300 dark:bg-red-950/40">
                    <div>Stored Hash: <span className="font-bold">{verify.storedHash}</span></div>
                    <div>Recomputed:  <span className="font-bold">{verify.recomputedHash}</span> (Mismatch!)</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Visual Block Sequence Graph (Matching gatekeep_tests_audit_dashboard) */}
      <div className="card p-6 shadow-card">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3 mb-5 dark:border-white/[0.08]">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-accent" />
            <h3 className="text-[14px] font-semibold text-ink dark:text-[#f5f5f7]">
              Block Sequence Chain ({targetRun?.id || 'RUN-0427'})
            </h3>
          </div>
          <span className="font-mono text-[11px] text-faint dark:text-[#8e8e93]">Algorithm: SHA-256 (HMAC signed)</span>
        </div>

        {auditChain.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-muted dark:text-[#a1a1aa]">
            No audit blocks recorded for this run yet. Run the pipeline to begin the chain.
          </div>
        ) : (
          <div className="relative space-y-4">
            {auditChain.map((block, idx) => {
              const isBroken = brokenAt != null && block.seq === brokenAt
              const isLast = idx === auditChain.length - 1

              return (
                <div key={block.seq} className="relative flex items-start gap-4">
                  {/* Connecting Line */}
                  {!isLast && (
                    <div
                      className={`absolute left-[17px] top-[36px] bottom-[-16px] w-[2px] transition-colors ${
                        isBroken ? 'bg-red' : 'bg-black/[0.08] dark:bg-white/[0.1]'
                      }`}
                    />
                  )}

                  {/* Block Index Badge */}
                  <span
                    className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-[12px] font-bold shadow-xs ${
                      isBroken
                        ? 'bg-red text-white ring-4 ring-red/20'
                        : 'bg-[#0071e3] text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)]'
                    }`}
                  >
                    #{block.seq}
                  </span>

                  {/* Block Card */}
                  <div
                    className={`flex-1 rounded-2xl border p-4 transition-all ${
                      isBroken
                        ? 'border-red/40 bg-red/[0.03] shadow-md ring-1 ring-red/20 dark:bg-red/10 dark:border-red/50'
                        : 'border-black/[0.06] bg-[#fbfbfd]/70 hover:bg-white hover:shadow-card dark:border-white/[0.08] dark:bg-[#141416] dark:hover:bg-[#1c1c1f]'
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-ink dark:text-[#f5f5f7]">
                          {block.event}
                        </span>
                        <span className="rounded-md bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] text-faint dark:bg-white/[0.06] dark:text-[#8e8e93]">
                          Block {block.seq}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {onTamper && (
                          <button
                            type="button"
                            onClick={() => onTamper(block.seq)}
                            className="rounded-lg border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-faint hover:border-red hover:text-red transition-colors shadow-2xs dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-[#a1a1aa] dark:hover:border-red dark:hover:text-red"
                            title="Simulate attacker mutating this event in the database"
                          >
                            Simulate Tamper
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Hashes and Metadata */}
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 text-[12px]">
                      <div className="flex items-center gap-1.5 font-mono text-muted dark:text-[#a1a1aa]">
                        <Link2 size={13} className="text-faint shrink-0 dark:text-[#8e8e93]" />
                        <span className="text-faint dark:text-[#8e8e93]">Block Hash:</span>
                        <span className="font-semibold text-ink dark:text-[#f5f5f7]">{shortHash(block.hash)}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(block.hash)}
                          className="text-faint hover:text-ink ml-1 dark:text-[#8e8e93] dark:hover:text-white"
                        >
                          {copiedHash === block.hash ? <Check size={11} className="text-green dark:text-[#34c759]" /> : <Copy size={11} />}
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5 text-muted dark:text-[#a1a1aa]">
                        <User size={13} className="text-faint shrink-0 dark:text-[#8e8e93]" />
                        <span className="text-faint dark:text-[#8e8e93]">Actor:</span>
                        <span className="font-medium text-ink dark:text-[#f5f5f7]">{block.actor || 'GateKeep Core'}</span>
                      </div>
                    </div>

                    {/* Payload Details */}
                    {block.payload && (
                      <div className="mt-2.5 rounded-xl bg-black/[0.025] border border-black/[0.04] p-2.5 font-mono text-[11px] text-muted dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-[#a1a1aa]">
                        {typeof block.payload === 'object'
                          ? JSON.stringify(block.payload)
                          : String(block.payload)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Historical Ledger Table */}
      <div className="card overflow-hidden shadow-card">
        <div className="flex items-center justify-between border-b border-black/[0.06] p-4 bg-black/[0.015] dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-ink dark:text-[#f5f5f7]">All Runs Ledger History</h3>
            <span className="rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[11px] text-muted dark:bg-white/[0.06] dark:text-[#a1a1aa]">
              {filteredRows.length} events
            </span>
          </div>

          <input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Search events, runs, hashes..."
            className="w-56 rounded-lg border border-black/[0.08] bg-white px-2.5 py-1 text-[12px] text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-accent dark:border-white/[0.12] dark:bg-[#1a1a1d] dark:text-white dark:placeholder-[#71717a]"
          />
        </div>

        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-black/[0.06] bg-black/[0.02] text-faint font-mono text-[10.5px] uppercase tracking-wider dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-[#8e8e93]">
              <th className="px-4 py-2.5">Run</th>
              <th className="px-4 py-2.5">Seq</th>
              <th className="px-4 py-2.5">Event</th>
              <th className="px-4 py-2.5">Actor</th>
              <th className="px-4 py-2.5">SHA-256 Hash</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
            {filteredRows.map((row, i) => (
              <tr
                key={`${row.runId}-${row.seq}-${i}`}
                onClick={() => onOpenRun && onOpenRun(row.runId)}
                className="cursor-pointer transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3 font-mono text-[12px] font-semibold text-accent">{row.runId}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted dark:text-[#a1a1aa]">#{row.seq}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-ink dark:text-[#f5f5f7]">{row.event}</td>
                <td className="px-4 py-3 text-muted dark:text-[#a1a1aa]">{row.actor}</td>
                <td className="px-4 py-3 font-mono text-[11.5px] text-faint dark:text-[#8e8e93]">{shortHash(row.hash)}</td>
                <td className="px-4 py-3">
                  {row.verified !== false ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#17692e] dark:text-[#34c759]">
                      <ShieldCheck size={12} /> Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red dark:text-[#ff453a]">
                      <ShieldAlert size={12} /> Broken
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
