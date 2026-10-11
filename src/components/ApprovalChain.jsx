import { ShieldCheck, ShieldAlert, TriangleAlert, ArrowRight } from 'lucide-react'

function shortHash(h) {
  if (!h) return ''
  return `${h.slice(0, 6)}…${h.slice(-4)}`
}

// Renders the real per-run SHA-256 audit chain from the backend, its verified
// state, and a per-event tamper affordance that triggers a real DB mutation.
export default function ApprovalChain({ auditChain = [], verify, verified, onTamper }) {
  const brokenAt = verify && verify.valid === false ? verify.brokenAt : null

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-ink">Approval chain</h3>
        {verified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-bg px-2.5 py-1 text-[11px] font-semibold text-green">
            <ShieldCheck size={12} /> Verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-bg px-2.5 py-1 text-[11px] font-semibold text-red">
            <ShieldAlert size={12} /> Chain broken at #{brokenAt}
          </span>
        )}
      </div>

      {auditChain.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">No audit events yet.</p>
      ) : (
        <ol className="mt-4">
          {auditChain.map((e, i) => {
            const broken = brokenAt != null && e.seq === brokenAt
            const last = i === auditChain.length - 1
            return (
              <li key={e.seq} className="group flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold tabnum ${
                      broken ? 'bg-red text-white' : 'bg-green-bg text-green'
                    }`}
                  >
                    {broken ? <TriangleAlert size={12} /> : e.seq}
                  </span>
                  {!last && <span className={`w-px flex-1 ${broken ? 'bg-red' : 'bg-line'}`} />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-[12px] ${broken ? 'text-red' : 'text-ink'}`}>
                      {e.event}
                    </span>
                    <span className="font-mono text-[11px] text-faint">{shortHash(e.hash)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-muted">by {e.actor}</span>
                    {onTamper && (
                      <button
                        onClick={() => onTamper(e.seq)}
                        title="Simulate an attacker rewriting this approved record in the database"
                        className="text-[11px] font-medium text-faint opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                      >
                        tamper
                      </button>
                    )}
                  </div>
                  {broken && (
                    <div className="mt-1 font-mono text-[11px] text-red">
                      recomputed {shortHash(verify.recomputedHash || verify.storedPrevHash)} does not match stored {shortHash(verify.storedHash || verify.expectedPrevHash)}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <button className="flex items-center gap-1.5 text-[13px] font-medium text-accent transition-opacity hover:opacity-70">
        View full audit log <ArrowRight size={14} />
      </button>
    </div>
  )
}
