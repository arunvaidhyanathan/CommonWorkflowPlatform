// Design-time approval workflow (Section 21): a workflow version moves
// draft -> pending_approval -> approved (or back to draft on rejection).
// approval_requests is the audit trail; the DB trigger
// sync_workflow_status_from_approval keeps workflows.status consistent with
// it atomically, so this layer only ever writes to approval_requests.
import { apiFetch } from '../lib/apiClient'

export interface ApprovalRequest {
  id: string
  workflowId: string
  versionId: string
  status: 'pending' | 'approved' | 'rejected'
  requestedBy: string | null
  requestedAt: string
  approverId: string | null
  decidedAt: string | null
  comment: string | null
  workflowName: string
  definitionKey: string
  specType: string
  versionNo: number | null
}

export async function submitForApproval(params: {
  tenantId: string
  workflowId: string
  versionId: string
  requestedBy: string
}): Promise<void> {
  await apiFetch('/runtime/design/approvals', {
    method: 'POST',
    body: JSON.stringify({ workflowId: params.workflowId, versionId: params.versionId }),
  })
}

export async function listPendingApprovals(_tenantId: string): Promise<ApprovalRequest[]> {
  return apiFetch<ApprovalRequest[]>('/runtime/design/approvals/pending')
}

export async function decideApproval(
  requestId: string,
  decision: 'approved' | 'rejected',
  _approverId: string,
  comment?: string,
): Promise<void> {
  await apiFetch(`/runtime/design/approvals/${requestId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, comment: comment ?? null }),
  })
}
