// Design-time data layer (Designer.html Sections 3 and 4): Supabase CRUD for
// workflows and their immutable versions. RLS enforces tenant isolation and
// designer/admin write access; these functions rely on that, not client checks.
import type { Node, Edge } from '@xyflow/react'
import { supabase } from '../lib/supabaseClient'
import type { NodeData } from '../store/useWorkbenchStore'
import type { Json } from '../lib/database.types'
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
  tenantId: string,
  definitionKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('definition_key', definitionKey)
    .maybeSingle()

  if (error) throw error
  return data !== null
}

export async function listWorkflows(tenantId: string): Promise<WorkflowSummary[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select(
      'id, definition_key, name, description, spec_type, status, current_version_id, updated_at, created_by',
    )
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    definitionKey: row.definition_key,
    name: row.name,
    description: row.description,
    specType: row.spec_type,
    status: row.status,
    currentVersionId: row.current_version_id,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  }))
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
  const { data: workflow, error: workflowError } = await supabase
    .from('workflows')
    .insert({
      tenant_id: params.tenantId,
      definition_key: params.definitionKey,
      name: params.name,
      description: params.description ?? null,
      spec_type: params.specType,
      status: 'draft',
      created_by: params.createdBy,
    })
    .select('id')
    .single()

  if (workflowError) throw workflowError

  const { versionId } = await saveDraftVersion({
    workflowId: workflow.id,
    graph: { nodes: [], edges: [] },
    xmlContent: '',
    createdBy: params.createdBy,
  })

  return { workflowId: workflow.id, versionId }
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
  const { data: workflow, error: workflowError } = await supabase
    .from('workflows')
    .insert({
      tenant_id: params.tenantId,
      definition_key: params.definitionKey,
      name: params.name,
      description: params.description ?? null,
      spec_type: params.specType,
      status: 'draft',
      created_by: params.createdBy,
    })
    .select('id')
    .single()

  if (workflowError) throw workflowError

  const { versionId } = await saveDraftVersion({
    workflowId: workflow.id,
    graph: params.graph,
    xmlContent: params.xmlContent,
    createdBy: params.createdBy,
  })

  return { workflowId: workflow.id, versionId }
}

/** Section 4.3 step 2: Save Version — freezes an immutable snapshot and advances current_version_id. */
export async function saveDraftVersion(params: {
  workflowId: string
  graph: GraphSnapshot
  xmlContent: string
  createdBy: string
}): Promise<{ versionId: string; versionNo: number }> {
  const { count } = await supabase
    .from('workflow_versions')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', params.workflowId)

  const versionNo = (count ?? 0) + 1

  const { data: version, error: versionError } = await supabase
    .from('workflow_versions')
    .insert({
      workflow_id: params.workflowId,
      version_no: versionNo,
      graph_json: params.graph as unknown as Json,
      xml_content: params.xmlContent,
      created_by: params.createdBy,
    })
    .select('id')
    .single()

  if (versionError) throw versionError

  const { error: updateError } = await supabase
    .from('workflows')
    .update({ current_version_id: version.id, updated_at: new Date().toISOString() })
    .eq('id', params.workflowId)

  if (updateError) throw updateError

  return { versionId: version.id, versionNo }
}

export async function loadWorkflowVersion(versionId: string): Promise<{
  workflowId: string
  versionNo: number
  graph: GraphSnapshot
  xmlContent: string
}> {
  const { data, error } = await supabase
    .from('workflow_versions')
    .select('workflow_id, version_no, graph_json, xml_content')
    .eq('id', versionId)
    .single()

  if (error) throw error

  return {
    workflowId: data.workflow_id,
    versionNo: data.version_no,
    graph: data.graph_json as unknown as GraphSnapshot,
    xmlContent: data.xml_content,
  }
}

export async function loadWorkflow(workflowId: string) {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', workflowId)
    .single()

  if (error) throw error
  return data
}
