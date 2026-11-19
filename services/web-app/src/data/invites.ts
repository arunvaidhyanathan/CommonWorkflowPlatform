// Invites history (Onboarding.html Section 2.2 / Governance.html Section 8).
// New members are created directly by a tenant admin (admin.ts createUser),
// which records an accepted invite here; this module lists and revokes.
import { apiFetch } from '../lib/apiClient'
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

export async function listInvites(_tenantId: string): Promise<Invite[]> {
  return apiFetch<Invite[]>('/identity/invites')
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await apiFetch(`/identity/invites/${inviteId}/revoke`, { method: 'POST' })
}
