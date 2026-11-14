import { useId, useState } from 'react'
import { X, Zap } from 'lucide-react'
import Dialog from './Dialog'

const PRESET = {
  brief: 'Add rate limiting (60 req/min per merchant) to checkout webhook with HMAC signature verification in src/checkout/webhook.py',
  repo: 'commerce-core',
  branch: 'feat/webhook-throttle',
}

const INPUT = 'mt-1 w-full rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2 text-[13px] text-ink dark:text-white outline-none focus:border-accent focus:bg-white dark:focus:bg-[#121214] focus:ring-2 focus:ring-accent/20'

// Launch a new run. onCreate(form) resolves true when the run was created;
// on failure the dialog stays open so nothing typed is lost.
export default function NewRunDialog({ onClose, onCreate }) {
  const titleId = useId()
  const [form, setForm] = useState({ brief: '', repo: '', branch: '' })
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const submit = () => onCreate(form)

  return (
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      overlayClassName="items-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      className="w-full max-w-md rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#18181b] p-6 shadow-pop animate-rise"
    >
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="text-[16px] font-semibold text-ink dark:text-white">Launch New Agent Workflow Run</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-ink dark:hover:text-white cursor-pointer">
          <X size={16} />
        </button>
      </div>
      <p className="mt-1 text-[13px] text-muted dark:text-[#a1a1aa]">
        Specify your engineering task. The multi-agent pipeline will generate specs, write the implementation, and run tests in container isolation.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <span className="text-[11px] font-medium text-faint dark:text-[#8e8e93]">Presets:</span>
        <button
          type="button"
          onClick={() => setForm(PRESET)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] dark:border-white/[0.1] bg-black/[0.025] dark:bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-ink dark:text-[#f5f5f7] transition-colors hover:border-accent hover:text-accent cursor-pointer"
        >
          <Zap size={12} className="text-amber" />
          <span>Webhook Rate Limiting</span>
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">
          Brief <span className="text-red">*</span>
          <input
            data-autofocus
            value={form.brief}
            onChange={set('brief')}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="e.g. Add rate limiting to the checkout webhook"
            className={INPUT}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">
            Repository
            <input value={form.repo} onChange={set('repo')} placeholder="commerce-core" className={INPUT} />
          </label>
          <label className="text-[12px] font-medium text-muted dark:text-[#a1a1aa]">
            Branch
            <input value={form.branch} onChange={set('branch')} placeholder="feat/webhook-throttle" className={INPUT} />
          </label>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] px-4 py-2 text-[13px] font-medium text-ink dark:text-[#f5f5f7] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-hover active:scale-[0.98] cursor-pointer"
        >
          Create Run
        </button>
      </div>
    </Dialog>
  )
}
