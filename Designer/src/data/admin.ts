// Administration data layer (Section 21, extended by Governance.html):
// tenant member/role management and tenant-wide workflow governance. Role
// writes go through the admin-set-role edge function -- the anon-key client
// cannot write auth.users.app_metadata directly, and profiles.role alone has
// no bearing on RLS (current_role_claim() reads the JWT claim, not this
// table), so the edge function is the only correct place for that write.
//
// Deactivate/reactivate (Governance.html Section 8) is a direct client
// update, unlike role changes -- it only touches profiles.status, which the
// "profiles admin update" RLS policy already permits a tenant_admin to do
// without needing a service-role edge function.
import { supabase } from '../lib/supabaseClient'
import type { Role } from '../lib/useSession'

export interface TenantMember {
  id: string
  role: Role
  displayName: string | null
  email: string | null
  status: 'active' | 'deactivated'
  createdAt: string
}

// Governance.html Section 8 / Designer.html Section 21.5: email now mirrors
// auth.users via the profiles_email_sync trigger, so the team list can show
// it directly instead of a raw user ID -- no second admin-scoped edge
// function needed just to look up emails.
export async function listTenantMembers(tenantId: string): Promise<TenantMember[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, display_name, email, status, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as Role,
    displayName: row.display_name,
    email: row.email,
    status: row.status as 'active' | 'deactivated',
    createdAt: row.created_at,
  }))
}

export async function setUserRole(targetUserId: string, newRole: Role): Promise<void> {
  const { data, error } = await supabase.functions.invoke('admin-set-role', {
    body: { targetUserId, newRole },
  })

  if (error) throw error
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String((data as { error: unknown }).error))
  }
}

/** Governance.html Section 8: cut off a departing/paused member without deleting their row. */
export async function setMemberStatus(
  targetUserId: string,
  status: 'active' | 'deactivated',
): Promise<void> {
  const { error } = await supabase.from('profiles').update({ status }).eq('id', targetUserId)
  if (error) throw error
}

export async function archiveWorkflow(workflowId: string): Promise<void> {
  const { error } = await supabase
    .from('workflows')
    .update({ status: 'archived' })
    .eq('id', workflowId)

  if (error) throw error
}

export async function deleteWorkflowPermanently(workflowId: string): Promise<void> {
  const { error } = await supabase.from('workflows').delete().eq('id', workflowId)
  if (error) throw error
}
