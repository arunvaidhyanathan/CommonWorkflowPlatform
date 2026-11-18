// Client for CWP's own backend services, reached through the nginx edge
// gateway (gateway/ at the repo root). VITE_API_BASE_URL is the gateway's
// /api prefix -- e.g. http://localhost:8080/api in Vite dev, or /api when the
// SPA is served by the gateway itself -- and each service lives under its own
// path: /runtime/** -> workflow-runtime, /agent/** -> agentic-designer.
// Every call attaches the login token issued by workflow-runtime
// (POST /runtime/auth/login) as a Bearer token; each service verifies it.
import { getSession, setSession, type Session } from './useSession'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
  /\/$/,
  '',
)

export class ApiNotConfiguredError extends Error {
  constructor() {
    super(
      'The CWP API is not configured (VITE_API_BASE_URL is unset). ' +
        'Start the stack with `docker compose up` at the repo root and point this at the gateway -- see README.md.',
    )
    this.name = 'ApiNotConfiguredError'
  }
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    // workflow-runtime (Spring) errors carry `message`; agentic-designer
    // (FastAPI) errors carry `detail`, a string for the errors it raises itself.
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const message =
      typeof fields.message === 'string'
        ? fields.message
        : typeof fields.detail === 'string'
          ? fields.detail
          : `CWP API request failed (HTTP ${status}).`
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = getSession()?.token
  if (!token) throw new Error('No active session -- cannot call the CWP API unauthenticated.')
  return { Authorization: `Bearer ${token}` }
}

/** Exchanges a username and password for a session (no Bearer token needed). */
export async function login(username: string, password: string): Promise<void> {
  if (!API_BASE_URL) throw new ApiNotConfiguredError()
  const res = await fetch(`${API_BASE_URL}/runtime/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // non-JSON body (gateway error page) -- fall through with null
  }
  if (!res.ok) throw new ApiError(res.status, body)
  setSession(body as Session)
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
    // The token is no longer accepted (expired or re-keyed): back to the login screen.
    if (res.status === 401) setSession(null)
    throw new ApiError(res.status, body)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function isApiConfigured(): boolean {
  return Boolean(API_BASE_URL)
}

export interface ServerSentEvent {
  event: string
  data: unknown
}

/**
 * POSTs JSON and reads a text/event-stream response, calling onEvent for
 * each event as it arrives. Not EventSource: that can't send the
 * Authorization header. Non-2xx responses throw ApiError before any event.
 */
export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (event: ServerSentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!API_BASE_URL) throw new ApiNotConfiguredError()

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok || !res.body) {
    let errorBody: unknown = null
    try {
      errorBody = await res.json()
    } catch {
      // non-JSON error body -- fall through with null
    }
    throw new ApiError(res.status, errorBody)
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let boundary: number
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let event = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      // Blocks with no data are keepalive comments (": keepalive") sent while
      // a slow model works; they carry nothing for the caller.
      if (!data) continue
      onEvent({ event, data: JSON.parse(data) })
    }
  }
}
