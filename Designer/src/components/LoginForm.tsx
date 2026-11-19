// Username/password sign-in against identity-service (POST /identity/auth/login).
// Accounts are created by a tenant admin (Administration > Users) or the
// seed script (Database/local.sql); there is no self sign-up.
import { useState, type FormEvent } from 'react'
import { login } from '../lib/apiClient'

export function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-white">
      <form
        onSubmit={onSubmit}
        className="w-80 space-y-4 rounded-lg border border-sky-200 bg-sky-50 p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-bold text-[#003b70]">Workflow Designer</h1>
          <p className="text-xs text-slate-500">Sign in with your username and password.</p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">Username</label>
          <input
            type="text"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded border border-sky-200 bg-white p-2 text-sm outline-none focus:border-sky-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-sky-200 bg-white p-2 text-sm outline-none focus:border-sky-500"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-[#0066b2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
        >
          {submitting ? 'Signing In...' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
