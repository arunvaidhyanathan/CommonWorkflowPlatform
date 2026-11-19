// Approvals screen: tenant-wide queue of workflow versions submitted for
// design-time publish approval. Approve/reject writes only to
// approval_requests -- the DB trigger flips workflows.status accordingly
// (approved -> 'approved', rejected -> back to 'draft' for revision).
//
// Governance.html Section 3.2/4: decide authority now belongs to the
// approver role, not tenant_admin, and an approver can never decide their
// own submitted request -- enforced server-side by RLS, mirrored here so the
// restriction is visible before someone hits an error.
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../lib/useSession'
import { listPendingApprovals, decideApproval, type ApprovalRequest } from '../data/approvals'

export function ApprovalsPage() {
  const { userId, tenantId, role } = useSession()
  const canDecide = role === 'approver'

  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    try {
      setRequests(await listPendingApprovals(tenantId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load approval requests.')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onDecide = async (request: ApprovalRequest, decision: 'approved' | 'rejected') => {
    if (!userId) return
    setBusyId(request.id)
    setError(null)
    try {
      await decideApproval(request.id, decision, userId, comments[request.id])
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the decision.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-bold text-[#003b70]">Approvals</h1>
      <p className="mb-6 text-sm text-slate-500">
        Workflow versions waiting on a design-time publish decision, tenant-wide.
        {!canDecide && (
          <span className="block text-xs text-slate-400">
            You&apos;re viewing this read-only -- deciding requests requires the approver role.
          </span>
        )}
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading...</p>}

      <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
        {requests.length === 0 && !loading && (
          <p className="p-4 text-sm text-slate-500">Nothing pending approval right now.</p>
        )}
        {requests.map((request) => (
          <div key={request.id} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-800">
                  {request.workflowName}
                  {request.versionNo != null && (
                    <span className="ml-1.5 font-mono text-xs text-slate-400">
                      v{request.versionNo}
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-slate-500">{request.definitionKey}</div>
              </div>
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                {request.specType}
              </span>
            </div>
            <p className="mb-2 text-[11px] text-slate-400">
              Requested {new Date(request.requestedAt).toLocaleString()}
            </p>
            {(() => {
              const isOwnRequest = request.requestedBy === userId
              if (!canDecide) return null
              if (isOwnRequest) {
                return (
                  <p className="mb-2 text-[11px] font-semibold text-amber-600">
                    You submitted this request -- an approver can&apos;t decide their own
                    submission. Ask another approver.
                  </p>
                )
              }
              return (
                <>
                  <input
                    type="text"
                    placeholder="Optional comment for the requester"
                    value={comments[request.id] ?? ''}
                    onChange={(e) =>
                      setComments((prev) => ({ ...prev, [request.id]: e.target.value }))
                    }
                    className="mb-2 w-full rounded border border-sky-200 bg-sky-50 p-1.5 text-xs outline-none focus:border-sky-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onDecide(request, 'approved')}
                      disabled={busyId === request.id}
                      className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(request, 'rejected')}
                      disabled={busyId === request.id}
                      className="rounded border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Reject (back to draft)
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        ))}
      </div>
    </div>
  )
}
