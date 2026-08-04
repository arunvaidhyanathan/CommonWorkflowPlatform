// Design-time approval workflow (Section 21): a workflow version moves
// draft -> pending_approval -> approved (or back to draft on rejection).
// approval_requests is the audit trail; the DB trigger
// sync_workflow_status_from_approval keeps workflows.status consistent with
// it atomically, so this layer only ever writes to approval_requests.
import { supabase } from '../lib/supabaseClient'

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
  const { error } = await supabase.from('approval_requests').insert({
    tenant_id: params.tenantId,
    workflow_id: params.workflowId,
    version_id: params.versionId,
    requested_by: params.requestedBy,
  })

  if (error) throw error
}

export async function listPendingApprovals(tenantId: string): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase
    .from('approval_requests')
    .select(
      'id, workflow_id, version_id, status, requested_by, requested_at, approver_id, decided_at, comment, workflows(name, definition_key, spec_type), workflow_versions(version_no)',
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => {
    const workflow = row.workflows as unknown as {
      name: string
      definition_key: string
      spec_type: string
    } | null
    const version = row.workflow_versions as unknown as { version_no: number } | null

    return {
      id: row.id,
      workflowId: row.workflow_id,
      versionId: row.version_id,
      status: row.status as ApprovalRequest['status'],
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      approverId: row.approver_id,
      decidedAt: row.decided_at,
      comment: row.comment,
      workflowName: workflow?.name ?? 'Unknown workflow',
      definitionKey: workflow?.definition_key ?? '',
      specType: workflow?.spec_type ?? '',
      versionNo: version?.version_no ?? null,
    }
  })
}

export async function decideApproval(
  requestId: string,
  decision: 'approved' | 'rejected',
  approverId: string,
  comment?: string,
): Promise<void> {
  const { error } = await supabase
    .from('approval_requests')
    .update({
      status: decision,
      approver_id: approverId,
      decided_at: new Date().toISOString(),
      comment: comment ?? null,
    })
    .eq('id', requestId)

  if (error) throw error
}
