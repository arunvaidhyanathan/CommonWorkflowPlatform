// Design-time data layer (Designer.html Sections 3 and 4): workflows and their
// immutable versions, via flowable-wrapper's /runtime/design API. The service
// scopes every call to the caller's tenant and checks designer/admin write
// access; these functions rely on that, not client checks. The tenantId and
// createdBy parameters are kept for callers but the server uses the token's.
import type { Node, Edge } from '@xyflow/react'
import { apiFetch } from '../lib/apiClient'
import type { NodeData } from '../store/useWorkbenchStore'
import type { DmnModel } from '../adapters/dmnAdapter'

export interface WorkflowSummary {
  id: string
  definitionKey: string
  name: string
  description: string | null
  specType: string
  status: string
  currentVersionId: string | null
  updatedAt: string
  createdBy: string | null
}

export interface GraphSnapshot {
  nodes: Node<NodeData>[]
  edges: Edge[]
  // DMN has no React Flow graph — the decision-table model rides alongside
  // (always-empty) nodes/edges arrays so the persisted shape stays uniform.
  dmnModel?: DmnModel | null
}

const DEFINITION_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

export function validateDefinitionKey(key: string): string | null {
  if (!key) return 'Process ID is required.'
  if (!DEFINITION_KEY_PATTERN.test(key)) {
    return 'Process ID must start with a letter or underscore and contain only letters, numbers, hyphens, and underscores.'
  }
  return null
}

export async function isDefinitionKeyTaken(
  _tenantId: string,
  definitionKey: string,
): Promise<boolean> {
  const { taken } = await apiFetch<{ taken: boolean }>(
    `/runtime/design/workflows/key-taken?key=${encodeURIComponent(definitionKey)}`,
  )
  return taken
}

export async function listWorkflows(_tenantId: string): Promise<WorkflowSummary[]> {
  return apiFetch<WorkflowSummary[]>('/runtime/design/workflows')
}

/** Origination path: New (Section 4.1/4.2). Creates the workflow row and an empty draft version. */
export async function createWorkflow(params: {
  tenantId: string
  definitionKey: string
  name: string
  description?: string
  specType: 'BPMN' | 'CMMN' | 'DMN'
  createdBy: string
}): Promise<{ workflowId: string; versionId: string }> {
  return createWorkflowFromImport({ ...params, graph: { nodes: [], edges: [] }, xmlContent: '' })
}

/** Origination path: Import (Section 4.1/4.2). Creates a workflow from parsed XML. */
export async function createWorkflowFromImport(params: {
  tenantId: string
  definitionKey: string
  name: string
  description?: string
  specType: 'BPMN' | 'CMMN' | 'DMN'
  graph: GraphSnapshot
  xmlContent: string
  createdBy: string
}): Promise<{ workflowId: string; versionId: string }> {
  return apiFetch('/runtime/design/workflows', {
    method: 'POST',
    body: JSON.stringify({
      definitionKey: params.definitionKey,
      name: params.name,
      description: params.description ?? null,
      specType: params.specType,
      graph: params.graph,
      xmlContent: params.xmlContent,
    }),
  })
}

/** Section 4.3 step 2: Save Version — freezes an immutable snapshot and advances current_version_id. */
export async function saveDraftVersion(params: {
  workflowId: string
  graph: GraphSnapshot
  xmlContent: string
  createdBy: string
}): Promise<{ versionId: string; versionNo: number }> {
  return apiFetch(`/runtime/design/workflows/${params.workflowId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ graph: params.graph, xmlContent: params.xmlContent }),
  })
}

export async function loadWorkflowVersion(versionId: string): Promise<{
  workflowId: string
  versionNo: number
  graph: GraphSnapshot
  xmlContent: string
}> {
  return apiFetch(`/runtime/design/versions/${versionId}`)
}

export async function loadWorkflow(workflowId: string): Promise<WorkflowSummary> {
  return apiFetch<WorkflowSummary>(`/runtime/design/workflows/${workflowId}`)
}
