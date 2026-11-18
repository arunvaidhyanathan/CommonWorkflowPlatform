// Identity hook (Designer.html Section 2): the login session issued by
// workflow-runtime (POST /runtime/auth/login). Single source of truth for
// "who is this and which tenant are they in" across the app. The session is
// kept in localStorage so a reload stays signed in until the token expires.
import { useSyncExternalStore } from 'react'

// Governance.html Section 3.2: role values are designer / tenant_admin /
// approver / viewer -- tenant_admin renamed from the old flat 'admin', and
// approver split out as its own grant (decide-approval authority no longer
// comes bundled with tenant_admin).
export type Role = 'designer' | 'tenant_admin' | 'approver' | 'viewer'

export interface Session {
  token: string
  expiresAt: string
  user: { id: string; username: string; tenantId: string; role: Role }
}

export interface SessionInfo {
  session: Session | null
  userId: string | null
  tenantId: string | null
  role: Role | null
  loading: boolean
}

const STORAGE_KEY = 'cwp.session'
const listeners = new Set<() => void>()

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Session) : null
    return parsed && new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null
  } catch {
    return null
  }
}

let current: Session | null = readStored()

export function getSession(): Session | null {
  if (current && new Date(current.expiresAt).getTime() <= Date.now()) setSession(null)
  return current
}

export function setSession(session: Session | null): void {
  current = session
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable (private mode): the session lives in memory only
  }
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

export function useSession(): SessionInfo {
  const session = useSyncExternalStore(subscribe, getSession)
  return {
    session,
    userId: session?.user.id ?? null,
    tenantId: session?.user.tenantId ?? null,
    role: session?.user.role ?? null,
    loading: false,
  }
}
