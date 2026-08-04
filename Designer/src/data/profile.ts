// Self-service profile data: the current user's own row, for things the JWT
// claims don't carry (display name, the Getting Started dismissal flag).
// Onboarding.html Section 3.2.
import { supabase } from '../lib/supabaseClient'

export interface MyProfile {
  id: string
  displayName: string | null
  onboardingDismissedAt: string | null
}

export async function getMyProfile(userId: string): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, onboarding_dismissed_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id,
    displayName: data.display_name,
    onboardingDismissedAt: data.onboarding_dismissed_at,
  }
}

export async function dismissGettingStarted(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_dismissed_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) throw error
}
