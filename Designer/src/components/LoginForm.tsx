// Minimal Supabase Auth sign-in (Designer.html Section 2 decision: Supabase
// Auth end-to-end). Tenant/role assignment happens out-of-band via
// app_metadata; this form only handles credential exchange.
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) throw signInError
      } else {
        const { error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) throw signUpError
        setNotice(
          'Account created. A tenant administrator must assign your workspace before you can open the Designer.',
        )
      }
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
          <p className="text-xs text-slate-500">Sign in with your Supabase account.</p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-sky-200 bg-white p-2 text-sm outline-none focus:border-sky-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-sky-200 bg-white p-2 text-sm outline-none focus:border-sky-500"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {notice && <p className="text-xs text-emerald-700">{notice}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-[#0066b2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
        >
          {mode === 'sign-in' ? 'Sign In' : 'Create Account'}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
          className="w-full text-center text-xs text-sky-700 hover:underline"
        >
          {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
