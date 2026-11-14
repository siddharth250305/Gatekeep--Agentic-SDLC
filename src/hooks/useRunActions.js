import { api } from '../api'
import { downloadText, patchText } from '../lib/diff'

// The header's "more actions" on the selected run, and the demo tamper test.
// flash(msg, ms) shows a toast; refresh() reloads the runs.
export function useRunActions(run, flash, refresh) {
  const doTamper = async (seq = 2) => {
    try {
      await api.tamper(run.id, seq, { file: 'backdoor.py', note: 'unauthorized edit' })
      flash(`Rewrote audit event #${seq} directly in database. Cryptographic chain broken!`, 5000)
      await refresh()
    } catch (e) {
      flash(`Tamper test failed: ${e.message}`, 5000)
    }
  }

  const copyRunId = () => {
    if (!run) return
    navigator.clipboard.writeText(run.id)
    flash(`Copied ${run.id} to clipboard`)
  }

  const copyBranchCheckout = () => {
    if (!run?.branch) return
    navigator.clipboard.writeText(`git checkout ${run.branch}`)
    flash(`Copied: git checkout ${run.branch}`)
  }

  const downloadPatch = () => {
    if (!run?.diff) { flash('No diff available to download'); return }
    downloadText(`${run.id}.patch`, patchText(run.diff.file || 'code', run.diff.lines || []), 'text/x-diff')
    flash(`Downloaded ${run.id}.patch`)
  }

  const exportAuditJson = () => {
    if (!run) return
    downloadText(`${run.id}-audit-export.json`, JSON.stringify(run, null, 2), 'application/json')
    flash(`Exported audit logs for ${run.id}`)
  }

  return { doTamper, copyRunId, copyBranchCheckout, downloadPatch, exportAuditJson }
}
