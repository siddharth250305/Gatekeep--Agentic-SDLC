import { GitBranch, GitCommitHorizontal, Check, FileCode } from 'lucide-react'

// Shows what the Repository Context Engine selected, and why. Only rendered
// when a real repo was scanned (run.repositoryContext present).
export default function RepositoryContext({ context }) {
  if (!context || !context.relevant_files) return null
  const { repository = {}, languages = {}, file_count, relevant_files, retrieval_method } = context
  const langEntries = Object.entries(languages).slice(0, 4)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-ink">Repository context</h3>
        <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[10px] font-medium text-accent">
          {relevant_files.length} of {file_count} files
        </span>
      </div>

      {/* repo + commit */}
      <div className="mt-3 flex flex-col gap-1 font-mono text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><GitBranch size={13} className="text-faint" />{repository.url || 'local'}</span>
        <span className="flex items-center gap-1.5"><GitCommitHorizontal size={13} className="text-faint" />{repository.commit_sha}</span>
      </div>

      {/* languages */}
      {langEntries.length > 0 && (
        <div className="mt-4">
          <div className="label">Languages</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {langEntries.map(([lang, pct]) => (
              <div key={lang} className="flex items-center gap-2">
                <span className="w-16 text-[12px] capitalize text-ink">{lang}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right font-mono text-[11px] tabnum text-muted">{pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* relevant files + reasons */}
      <div className="mt-4">
        <div className="label">Relevant files</div>
        <ul className="mt-2 flex flex-col gap-3">
          {relevant_files.map((f) => (
            <li key={f.path}>
              <div className="flex items-center gap-2">
                <FileCode size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{f.path}</span>
                <span className="font-mono text-[11px] tabnum text-faint">{Math.round(f.score * 100)}%</span>
              </div>
              <ul className="mt-1 flex flex-col gap-0.5 pl-6">
                {f.reasons.map((why) => (
                  <li key={why} className="flex items-start gap-1.5 text-[12px] text-muted">
                    <Check size={12} className="mt-0.5 shrink-0 text-green" />{why}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      {retrieval_method && (
        <p className="mt-4 text-[11px] text-faint">Ranked by {retrieval_method}.</p>
      )}
    </div>
  )
}
