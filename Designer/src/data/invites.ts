// Onboarding.html Section 2.2 / Governance.html Section 8: invite-into-an-
// existing-tenant data layer. Creating the invite is a privileged write
// (creates an auth.users row, sets its app_metadata) so it goes through the
// invite-user edge function, same pattern as admin-set-role. Listing and
// revoking a still-pending invite are plain tenant-scoped reads/updates the
// anon-key client can do directly under RLS.
import { supabase } from '../lib/supabaseClient'
import type { Role } from '../lib/useSession'

export interface Invite {
  id: string
  email: string
  role: Role
  status: 'invited' | 'accepted' | 'revoked'
  invitedBy: string | null
  createdAt: string
  acceptedAt: string | null
}

export async function listInvites(tenantId: string): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('id, email, role, status, invited_by, created_at, accepted_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role as Role,
    status: row.status as Invite['status'],
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  }))
}

export async function createInvite(params: { email: string; role: Role }): Promise<void> {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: {
      email: params.email,
      role: params.role,
      // Lets the invited person's email link land back on wherever this app
      // is actually being served from, instead of a hardcoded URL.
      redirectTo: window.location.origin,
    },
  })

  if (error) throw error
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String((data as { error: unknown }).error))
  }
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)

  if (error) throw error
}
