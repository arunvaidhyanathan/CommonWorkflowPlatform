// Runtime work: deployed definitions, process/case instances and the task
// inbox, via flowable-wrapper's /runtime/definitions, /runtime/instances and
// /runtime/tasks. The service scopes everything to the caller's tenant and
// decides who may claim, complete, update or terminate.
import { apiFetch } from '../lib/apiClient'

export type InstanceKind = 'process' | 'case'
export type Variables = Record<string, unknown>

export interface Definition {
  id: string
  kind: InstanceKind
  key: string
  name: string | null
  version: number
  deploymentId: string
  // #13: the app this definition was released in, if any.
  appKey: string | null
  appName: string | null
}

export interface InstanceSummary {
  id: string
  kind: InstanceKind
  definitionId: string
  definitionKey: string
  definitionName: string | null
  businessKey: string | null
  state: string
  startUserId: string | null
  startTime: string | null
  endTime: string | null
  // Flowable 8 business status: a short label case workers set ("Awaiting documents").
  businessStatus: string | null
}

export interface PlanItem {
  id: string
  // The plan item's id in the case definition (what ad-hoc injection creates another instance of).
  elementId: string
  name: string | null
  type: string
  state: string
  stageInstanceId: string | null
  // What a case worker can do now: start, disable, enable (manual items), trigger (user event listeners).
  actions: PlanItemAction[]
}

export type PlanItemAction = 'start' | 'disable' | 'enable' | 'trigger'

export interface DecisionSummary {
  id: string
  key: string
  name: string | null
  version: number
  type: 'decision_table' | 'decision_service' | string
}

export interface DecisionTrace {
  key: string
  name: string | null
  hitPolicy: string | null
  result: Record<string, unknown>[]
  matchedRules: number[]
  failed: boolean
  message: string | null
}

export interface DecisionEvaluation {
  key: string
  type: string
  result: unknown
  decisions: DecisionTrace[]
}

export interface InstanceDetail {
  instance: InstanceSummary
  variables: Variables
  planItems: PlanItem[]
  activeActivityIds: string[]
  openTasks: { id: string; name: string; assignee: string | null }[]
}

export type TaskFilter = 'mine' | 'available' | 'all'

export interface TaskSummary {
  id: string
  name: string | null
  description: string | null
  assignee: string | null
  candidateGroups: string[]
  formKey: string | null
  priority: number
  createTime: string | null
  dueDate: string | null
  kind: InstanceKind
  instanceId: string
}

export interface TaskDetail {
  task: TaskSummary
  variables: Variables
  canClaim: boolean
  canComplete: boolean
}

export const listDefinitions = () => apiFetch<Definition[]>('/runtime/definitions')

export const startInstance = (params: {
  kind: InstanceKind
  definitionKey: string
  businessKey?: string
  variables: Variables
}) => apiFetch<InstanceSummary>('/runtime/instances', { method: 'POST', body: JSON.stringify(params) })

export const listInstances = (state: 'active' | 'all') =>
  apiFetch<InstanceSummary[]>(`/runtime/instances?state=${state}`)

export const getInstance = (kind: InstanceKind, id: string) =>
  apiFetch<InstanceDetail>(`/runtime/instances/${kind}/${id}`)

export const setInstanceVariables = (kind: InstanceKind, id: string, variables: Variables) =>
  apiFetch<void>(`/runtime/instances/${kind}/${id}/variables`, {
    method: 'PUT',
    body: JSON.stringify(variables),
  })

export const terminateInstance = (kind: InstanceKind, id: string) =>
  apiFetch<void>(`/runtime/instances/${kind}/${id}`, { method: 'DELETE' })

export const planItemAction = (id: string, action: PlanItemAction) =>
  apiFetch<void>(`/runtime/plan-items/${id}/${action}`, { method: 'POST' })

export const listDecisions = () => apiFetch<DecisionSummary[]>('/runtime/decisions')

export const evaluateDecision = (key: string, variables: Variables) =>
  apiFetch<DecisionEvaluation>(`/runtime/decisions/${encodeURIComponent(key)}/evaluate`, {
    method: 'POST',
    body: JSON.stringify(variables),
  })

export interface VersionSummary {
  definitionId: string
  version: number
  runningInstances: number
}

export interface MigrationRequest {
  kind: InstanceKind
  instanceIds?: string[]
  sourceDefinitionId?: string
  targetKey: string
  targetVersion: number
  activityMappings?: { from: string; to: string }[]
  autoCreateNewPlanItems?: boolean
}

