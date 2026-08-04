import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Onboarding.html Section 2.2/2.3: captured before any Supabase code runs
// (and before it strips the invite/recovery tokens from the URL during its
// own async init), so App.tsx can reliably tell "this session came from an
// invite link" apart from "this is a normal returning-user session".
export const initialUrlHash = typeof window !== 'undefined' ? window.location.hash : ''

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check .env.local.',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
