// Maps pipeline statuses to muted-pastel token classes (bg + ink) and a label.
export const STATUS = {
  approved: { bg: 'bg-green-bg', ink: 'text-green-ink', label: 'Approved' },
  running: { bg: 'bg-blue-bg', ink: 'text-blue-ink', label: 'Running' },
  awaiting_gate: { bg: 'bg-yellow-bg', ink: 'text-yellow-ink', label: 'Awaiting gate' },
  rejected: { bg: 'bg-red-bg', ink: 'text-red-ink', label: 'Rejected' },
  queued: { bg: 'bg-neutral-bg', ink: 'text-neutral-ink', label: 'Queued' },
}

export const statusOf = (key) => STATUS[key] ?? STATUS.queued

export const fmtCost = (n) => `$${n.toFixed(2)}`
export const fmtTokens = (n) => n.toLocaleString('en-US')
export const fmtDuration = (s) => {
  if (!s) return '—'
  const m = Math.floor(s / 60)
  const r = s % 60
  return m ? `${m}m ${r}s` : `${r}s`
}
