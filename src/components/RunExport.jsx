import { useState } from 'react'
import { Download, GitPullRequest, ExternalLink } from 'lucide-react'
import { api } from '../api'
import { downloadText } from '../lib/diff'

// A finished run (I6): download its signed evidence bundle, or open a GitHub
// Pull Request with the approval history in its description. The server
// builds and signs both; the PR is created once and recorded in the audit chain.
export default function RunExport({ run, flash = () => {} }) {
  const [busy, setBusy] = useState(null)
  const [created, setCreated] = useState(null)
  const recorded = (run?.auditChain || []).find((e) => e.event === 'run.pr_created')?.payload
  const pr = created || recorded

  const download = async () => {
    setBusy('evidence')
    try {
      const bundle = await api.evidence(run.id)
      downloadText(`${run.id}.gatekeep-evidence.json`, JSON.stringify(bundle, null, 2), 'application/json')
      flash(`Downloaded the signed evidence for ${run.id}`)
    } catch (e) {
      flash(`Evidence NOT exported: ${e.message}`, 6000)
    } finally {
      setBusy(null)
    }
  }

  const createPr = async () => {
    setBusy('pr')
    try {
      setCreated(await api.createPullRequest(run.id))
      flash(`${run.id}: pull request created`)
    } catch (e) {
      flash(`Pull request NOT created: ${e.message}`, 8000)
    } finally {
      setBusy(null)
    }
  }

  const button = 'inline-flex h-8 items-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-white/[0.06] px-3 text-[12.5px] font-semibold text-ink dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.1] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={download} disabled={busy !== null} className={button}>
        <Download size={13} aria-hidden="true" />
        <span>Download evidence</span>
      </button>
      {pr?.url ? (
        <a href={pr.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-semibold text-accent hover:bg-accent/10 dark:text-[#4da3ff]">
          <GitPullRequest size={13} aria-hidden="true" />
          <span>Pull request{pr.number ? ` #${pr.number}` : ''}</span>
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : (
        <button type="button" onClick={createPr} disabled={busy !== null} className={button}>
          <GitPullRequest size={13} aria-hidden="true" />
          <span>Create pull request</span>
        </button>
      )}
    </div>
  )
}
