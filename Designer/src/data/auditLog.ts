// Governance.html Section 7: read side of the audit log. Rows are written
// by DB triggers (profiles/workflows/approval_requests) or, for role
// changes, by workflow-runtime -- this module is read-only by design
// (tenant_admin only).
import { apiFetch } from '../lib/apiClient'

export interface AuditLogEntry {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: string
  entityType: string
  entityId: string | null
  before: unknown
  after: unknown
  occurredAt: string
}

export async function listAuditLog(_tenantId: string, limit = 100): Promise<AuditLogEntry[]> {
  return apiFetch<AuditLogEntry[]>(`/runtime/design/audit?limit=${limit}`)
}
