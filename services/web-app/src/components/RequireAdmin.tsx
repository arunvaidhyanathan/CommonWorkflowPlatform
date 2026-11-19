// Superseded by RequireRole.tsx (Governance.html Section 3.2 introduced the
// approver role, so a single "admin-only" gate no longer covers every
// governance screen -- /approvals needs to admit approvers too). Kept as a
// thin shim in case anything still imports the old name; App.tsx itself now
// uses RequireRole directly.
import type { ReactNode } from 'react'
import { RequireRole } from './RequireRole'

export function RequireAdmin({ children }: { children: ReactNode }) {
  return <RequireRole allow={['tenant_admin']}>{children}</RequireRole>
}
