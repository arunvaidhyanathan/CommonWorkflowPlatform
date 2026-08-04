// Administration screen: tenant member/role management, invites, and
// tenant-wide workflow governance (archive/delete regardless of who created
// them), plus an audit log tab. Reached only via /admin, which RequireRole
// gates client-side to tenant_admin; the real enforcement is server-side
// (RLS + the admin-set-role / invite-user edge functions).
//
// Governance.html Section 3.2 (roles), Section 7 (audit log), Section 8
// (invite/deactivate). Onboarding.html Section 2.2/3.3 (invite flow, role
// descriptions).
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../lib/useSession'
import type { Role } from '../lib/useSession'
import {
  listTenantMembers,
  setUserRole,
  setMemberStatus,
  archiveWorkflow,
  deleteWorkflowPermanently,
  type TenantMember,
} from '../data/admin'
import { listWorkflows, type WorkflowSummary } from '../data/workflows'
import { listInvites, createInvite, revokeInvite, type Invite } from '../data/invites'
import { listAuditLog, type AuditLogEntry } from '../data/auditLog'

const ROLES: { value: Role; description: string }[] = [
  { value: 'designer', description: 'Can create and edit workflows, and submit them for approval.' },
  { value: 'approver', description: 'Can approve or reject submitted changes (not their own).' },
  { value: 'tenant_admin', description: 'Manages team roles, tenant settings, and can archive/delete any workflow.' },
  { value: 'viewer', description: 'Can see workflows but not change them.' },
]

const ROLE_LABEL: Record<Role, string> = {
  designer: 'Designer',
  tenant_admin: 'Tenant Admin',
  approver: 'Approver',
  viewer: 'Viewer',
}

type TabKey = 'team' | 'invites' | 'workflows' | 'audit'

