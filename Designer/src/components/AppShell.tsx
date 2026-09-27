// Application shell (header + sidebar navigation). Wraps every authenticated
// route so the whole app -- not just the Designer -- is reachable from one
// place. Agentic-Designer is a real route today but renders a placeholder
// screen until it's built out; Workflow Wrapper became real as of
// WorkflowWrapper.html Section 9 Phase 8 (WorkflowWrapperPage.tsx).
// Administration is gated to tenant_admin, Approvals to tenant_admin
// (read) + approver (decide) -- Governance.html Section 3.2.
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useSession, type Role } from '../lib/useSession'
import { supabase } from '../lib/supabaseClient'
import { listPendingApprovals } from '../data/approvals'

interface NavItem {
  to: string
  label: string
  allow?: Role[]
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/designer', label: 'Designer' },
  { to: '/onboarding', label: 'Onboarding' },
  { to: '/workbench', label: 'Workbench' },
  { to: '/workflow-wrapper', label: 'Workflow Wrapper' },
]

const GOVERNANCE_NAV: NavItem[] = [
  { to: '/admin', label: 'Administration', allow: ['tenant_admin'] },
  { to: '/approvals', label: 'Approvals', allow: ['tenant_admin', 'approver'] },
  { to: '/spend', label: 'API Spend', allow: ['tenant_admin'] },
]

function NavSection({
  items,
  role,
  badges,
}: {
  items: NavItem[]
  role: Role | null
  badges: Record<string, number>
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const locked = item.allow && (!role || !item.allow.includes(role))
        const badge = badges[item.to]
        if (locked) {
          return (
            <span
              key={item.to}
              title={`Requires ${item.allow?.join(' or ')}`}
              className="cursor-not-allowed rounded px-3 py-1.5 text-sm text-slate-400"
            >
              {item.label}
            </span>
          )
        }
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center justify-between rounded px-3 py-1.5 text-sm font-medium ${
                isActive
                  ? 'bg-[#0066b2] text-white'
                  : 'text-slate-700 hover:bg-sky-100 hover:text-[#003b70]'
              }`
            }
          >
            <span>{item.label}</span>
            {!!badge && (
              <span className="ml-2 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {badge}
              </span>
            )}
          </NavLink>
        )
      })}
    </div>
  )
}

export function AppShell() {
  const { session, userId, tenantId, role } = useSession()
  const [badges, setBadges] = useState<Record<string, number>>({})

  // Workbench.html Section 2.4: start small -- badge counts on existing
  // nav items rather than a full notification center.
  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    listPendingApprovals(tenantId)
      .then((pending) => {
        if (cancelled) return
        const waitingOnMe =
          role === 'approver' ? pending.filter((r) => r.requestedBy !== userId).length : 0
        setBadges({
          '/approvals': pending.length,
          '/workbench': waitingOnMe,
        })
      })
      .catch(() => {
        if (!cancelled) setBadges({})
      })
    return () => {
      cancelled = true
    }
  }, [tenantId, userId, role])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-sky-200 bg-[#003b70] px-4">
        <div className="flex items-center gap-2 text-white">
          <span className="text-sm font-bold tracking-wide">WaaS</span>
          <span className="text-xs text-sky-200">Multi-Spec Workflow Designer</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-sky-100">
          {tenantId && (
            <span className="rounded bg-white/10 px-2 py-1 font-mono text-[10px]">
              tenant: {tenantId.slice(0, 8)}
            </span>
          )}
          {role && (
            <span className="rounded bg-white/10 px-2 py-1 text-[10px] font-bold uppercase">
              {role.replace('_', ' ')}
            </span>
          )}
          <span className="text-sky-200">{session?.user?.email}</span>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="rounded border border-white/30 px-2 py-1 text-[11px] text-white hover:bg-white/10"
          >
            Sign Out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-sky-200 bg-sky-50 p-3">
          <NavSection items={PRIMARY_NAV} role={role} badges={badges} />
          <div className="border-t border-sky-200 pt-3">
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Governance
            </div>
            <NavSection items={GOVERNANCE_NAV} role={role} badges={badges} />
          </div>
        </nav>

        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
