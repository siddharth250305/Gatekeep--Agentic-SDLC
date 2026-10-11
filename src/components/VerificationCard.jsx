import { CircleCheck, CircleX, RefreshCw, Clock, ArrowRight } from 'lucide-react'
import StatusIndicator from './StatusIndicator'

// Sandbox environment + test results, merged into one Verification card.
export default function VerificationCard({ sandbox, tests }) {
  const env = sandbox
    ? [
        ['Image', sandbox.image, false],
        ['Network', sandbox.network, sandbox.network === 'Disabled'],
        ['Memory', sandbox.memory, false],
        ['CPU', sandbox.cpu, false],
        ['Timeout', sandbox.timeout, false],
      ]
    : []
  const pct = tests ? Math.round((tests.passed / tests.total) * 100) : 0
  const allPass = tests ? tests.failed === 0 : false

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-ink">Verification</h3>
        <StatusIndicator status={sandbox?.status === 'Completed' ? 'completed' : 'idle'} chip />
      </div>

      {/* Sandbox */}
      {sandbox ? (
        <dl className="mt-4 flex flex-col gap-2.5">
          {env.map(([k, v, danger]) => (
            <div key={k} className="flex items-center justify-between">
              <dt className="text-[13px] text-muted">{k}</dt>
              <dd className={`font-mono text-[12px] ${danger ? 'text-red' : 'text-ink'}`}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-[13px] text-muted">The sandbox has not run for this phase yet.</p>
      )}

      {/* Tests */}
      {tests && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <span className="label">Test results</span>
            <span className={`font-mono text-[12px] tabnum ${allPass ? 'text-green' : 'text-red'}`}>{tests.passed}/{tests.total} passed</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div className={`h-full rounded-full ${allPass ? 'bg-green' : 'bg-red'}`} style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            <li className="flex items-center gap-2 text-[13px] text-ink"><CircleCheck size={15} className="text-green" />{tests.passed} passed</li>
            <li className="flex items-center gap-2 text-[13px] text-ink"><CircleX size={15} className={tests.failed ? 'text-red' : 'text-faint'} />{tests.failed} failed</li>
            <li className="flex items-center gap-2 text-[13px] text-muted"><RefreshCw size={15} className="text-faint" />{tests.iterations} self-heal iterations</li>
            <li className="flex items-center gap-2 text-[13px] text-muted"><Clock size={15} className="text-faint" />{tests.duration}</li>
          </ul>
        </div>
      )}

      <button className="mt-4 flex items-center gap-1.5 text-[13px] font-medium text-accent transition-opacity hover:opacity-70 focus-visible:opacity-70">
        View configuration <ArrowRight size={14} />
      </button>
    </div>
  )
}
