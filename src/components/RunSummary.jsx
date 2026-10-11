export default function RunSummary({ totals, steps }) {
  const agentPhases = steps?.filter((s) => s.cost) ?? []
  const stats = [
    { label: 'Total cost', value: totals.cost },
    { label: 'Total tokens', value: totals.tokens },
    { label: 'Wall time', value: totals.wall },
  ]
  return (
    <div className="card p-5">
      <h3 className="text-[16px] font-medium text-ink">Run summary</h3>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="font-mono text-[18px] font-medium tabnum tracking-tight text-ink">{s.value}</div>
            <div className="label mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      {agentPhases.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="label">Cost by phase</div>
          <div className="mt-3 flex flex-col gap-2.5">
            {agentPhases.map((p) => (
              <div key={p.key} className="flex items-center justify-between text-[13px]">
                <span className="text-muted">{p.label}</span>
                <span className="font-mono tabnum">
                  <span className="text-ink">{p.cost}</span>
                  <span className="ml-4 text-faint">{p.tokens}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
