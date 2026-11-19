// Administration data layer (Section 21, extended by Governance.html):
// tenant member/role management (identity-service, /identity) and tenant-wide
// workflow governance (design-service, /design). Role changes reach the
// member's login token at their next sign-in; every write is re-checked with
// identity-service (cached up to 30s), so a deactivated member or demoted
// admin stops writing within that time, not only at token expiry.
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
  return apiFetch<TenantMember[]>('/identity/members')
}

/** Replaces the email invite: a tenant admin sets the new member's username, password and role. */
export async function createUser(params: { username: string; password: string; role: Role }): Promise<void> {
  await apiFetch('/identity/members', { method: 'POST', body: JSON.stringify(params) })
}

export async function setUserRole(targetUserId: string, newRole: Role): Promise<void> {
  await apiFetch(`/identity/members/${targetUserId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role: newRole }),
  })
}

/** Replaces the member's task candidate groups. */
export async function setMemberGroups(targetUserId: string, groups: string[]): Promise<void> {
  await apiFetch(`/identity/members/${targetUserId}/groups`, {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  })
}

/** Governance.html Section 8: cut off a departing/paused member without deleting their row. */
export async function setMemberStatus(
  targetUserId: string,
  status: 'active' | 'deactivated',
): Promise<void> {
  await apiFetch(`/identity/members/${targetUserId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

export async function archiveWorkflow(workflowId: string): Promise<void> {
  await apiFetch(`/design/workflows/${workflowId}/archive`, { method: 'POST' })
}

export async function deleteWorkflowPermanently(workflowId: string): Promise<void> {
  await apiFetch(`/design/workflows/${workflowId}`, { method: 'DELETE' })
}
