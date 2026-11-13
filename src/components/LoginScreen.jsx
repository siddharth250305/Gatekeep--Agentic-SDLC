import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from '../api'

// Reviewer sign-in. Accounts are created on the server with
// `npm run user:create` (backend/), so there is no sign-up form.
export default function LoginScreen({ onLoggedIn, notice }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onLoggedIn(await api.login(username.trim(), password))
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Cannot reach the GateKeep API.' : err.message)
      setBusy(false)
    }
  }

  const field = 'mt-1 w-full rounded-xl border border-black/[0.1] bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/[0.12] dark:bg-[#121214] dark:text-white'

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 font-sans">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 shadow-card" aria-labelledby="login-title">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-accent" />
          <h1 id="login-title" className="text-[16px] font-semibold text-ink dark:text-white">Sign in to GateKeep</h1>
        </div>
        <p className="mt-1 text-[12px] text-muted dark:text-[#a1a1aa]">
          Gate decisions are recorded under your name in the audit log.
        </p>

        {notice && <p className="mt-3 rounded-lg bg-black/[0.04] px-3 py-2 text-[12px] text-muted dark:bg-white/[0.06] dark:text-[#a1a1aa]">{notice}</p>}

        <label htmlFor="login-username" className="mt-4 block text-[12px] font-medium text-ink dark:text-[#f5f5f7]">Username</label>
        <input id="login-username" className={field} autoComplete="username" autoFocus
          value={username} onChange={(e) => setUsername(e.target.value)} required />

        <label htmlFor="login-password" className="mt-3 block text-[12px] font-medium text-ink dark:text-[#f5f5f7]">Password</label>
        <input id="login-password" type="password" className={field} autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />

        {error && <p role="alert" className="mt-3 text-[12px] font-medium text-red">{error}</p>}

        <button type="submit" disabled={busy}
          className="mt-5 w-full rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white shadow-xs hover:bg-accent-hover disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-faint dark:text-[#8e8e93]">
          No account? An admin creates one on the server:<br />
          <code className="font-mono">npm run user:create -- --username you --role Engineer</code>
        </p>
      </form>
    </div>
  )
}