export interface ValidationReport {
  valid: boolean
  instances: { instanceId: string; valid: boolean; messages: string[] }[]
}

export interface BatchStatus {
  id: string
  kind: InstanceKind
  status: string
  createTime: string | null
  completeTime: string | null
  partsByStatus: Record<string, number>
}

export const listVersions = (kind: InstanceKind, key: string) =>
  apiFetch<VersionSummary[]>(`/runtime/definitions/${kind}/${encodeURIComponent(key)}/versions`)

export const validateMigration = (request: MigrationRequest) =>
  apiFetch<ValidationReport>('/runtime/migrations/validate', { method: 'POST', body: JSON.stringify(request) })

export const migrateInstances = (request: MigrationRequest) =>
  apiFetch<{ migrated: number }>('/runtime/migrations', { method: 'POST', body: JSON.stringify(request) })

export const startBatchMigration = (request: MigrationRequest) =>
  apiFetch<BatchStatus>('/runtime/migrations/batch', { method: 'POST', body: JSON.stringify(request) })

export const getBatch = (kind: InstanceKind, id: string) =>
  apiFetch<BatchStatus>(`/runtime/migrations/batches/${kind}/${id}`)

export const injectTask = (processInstanceId: string, name: string, assignee: string) =>
  apiFetch<void>(`/runtime/instances/process/${processInstanceId}/inject-task`, {
    method: 'POST',
    body: JSON.stringify({ name, assignee }),
  })

export const injectPlanItem = (caseInstanceId: string, elementId: string, name: string, stageInstanceId?: string) =>
  apiFetch<void>(`/runtime/instances/case/${caseInstanceId}/inject-plan-item`, {
    method: 'POST',
    body: JSON.stringify({ elementId, name, stageInstanceId }),
  })

export interface TimelineEntry {
  time: string | null
  what: string
  elementId: string | null
  name: string | null
  type: string | null
  detail: string | null
  userId: string | null
}

export interface JobSummary {
  id: string
  state: 'failed' | 'timer' | 'waiting'
  kind: InstanceKind
  instanceId: string | null
  elementId: string | null
  elementName: string | null
  handler: string | null
  retries: number
  dueDate: string | null
  createTime: string | null
  exceptionMessage: string | null
}

export interface ExpressionResult {
  ok: boolean
  value: unknown
  valueType: string | null
  error: string | null
}

export const getTimeline = (kind: InstanceKind, id: string) =>
  apiFetch<TimelineEntry[]>(`/runtime/instances/${kind}/${id}/timeline`)

export const setBusinessStatus = (kind: InstanceKind, id: string, status: string) =>
  apiFetch<void>(`/runtime/instances/${kind}/${id}/business-status`, { method: 'PUT', body: JSON.stringify({ status }) })

export const listJobs = (state: JobSummary['state']) => apiFetch<JobSummary[]>(`/runtime/jobs?state=${state}`)
export const jobStacktrace = (id: string) => apiFetch<{ stacktrace: string }>(`/runtime/jobs/${id}/stacktrace`)
export const retryJob = (id: string) => apiFetch<void>(`/runtime/jobs/${id}/retry`, { method: 'POST' })
export const deleteJob = (id: string) => apiFetch<void>(`/runtime/jobs/${id}`, { method: 'DELETE' })
export const fireTimer = (id: string) => apiFetch<void>(`/runtime/jobs/${id}/fire`, { method: 'POST' })

export const evaluateExpression = (expression: string, variables: Variables) =>
  apiFetch<ExpressionResult>('/runtime/expressions/evaluate', {
    method: 'POST',
    body: JSON.stringify({ expression, variables }),
  })

export const listTasks = (filter: TaskFilter) => apiFetch<TaskSummary[]>(`/runtime/tasks?filter=${filter}`)

export const getTask = (id: string) => apiFetch<TaskDetail>(`/runtime/tasks/${id}`)

export const claimTask = (id: string) => apiFetch<void>(`/runtime/tasks/${id}/claim`, { method: 'POST' })

export const unclaimTask = (id: string) => apiFetch<void>(`/runtime/tasks/${id}/unclaim`, { method: 'POST' })

export const completeTask = (id: string, variables: Variables) =>
  apiFetch<void>(`/runtime/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(variables) })

/** Parses a JSON object typed by a person; returns an error message instead of throwing. */
export function parseVariables(text: string): { variables: Variables } | { error: string } {
  if (!text.trim()) return { variables: {} }
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 'Variables must be a JSON object, e.g. {"amount": 120}.' }
    }
    return { variables: value as Variables }
  } catch (err) {
    return { error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
}
