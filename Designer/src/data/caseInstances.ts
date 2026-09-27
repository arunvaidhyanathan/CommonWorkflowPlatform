// Runtime-layer data (WorkflowWrapper.html Section 8, row 3 / Section 9
// Phase 8; Workbench.html Section 7.1's Case Instance View). Calls the
// Runtime Gateway's real, embedded CmmnRuntimeService -- not a stub, as of
// Phase 7's Flowable 8.0.0 engine embedding.
import { apiFetch } from '../lib/apiClient'

export interface CaseInstance {
  id: string
  caseDefinitionId: string
  businessKey: string | null
  name: string | null
  state: string
  tenantId: string
  startTime: string | null
}

export async function listCaseInstances(): Promise<CaseInstance[]> {
  return apiFetch<CaseInstance[]>('/runtime/case-instances')
}
