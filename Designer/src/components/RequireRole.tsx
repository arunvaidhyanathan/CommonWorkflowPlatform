// Client-side route guard for role-gated screens. This is a UX convenience,
// not the security boundary -- RLS policies on the underlying tables are
// what actually enforce access; this just avoids showing a broken screen to
// someone who navigates here directly without the right role.
//
// Governance.html Section 3.2: replaces the old admin-only RequireAdmin now
// that there's more than one governance role -- /admin stays tenant_admin
// only, /approvals is reachable by tenant_admin (oversight) and approver
// (who can actually decide requests).
import type { ReactNode } from 'react'
import { useSession, type Role } from '../lib/useSession'

export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { role, loading } = useSession()

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading...</div>
  }

  if (!role || !allow.includes(role)) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-slate-600">
        <h1 className="mb-2 text-base font-bold text-[#003b70]">Access Restricted</h1>
        <p>
          This area is limited to {allow.join(' / ')}. Ask a tenant administrator for access.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
