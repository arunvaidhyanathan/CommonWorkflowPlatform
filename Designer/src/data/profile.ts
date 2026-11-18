// Self-service profile data: the current user's own row, for things the JWT
// claims don't carry (display name, the Getting Started dismissal flag).
// Onboarding.html Section 3.2.
import { apiFetch } from '../lib/apiClient'

export interface MyProfile {
  id: string
  displayName: string | null
  onboardingDismissedAt: string | null
}

export async function getMyProfile(_userId: string): Promise<MyProfile | null> {
  return apiFetch<MyProfile>('/runtime/design/me')
}

export async function dismissGettingStarted(_userId: string): Promise<void> {
  await apiFetch('/runtime/design/me/dismiss-getting-started', { method: 'POST' })
}
