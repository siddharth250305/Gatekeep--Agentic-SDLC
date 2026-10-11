import { Package, GitBranch, GitCommitHorizontal, Download, ArrowRight, ShieldCheck } from 'lucide-react'
import StatusIndicator from '../StatusIndicator'

export default function ArtifactsView({ runs, onOpenRun }) {
  const artifacts = runs.filter((r) => r.status === 'approved')
  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-[24px] font-semibold tracking-tight text-ink">Artifacts</h1>
      <p className="mt-1 text-[13px] text-muted">Output branches produced by approved runs. Each is locked to its audit chain.</p>
      {artifacts.length === 0 ? (
        <div className="card mt-6 px-6 py-16 text-center">
          <Package size={28} className="mx-auto text-faint" />
          <p className="mt-3 text-[14px] font-medium text-ink">No artifacts yet</p>
          <p className="mt-1 text-[13px] text-muted">Approve a run to generate a verified output branch here.</p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {artifacts.map((r) => (
            <li key={r.id} className="card p-5 transition-shadow hover:shadow-pop">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sunken"><Package size={17} className="text-muted" /></span>
                <StatusIndicator status="verified" chip icon={ShieldCheck} />
              </div>
              <div className="mt-3 truncate text-[14px] font-medium text-ink">{r.brief}</div>
              <div className="mt-2 flex flex-col gap-1 font-mono text-[12px] text-muted">
                <span className="flex items-center gap-1.5"><GitBranch size={13} className="text-faint" />{r.branch}</span>
                <span className="flex items-center gap-1.5"><GitCommitHorizontal size={13} className="text-faint" />{r.commit} · {r.repo}</span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const content = JSON.stringify(r, null, 2)
                    const blob = new Blob([content], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${r.id}-artifact.json`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line py-2 text-[13px] font-medium text-ink transition-colors hover:bg-sunken"
                >
                  <Download size={14} /> Download Artifact
                </button>
                <button onClick={() => onOpenRun(r.id)} className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium text-accent transition-opacity hover:opacity-70">Open <ArrowRight size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
