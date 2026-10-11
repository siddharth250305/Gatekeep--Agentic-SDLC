import { Check, X } from 'lucide-react'
import StatusIndicator from './StatusIndicator'

function Node({ step }) {
  const base = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-200'
  if (step.state === 'approved') {
    return (
      <span className={`${base} bg-green text-white shadow-sm ring-2 ring-green/20`}>
        <Check size={13} strokeWidth={2.5} />
      </span>
    )
  }
  if (step.state === 'rejected') {
    return (
      <span className={`${base} bg-red text-white shadow-sm ring-2 ring-red/20`}>
        <X size={13} strokeWidth={2.5} />
      </span>
    )
  }
  if (step.state === 'active') {
    return (
      <span className={`relative ${base} bg-amber text-white shadow-sm ring-4 ring-amber/25`}>
        <span className="relative text-[11px] font-bold">{step.num}</span>
      </span>
    )
  }
  return (
    <span className={`${base} bg-black/[0.04] text-faint ring-1 ring-black/[0.08]`}>
      <span className="text-[11px] font-medium">{step.num}</span>
    </span>
  )
}

export default function PipelineStepper({ steps, vertical = false }) {
  if (vertical) {
    return (
      <div className="flex flex-col gap-0 py-1">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1
          const isActive = step.state === 'active'
          const isApproved = step.state === 'approved'

          return (
            <div key={step.key} className="relative flex items-start gap-3 pb-4">
              {/* Connecting vertical line */}
              {!isLast && (
                <div
                  className={`absolute left-[11px] top-[22px] bottom-0 w-[2px] transition-colors duration-200 ${
                    steps[i + 1].state === 'pending' ? 'bg-black/[0.08]' : 'bg-[#34c759]/60'
                  }`}
                />
              )}

              {/* Node icon */}
              <div className="relative z-10 shrink-0">
                <Node step={step} />
              </div>

              {/* Label details */}
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`truncate text-[12.5px] font-semibold tracking-[-0.01em] ${
                      step.state === 'pending' ? 'text-faint' : 'text-ink'
                    }`}
                  >
                    {step.label}
                  </span>
                  {step.role && (
                    <span className="font-mono text-[9.5px] text-faint uppercase tracking-wider">
                      {step.role}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`text-[11px] ${
                      isActive
                        ? 'font-semibold text-accent'
                        : isApproved
                        ? 'text-[#1f7a37]'
                        : 'text-faint'
                    }`}
                  >
                    {step.status}
                  </span>
                  {step.at && <span className="font-mono text-[10px] text-faint">· {step.at}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="flex items-start">
        {steps.map((step, i) => (
          <div key={step.key} className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center">
              <Node step={step} />
              {i < steps.length - 1 && (
                <span
                  className={`ml-2 h-[1.5px] flex-1 rounded-full transition-colors duration-200 ${
                    steps[i + 1].state === 'pending' ? 'bg-black/[0.06]' : 'bg-black/[0.18]'
                  }`}
                />
              )}
            </div>
            <div className="mt-3.5 pr-4">
              <div
                className={`truncate text-[13px] font-semibold tracking-[-0.01em] ${
                  step.state === 'pending' ? 'text-faint' : 'text-ink'
                }`}
              >
                {step.label}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-faint">{step.role}</div>
              <StatusIndicator status={step.state} label={step.status} className="mt-1.5" />
              {step.at && <div className="mt-1 font-mono text-[10.5px] text-faint">{step.at}</div>}
              {step.cost && (
                <div className="mt-2 inline-flex items-center rounded-md bg-black/[0.03] px-2 py-0.5 font-mono text-[10.5px] tabnum text-muted">
                  {step.cost} · {step.tokens} tok
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
