// Administration data layer (Section 21, extended by Governance.html):
// tenant member/role management and tenant-wide workflow governance, via
// workflow-runtime's /runtime/design API. Role changes take effect at the
// member's next sign-in (the role rides in their login token); the service
// re-reads role and status from the database for every write, so a
// deactivated member or demoted admin can't keep writing in the meantime.
import { apiFetch } from '../lib/apiClient'
import type { Role } from '../lib/useSession'

export interface TenantMember {
  id: string
  role: Role
  displayName: string | null
  email: string | null
  status: 'active' | 'deactivated'
  createdAt: string
  // Runtime task candidate groups (the role is always an implicit extra group).
  groups: string[]
}

export async function listTenantMembers(_tenantId: string): Promise<TenantMember[]> {
  return apiFetch<TenantMember[]>('/runtime/design/members')
}

/** Replaces the email invite: a tenant admin sets the new member's username, password and role. */
export async function createUser(params: { username: string; password: string; role: Role }): Promise<void> {
  await apiFetch('/runtime/design/members', { method: 'POST', body: JSON.stringify(params) })
}

export async function setUserRole(targetUserId: string, newRole: Role): Promise<void> {
  await apiFetch(`/runtime/design/members/${targetUserId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role: newRole }),
  })
}

/** Replaces the member's task candidate groups. */
export async function setMemberGroups(targetUserId: string, groups: string[]): Promise<void> {
  await apiFetch(`/runtime/design/members/${targetUserId}/groups`, {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  })
}

/** Governance.html Section 8: cut off a departing/paused member without deleting their row. */
export async function setMemberStatus(
  targetUserId: string,
  status: 'active' | 'deactivated',
): Promise<void> {
  await apiFetch(`/runtime/design/members/${targetUserId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

export async function archiveWorkflow(workflowId: string): Promise<void> {
  await apiFetch(`/runtime/design/workflows/${workflowId}/archive`, { method: 'POST' })
}

export async function deleteWorkflowPermanently(workflowId: string): Promise<void> {
  await apiFetch(`/runtime/design/workflows/${workflowId}`, { method: 'DELETE' })
}
