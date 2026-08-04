// Governance.html Section 7: read side of the audit log. Rows are written
// exclusively by DB triggers (profiles/workflows/approval_requests) or, for
// role changes, directly by the admin-set-role edge function -- this module
// is read-only by design, matching the RLS policy (tenant_admin SELECT only).
import { supabase } from '../lib/supabaseClient'

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

export async function listAuditLog(tenantId: string, limit = 100): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select(
      'id, actor_id, action, entity_type, entity_id, before, after, occurred_at, profiles(email)',
    )
    .eq('tenant_id', tenantId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => {
    const actor = row.profiles as unknown as { email: string | null } | null
    return {
      id: row.id,
      actorId: row.actor_id,
      actorEmail: actor?.email ?? null,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: row.before,
      after: row.after,
      occurredAt: row.occurred_at,
    }
  })
}
