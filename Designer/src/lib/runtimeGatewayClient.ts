// Client for the Runtime Gateway (WorkflowWrapper.html): the new Java 21 /
// Spring Boot 4 service, a second backend alongside Supabase. Unlike
// supabaseClient.ts, this does NOT throw at import time if unconfigured --
// the gateway is a new, optional-so-far integration (Phase 1/2 only), and
// the rest of the app must keep working even before it's deployed anywhere.
// Every call attaches the current Supabase session's access token as a
// Bearer token -- WorkflowWrapper.html Section 7's "Single Token, Two
// Planes" pattern: the same JWT that authorizes Postgres RLS also
// authorizes the gateway, validated there against Supabase's JWKS.
import { supabase } from './supabaseClient'

const RUNTIME_GATEWAY_URL = (import.meta.env.VITE_RUNTIME_GATEWAY_URL as string | undefined)?.replace(
  /\/$/,
  '',
)

export class RuntimeGatewayNotConfiguredError extends Error {
  constructor() {
    super(
      'The Runtime Gateway is not configured (VITE_RUNTIME_GATEWAY_URL is unset). ' +
        'This is expected until the service in WaaS/Workflow-Wrapper is actually deployed somewhere -- see that project\'s README.md.',
    )
    this.name = 'RuntimeGatewayNotConfiguredError'
  }
}

export class RuntimeGatewayError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Runtime Gateway request failed (HTTP ${status}).`
    super(message)
    this.name = 'RuntimeGatewayError'
    this.status = status
    this.body = body
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('No active session -- cannot call the Runtime Gateway unauthenticated.')
  return { Authorization: `Bearer ${token}` }
}

export async function runtimeGatewayFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!RUNTIME_GATEWAY_URL) throw new RuntimeGatewayNotConfiguredError()

  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
    ...(init?.headers ?? {}),
  }

  const res = await fetch(`${RUNTIME_GATEWAY_URL}${path}`, { ...init, headers })

  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // non-JSON error body (e.g. the gateway is entirely unreachable) -- fall through with null
    }
    throw new RuntimeGatewayError(res.status, body)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function isRuntimeGatewayConfigured(): boolean {
  return Boolean(RUNTIME_GATEWAY_URL)
}
