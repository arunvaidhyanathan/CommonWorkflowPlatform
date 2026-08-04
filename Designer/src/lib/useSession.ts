// Identity hook (Designer.html Section 2): reads the Supabase session and
// derives tenant_id/role from app_metadata claims. Single source of truth
// for "who is this and which tenant are they in" across the app.
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

// Governance.html Section 3.2: role values are designer / tenant_admin /
// approver / viewer -- tenant_admin renamed from the old flat 'admin', and
// approver split out as its own grant (decide-approval authority no longer
// comes bundled with tenant_admin).
export type Role = 'designer' | 'tenant_admin' | 'approver' | 'viewer'

export interface SessionInfo {
  session: Session | null
  userId: string | null
  tenantId: string | null
  role: Role | null
  loading: boolean
}

export function useSession(): SessionInfo {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  const appMetadata = session?.user?.app_metadata as
    | { tenant_id?: string; role?: Role }
    | undefined

  return {
    session,
    userId: session?.user?.id ?? null,
    tenantId: appMetadata?.tenant_id ?? null,
    role: appMetadata?.role ?? null,
    loading,
  }
}