export function AdministrationPage() {
  const { userId, tenantId } = useSession()
  const [tab, setTab] = useState<TabKey>('team')

  const [members, setMembers] = useState<TenantMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [roleSaving, setRoleSaving] = useState<string | null>(null)
  const [statusSaving, setStatusSaving] = useState<string | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [workflowsLoading, setWorkflowsLoading] = useState(false)
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const [invites, setInvites] = useState<Invite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('designer')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)

  const refreshMembers = useCallback(async () => {
    if (!tenantId) return
    setMembersLoading(true)
    setMembersError(null)
    try {
      setMembers(await listTenantMembers(tenantId))
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Could not load tenant members.')
    } finally {
      setMembersLoading(false)
    }
  }, [tenantId])

  const refreshWorkflows = useCallback(async () => {
    if (!tenantId) return
    setWorkflowsLoading(true)
    setWorkflowsError(null)
    try {
      setWorkflows(await listWorkflows(tenantId))
    } catch (err) {
      setWorkflowsError(err instanceof Error ? err.message : 'Could not load workflows.')
    } finally {
      setWorkflowsLoading(false)
    }
  }, [tenantId])

  const refreshInvites = useCallback(async () => {
    if (!tenantId) return
    setInvitesLoading(true)
    setInvitesError(null)
    try {
      setInvites(await listInvites(tenantId))
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Could not load invites.')
    } finally {
      setInvitesLoading(false)
    }
  }, [tenantId])

  const refreshAuditLog = useCallback(async () => {
    if (!tenantId) return
    setAuditLoading(true)
    setAuditError(null)
    try {
      setAuditLog(await listAuditLog(tenantId))
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Could not load the audit log.')
    } finally {
      setAuditLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    refreshMembers()
    refreshWorkflows()
    refreshInvites()
  }, [refreshMembers, refreshWorkflows, refreshInvites])

  useEffect(() => {
    if (tab === 'audit') refreshAuditLog()
  }, [tab, refreshAuditLog])

  const onRoleChange = async (member: TenantMember, newRole: string) => {
    setRoleSaving(member.id)
    setMembersError(null)
    try {
      await setUserRole(member.id, newRole as Role)
      await refreshMembers()
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Could not update role.')
    } finally {
      setRoleSaving(null)
    }
  }

  const onToggleStatus = async (member: TenantMember) => {
    const nextStatus = member.status === 'active' ? 'deactivated' : 'active'
    if (
      nextStatus === 'deactivated' &&
      !confirm(`Deactivate ${member.displayName || member.id}? They'll lose write access immediately.`)
    ) {
      return
    }
    setStatusSaving(member.id)
    setMembersError(null)
    try {
      await setMemberStatus(member.id, nextStatus)
      await refreshMembers()
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Could not update status.')
    } finally {
      setStatusSaving(null)
    }
  }

  const onSendInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviteSending(true)
    setInvitesError(null)
    setInviteSuccess(null)
    try {
      await createInvite({ email: inviteEmail.trim(), role: inviteRole })
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}.`)
      setInviteEmail('')
      await refreshInvites()
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Could not send the invite.')
    } finally {
      setInviteSending(false)
    }
  }

  const onRevokeInvite = async (invite: Invite) => {
    setInvitesError(null)
    try {
      await revokeInvite(invite.id)
      await refreshInvites()
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Could not revoke the invite.')
    }
  }

  const onArchive = async (wf: WorkflowSummary) => {
    setRowBusy(wf.id)
    setWorkflowsError(null)
    try {
      await archiveWorkflow(wf.id)
      await refreshWorkflows()
    } catch (err) {
      setWorkflowsError(err instanceof Error ? err.message : 'Could not archive workflow.')
    } finally {
      setRowBusy(null)
    }
  }

  const onDelete = async (wf: WorkflowSummary) => {
    if (!confirm(`Permanently delete "${wf.name}"? This cannot be undone.`)) return
    setRowBusy(wf.id)
    setWorkflowsError(null)
    try {
      await deleteWorkflowPermanently(wf.id)
      await refreshWorkflows()
    } catch (err) {
      setWorkflowsError(err instanceof Error ? err.message : 'Could not delete workflow.')
    } finally {
      setRowBusy(null)
    }
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'team', label: 'Team & Roles' },
    { key: 'invites', label: 'Invites' },
    { key: 'workflows', label: 'Workflow Governance' },
    { key: 'audit', label: 'Audit Log' },
  ]

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-bold text-[#003b70]">Administration</h1>
      <p className="mb-4 text-sm text-slate-500">
        Team roles, invites, and tenant-wide workflow governance for your organization.
      </p>

      <div className="mb-6 flex gap-1 border-b border-sky-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-t px-3 py-2 text-sm font-semibold ${
              tab === t.key
                ? 'border-b-2 border-[#0066b2] text-[#0066b2]'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        <section>
          {membersError && <p className="mb-2 text-sm text-red-600">{membersError}</p>}
          {membersLoading && <p className="text-sm text-slate-500">Loading...</p>}
          <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
            {members.length === 0 && !membersLoading && (
              <p className="p-4 text-sm text-slate-500">No tenant members found.</p>
            )}
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">
                    {member.email || member.displayName || 'Unnamed user'}
                    {member.id === userId && (
                      <span className="ml-2 text-[10px] font-normal text-slate-400">(you)</span>
                    )}
                    {member.status === 'deactivated' && (
                      <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                        Deactivated
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-slate-400">
                    {member.displayName || <span className="font-mono">{member.id}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={member.role}
                    disabled={roleSaving === member.id || member.id === userId}
                    onChange={(e) => onRoleChange(member, e.target.value)}
                    title={member.id === userId ? "You can't change your own role here" : undefined}
                    className="rounded border border-sky-200 bg-white px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {ROLE_LABEL[r.value]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onToggleStatus(member)}
                    disabled={statusSaving === member.id || member.id === userId}
                    title={member.id === userId ? "You can't deactivate yourself" : undefined}
                    className={`rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-50 ${
                      member.status === 'active'
                        ? 'border-amber-300 bg-white text-amber-700 hover:bg-amber-50'
                        : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {member.status === 'active' ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Email mirrors Supabase Auth via a sync trigger (kept up to date automatically, not
            directly editable). Display name falls back to the raw user ID until someone sets one.
          </p>
          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-slate-600">
            <div className="mb-1 font-bold uppercase tracking-wide text-slate-500">
              What each role can do
            </div>
            <ul className="space-y-0.5">
              {ROLES.map((r) => (
                <li key={r.value}>
                  <strong>{ROLE_LABEL[r.value]}</strong> -- {r.description}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === 'invites' && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">
            Invite a Teammate
          </h2>
          <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-sky-200 bg-white p-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-500">Email</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="w-64 rounded border border-sky-200 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-500">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="rounded border border-sky-200 px-2 py-1.5 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {ROLE_LABEL[r.value]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={onSendInvite}
              disabled={inviteSending || !inviteEmail.trim()}
              className="rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
            >
              {inviteSending ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
          <p className="mb-1 text-[11px] text-slate-400">
            {ROLES.find((r) => r.value === inviteRole)?.description}
          </p>
          {inviteSuccess && <p className="mb-2 text-sm text-emerald-600">{inviteSuccess}</p>}
          {invitesError && <p className="mb-2 text-sm text-red-600">{invitesError}</p>}

          <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-600">
            Pending &amp; Past Invites
          </h2>
          {invitesLoading && <p className="text-sm text-slate-500">Loading...</p>}
          <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
            {invites.length === 0 && !invitesLoading && (
              <p className="p-4 text-sm text-slate-500">No invites sent yet.</p>
            )}
            {invites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{invite.email}</div>
                  <div className="text-[11px] text-slate-400">
                    {ROLE_LABEL[invite.role]} &middot; sent{' '}
                    {new Date(invite.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                      invite.status === 'invited'
                        ? 'bg-amber-100 text-amber-700'
                        : invite.status === 'accepted'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {invite.status}
                  </span>
                  {invite.status === 'invited' && (
                    <button
                      type="button"
                      onClick={() => onRevokeInvite(invite)}
                      className="rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'workflows' && (
        <section>
          {workflowsError && <p className="mb-2 text-sm text-red-600">{workflowsError}</p>}
          {workflowsLoading && <p className="text-sm text-slate-500">Loading...</p>}
          <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
            {workflows.length === 0 && !workflowsLoading && (
              <p className="p-4 text-sm text-slate-500">No workflows in this tenant yet.</p>
            )}
            {workflows.map((wf) => (
              <div key={wf.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{wf.name}</div>
                  <div className="truncate font-mono text-xs text-slate-500">
                    {wf.definitionKey}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                    {wf.specType}
                  </span>
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700">
                    {wf.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => onArchive(wf)}
                    disabled={rowBusy === wf.id || wf.status === 'archived'}
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(wf)}
                    disabled={rowBusy === wf.id}
                    className="rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'audit' && (
        <section>
          {auditError && <p className="mb-2 text-sm text-red-600">{auditError}</p>}
          {auditLoading && <p className="text-sm text-slate-500">Loading...</p>}
          <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
            {auditLog.length === 0 && !auditLoading && (
              <p className="p-4 text-sm text-slate-500">No audited activity yet.</p>
            )}
            {auditLog.map((entry) => (
              <div key={entry.id} className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">
                    {entry.action.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {new Date(entry.occurredAt).toLocaleString()}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  {entry.entityType} {entry.entityId?.slice(0, 8)}
                  {(entry.actorEmail || entry.actorId) && (
                    <> &middot; by {entry.actorEmail ?? entry.actorId?.slice(0, 8)}</>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Role changes, deactivations, workflow deletes/archives, approval decisions, and
            automatic status resets on stale approved workflows are recorded here
            (Governance.html Section 7). Some actions -- like a role change applied via the
            admin-set-role edge function -- attribute the actor directly, so the email always
            resolves even without a live join.
          </p>
        </section>
      )}
    </div>
  )
}
