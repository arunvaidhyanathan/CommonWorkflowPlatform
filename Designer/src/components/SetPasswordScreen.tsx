// Onboarding.html Section 2.2: the acceptance side of the invite flow. An
// invite link logs the person in via a one-time token (no password yet), so
// before they see the rest of the app we ask them to set one -- otherwise
// they'd have no way back in next time short of "forgot password".
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function SetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-white">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-sky-200 p-6">
        <h1 className="mb-1 text-lg font-bold text-[#003b70]">Welcome to WaaS</h1>
        <p className="mb-4 text-sm text-slate-500">
          You&apos;ve been invited. Set a password to finish setting up your account.
        </p>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <label className="mb-1 block text-xs font-semibold text-slate-500">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded border border-sky-200 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
          autoFocus
        />
        <label className="mb-1 block text-xs font-semibold text-slate-500">Confirm Password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mb-4 w-full rounded border border-sky-200 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded bg-[#0066b2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Set Password & Continue'}
        </button>
      </form>
    </div>
  )
}
