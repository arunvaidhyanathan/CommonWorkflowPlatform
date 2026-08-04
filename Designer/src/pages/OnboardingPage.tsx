// Onboarding.html: the real /onboarding route. The four flows this doc
// describes mostly live elsewhere by design (invite-send is an Administration
// tab, invite-accept is a pre-login screen in App.tsx, empty-state imports
// live inline in Designer) -- this page is the one that needed a home of its
// own: a durable place to revisit the Getting Started checklist and jump to
// the other three, rather than a self-serve-tenant-creation screen (Section
// 6 Phase 3, deliberately not built yet).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../lib/useSession'
import { getMyProfile } from '../data/profile'

export function OnboardingPage() {
  const { userId, role } = useSession()
  const navigate = useNavigate()
  const [dismissedAt, setDismissedAt] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!userId) return
    getMyProfile(userId)
      .then((p) => setDismissedAt(p?.onboardingDismissedAt ?? null))
      .catch(() => setDismissedAt(null))
  }, [userId])

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-bold text-[#003b70]">Onboarding</h1>
      <p className="mb-6 text-sm text-slate-500">
        Getting a new tenant or a new teammate up and running.
      </p>

      <div className="mb-4 rounded-lg border border-sky-200 bg-white p-4">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
          Getting Started Checklist
        </h2>
        {dismissedAt ? (
          <p className="text-sm text-slate-500">
            You&apos;ve dismissed the checklist on the Designer workflow list. It only shows up
            once per person, but the shortcuts below still work any time.
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Still showing above your workflow list in Designer until you dismiss it or use every
            item.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/designer')}
            className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50"
          >
            Create or import a workflow
          </button>
          {role === 'tenant_admin' ? (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50"
            >
              Invite a teammate
            </button>
          ) : (
            <span className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-400">
              Invite a teammate -- ask your tenant admin
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-slate-600">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-600">
          How people join this tenant today
        </h2>
        <p>
          The only supported path in is an invite from a tenant admin (Administration &rarr;
          Invites), which emails a real signup link. There&apos;s no public self-serve
          &quot;create your own organization&quot; flow yet -- that&apos;s a deliberate,
          documented gap (Onboarding.html Section 6, Phase 3), not an oversight.
        </p>
      </div>
    </div>
  )
}
