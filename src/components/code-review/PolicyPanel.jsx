import { ShieldCheck, ShieldAlert } from 'lucide-react'

// Gate 3, right column (F5 part 2, I4, I5): the project's gatekeep.yaml rules
// this change triggered, the approvals they still need, the change size
// against the budget, and any rule that blocks approval. All from the server
// (run.policy, run.governance), which applies the same rules on Approve.
const POLICY_STATUS = {
  loaded: 'gatekeep.yaml in force',
  none: 'No gatekeep.yaml: default rules (one Gate 3 approval)',
  invalid: 'gatekeep.yaml is invalid: nothing can be approved',
}

const budgetText = (b, unit) => (b?.max != null ? `${b.used} of ${b.max} ${unit}` : `${b?.used ?? 0} ${unit} (no limit)`)

export default function PolicyPanel({ run }) {
  const policy = run?.policy
  const gov = run?.governance
  if (!policy && !gov) return null
  const blocked = gov?.blocking?.length > 0 || policy?.status === 'invalid'
  const Icon = blocked ? ShieldAlert : ShieldCheck

  return (
    <section aria-label="Project policy" className="border-b border-black/[0.06] px-4 py-3 text-[12px] dark:border-white/[0.08]">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
        <Icon size={13} className={blocked ? 'text-[#ff3b30]' : 'text-accent'} aria-hidden="true" /> gatekeep.yaml
      </h3>
      <p className="mt-1 text-muted dark:text-[#a1a1aa]">{POLICY_STATUS[policy?.status] || 'Policy not read yet'}</p>
      {policy?.status === 'invalid' && (
        <ul className="mt-1 list-disc pl-4 text-[#d70015] dark:text-[#ff453a]">
          {(policy.errors || []).map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      {gov && (
        <>
          {gov.blocking.length > 0 && (
            <ul aria-label="Blocking rules" className="mt-2 space-y-1">
              {gov.blocking.map((b, i) => (
                <li key={`${i}:${b.code}`} className="rounded-lg border border-[#ff3b30]/40 bg-[#ff3b30]/[0.08] px-2 py-1 font-medium text-[#d70015] dark:text-[#ff453a]">{b.message}</li>
              ))}
            </ul>
          )}
          <ul aria-label="Approvals needed" className="mt-2 space-y-1.5">
            {gov.requirements.map((r, i) => (
              <li key={`${i}:${r.label}`} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[11px] text-ink dark:text-[#f5f5f7]" title={r.label}>{r.label}</span>
                  {r.missingReviewers.length > 0 && (
                    <span className="block text-[10.5px] text-[#b25000] dark:text-[#ff9f0a]">Waiting for {r.missingReviewers.join(', ')}</span>
                  )}
                </span>
                <span className={`shrink-0 text-[11px] font-semibold ${r.satisfied ? 'text-[#17692e] dark:text-[#34c759]' : 'text-[#b25000] dark:text-[#ff9f0a]'}`}>
                  {r.have} of {r.approvals} {r.approvals === 1 ? 'approval' : 'approvals'}
                </span>
              </li>
            ))}
          </ul>
          {gov.triggered.length > 0 && (
            <p className="mt-2 text-[11px] text-muted dark:text-[#a1a1aa]">
              Protected paths touched: {gov.triggered.map((t) => `${t.path} (${t.files.length})`).join(', ')}
            </p>
          )}
          {gov.approvals.length > 0 && (
            <p className="mt-1 text-[11px] text-muted dark:text-[#a1a1aa]">Approved so far by {gov.approvals.map((a) => a.username).join(', ')}</p>
          )}
          <p className="mt-1 text-[11px] text-muted dark:text-[#a1a1aa]">
            Change size: {budgetText(gov.budget?.files, 'files')}, {budgetText(gov.budget?.lines, 'lines')}
          </p>
        </>
      )}
    </section>
  )
}
