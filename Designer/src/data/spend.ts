// API spend tracker (SpendTracker.html), read side: /api/spend via the
// gateway. The service decides scope from the JWT: tenant admins get their
// own tenant; platform admins (SPEND_ADMIN_USER_IDS) get everything and the
// key health list, which answers 403 for everyone else.
import { apiFetch, ApiError } from '../lib/apiClient'

export interface SpendMeasures {
  calls: number
  okCalls: number
  rateLimitedCalls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  // Exact decimal string, priced calls only. Unpriced calls are counted in
  // unpricedCalls and never folded into this total.
  costUsd: string
  unpricedCalls: number
}

export interface SpendSummary {
  scope: 'platform' | 'tenant'
  tenantId: string | null
  start: string
  end: string
  total: SpendMeasures
  byProvider: (SpendMeasures & { provider: string })[]
  byModel: (SpendMeasures & { provider: string; model: string })[]
  byFeature: (SpendMeasures & { service: string; feature: string })[]
  byTenant: (SpendMeasures & { tenantId: string })[]
  daily: { day: string; calls: number; costUsd: string }[]
}

export interface KeyStatus {
  keyAlias: string
  provider: string
  status: 'valid' | 'expired' | 'invalid' | 'missing' | 'error'
  httpStatus: number | null
  detail: string | null
  checkedAt: string
  lastCallOutcome: 'ok' | 'rate_limited' | 'error' | 'empty' | null
  lastCallAt: string | null
  lastOkCallAt: string | null
}

export function getSpendSummary(from: Date, to: Date): Promise<SpendSummary> {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
  return apiFetch<SpendSummary>(`/spend/summary?${params}`)
}

/** null when the viewer isn't a platform admin (the service answers 403). */
export async function getKeyStatus(): Promise<KeyStatus[] | null> {
  try {
    return await apiFetch<KeyStatus[]>('/spend/keys')
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return null
    throw err
  }
}

export function runKeyChecks(): Promise<{ keyAlias: string; status: string }[]> {
  return apiFetch('/spend/keys/check', { method: 'POST' })
}
