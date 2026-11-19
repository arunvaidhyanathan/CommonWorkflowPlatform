// Workbench.html Section 2.1 / 5: "My Work" dashboard data. Deliberately
// reuses the existing workflows/approval_requests data layer rather than new
// queries or schema -- per the doc, everything here is derivable from data
// that already exists, filtered client-side (fine at current scale; a real
// search index is a later concern per Section 2.3).
import type { Role } from '../lib/useSession'
import { listWorkflows, type WorkflowSummary } from './workflows'
import { listPendingApprovals, type ApprovalRequest } from './approvals'

export interface MyWork {
  myDrafts: WorkflowSummary[]
  mySubmissions: WorkflowSummary[]
  recentlyEdited: WorkflowSummary[]
  waitingOnMe: ApprovalRequest[]
  allWorkflows: WorkflowSummary[]
}

const RECENT_LIMIT = 6

export async function getMyWork(
  tenantId: string,
  userId: string,
  role: Role | null,
): Promise<MyWork> {
  const allWorkflows = await listWorkflows(tenantId)

  const myDrafts = allWorkflows.filter((w) => w.createdBy === userId && w.status === 'draft')
  const mySubmissions = allWorkflows.filter(
    (w) => w.createdBy === userId && w.status === 'pending_approval',
  )
  const recentlyEdited = allWorkflows
    .filter((w) => w.createdBy === userId)
    .slice(0, RECENT_LIMIT)

  // "Waiting on me" only means something precise once the approver role
  // exists (Governance.html Section 3.2) -- before that, "any admin" was too
  // vague to surface as a personal queue, per Workbench.html Section 5.
  let waitingOnMe: ApprovalRequest[] = []
  if (role === 'approver') {
    const pending = await listPendingApprovals(tenantId)
    waitingOnMe = pending.filter((r) => r.requestedBy !== userId)
  }

  return { myDrafts, mySubmissions, recentlyEdited, waitingOnMe, allWorkflows }
}
