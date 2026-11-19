// Governance.html Section 7: read side of the audit log (design-service).
// Rows are written by DB triggers (workflows/approval_requests) or, for role
// and status changes, by identity-service -- this module is read-only by
// design (tenant_admin only). Actors are ids only.
import { apiFetch } from '../lib/apiClient'

export interface AuditLogEntry {
  id: string
  actorId: string | null
  action: string
  entityType: string
  entityId: string | null
  before: unknown
  after: unknown
  occurredAt: string
}

export async function listAuditLog(_tenantId: string, limit = 100): Promise<AuditLogEntry[]> {
  return apiFetch<AuditLogEntry[]>(`/design/audit?limit=${limit}`)
}
