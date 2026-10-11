const TONES = {
  green: 'bg-green-bg text-green',
  amber: 'bg-amber-bg text-amber',
  red: 'bg-red-bg text-red',
  blue: 'bg-blue-bg text-blue',
  neutral: 'bg-sunken text-muted ring-1 ring-line',
}

export default function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}
