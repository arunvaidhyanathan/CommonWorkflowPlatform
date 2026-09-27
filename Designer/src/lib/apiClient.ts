// Client for CWP's own backend services, reached through the nginx edge
// gateway (gateway/ at the repo root). VITE_API_BASE_URL is the gateway's
// /api prefix -- e.g. http://localhost:8080/api in Vite dev, or /api when the
// SPA is served by the gateway itself -- and each service lives under its own
// path: /runtime/** -> workflow-runtime, /agent/** -> agentic-designer.
// Unlike supabaseClient.ts, this does NOT throw at import time if
// unconfigured; the rest of the app must keep working without these services.
// Every call attaches the current Supabase session's access token as a
// Bearer token -- WorkflowWrapper.html Section 7's "Single Token, Two
// Planes" pattern: the same JWT that authorizes Postgres RLS also
// authorizes each service, validated there against Supabase's JWKS.
import { supabase } from './supabaseClient'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
  /\/$/,
  '',
)

export class ApiNotConfiguredError extends Error {
  constructor() {
    super(
      'The Runtime Gateway is not configured (VITE_API_BASE_URL is unset). ' +
        'This is expected until the service in WaaS/Workflow-Wrapper is actually deployed somewhere -- see that project\'s README.md.',
    )
    this.name = 'ApiNotConfiguredError'
  }
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `CWP API request failed (HTTP ${status}).`
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('No active session -- cannot call the CWP API unauthenticated.')
  return { Authorization: `Bearer ${token}` }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!API_BASE_URL) throw new ApiNotConfiguredError()

  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
    ...(init?.headers ?? {}),
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })

  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // non-JSON error body (e.g. nginx's own 502 page when a service is down) -- fall through with null
    }
    throw new ApiError(res.status, body)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function isApiConfigured(): boolean {
  return Boolean(API_BASE_URL)
}
