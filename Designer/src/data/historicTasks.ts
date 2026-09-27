// Runtime-layer data (WorkflowWrapper.html Section 8, row 4; Governance.html
// Section 11.2's engine-history roadmap item). Calls the Runtime Gateway's
// real, embedded (BPMN) HistoryService -- not a stub, as of Phase 7.
import { apiFetch } from '../lib/apiClient'

export interface HistoricTaskInstance {
  id: string
  name: string | null
  assignee: string | null
  processInstanceId: string | null
  tenantId: string
  startTime: string | null
  endTime: string | null
  durationInMillis: number | null
}

export async function listHistoricTaskInstances(): Promise<HistoricTaskInstance[]> {
  return apiFetch<HistoricTaskInstance[]>('/runtime/history/task-instances')
}
