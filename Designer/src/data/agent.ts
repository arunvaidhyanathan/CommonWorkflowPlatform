// Agentic Designer (AgenticDesigner.html): the SPA side of /api/agent.
// The service returns graphs already validated against its contract, in the
// same GraphSnapshot shape parseBpmnXml produces, so they drop straight onto
// the canvas. Nothing here saves: the user reviews, then uses Save Version.
import type { Edge, Node } from '@xyflow/react'
import type { NodeData, SpecType } from '../store/useWorkbenchStore'
import type { DmnModel } from '../adapters/dmnAdapter'
import { apiStream } from '../lib/apiClient'
import type { DmnDiff, EditDiff } from '../lib/editPreview'

export interface AgentIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
  nodeIds: string[]
  edgeIds: string[]
}

export type GenerateEvent =
  | { type: 'attempt'; attempt: number }
  | { type: 'invalid'; attempt: number; issues: AgentIssue[] }
  | { type: 'result'; attempt: number; issues: AgentIssue[]; graph: AgentGraph }
  | { type: 'failed'; attempt: number; issues: AgentIssue[] }
  | { type: 'error'; message: string }

/** Canvas nodes/edges for BPMN and CMMN; a dmnModel for DMN. */
export type AgentGraph = { nodes: Node<NodeData>[]; edges: Edge[]; dmnModel?: DmnModel }

export async function generateWorkflow(
  spec: SpecType,
  description: string,
  onEvent: (event: GenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await apiStream(
    '/agent/generate',
    { spec, description },
    ({ event, data }) => {
      const body = (data ?? {}) as Record<string, unknown>
      // Trusted shape: the service builds these events from its own validated models.
      onEvent({ issues: [], ...body, type: event } as unknown as GenerateEvent)
    },
    signal,
  )
}

type CanvasGraph = AgentGraph

export type EditEvent =
  | { type: 'attempt'; attempt: number }
  | { type: 'invalid'; attempt: number; issues: AgentIssue[] }
  | {
      type: 'result'
      attempt: number
      issues: AgentIssue[] // warnings only
      graph: CanvasGraph
      ops: Record<string, unknown>[] // BPMN only
      diff: EditDiff | DmnDiff // DmnDiff for DMN
      preexisting: AgentIssue[] // errors the workflow already had; not caused by this edit
    }
  | { type: 'failed'; attempt: number; issues: AgentIssue[] }
  | { type: 'error'; message: string }

/** Edit mode: the service proposes changes to the current canvas. Nothing
 *  is applied here; the panel previews and the user accepts or rejects. */
export async function editWorkflow(
  spec: SpecType,
  instruction: string,
  graph: CanvasGraph,
  onEvent: (event: EditEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await apiStream(
    '/agent/edit',
    { spec, instruction, graph: { nodes: graph.nodes, edges: graph.edges, dmnModel: graph.dmnModel ?? null } },
    ({ event, data }) => {
      const body = (data ?? {}) as Record<string, unknown>
      // Trusted shape: the service builds these events from its own validated models.
      onEvent({ issues: [], preexisting: [], ...body, type: event } as unknown as EditEvent)
    },
    signal,
  )
}

export interface ReviewFinding {
  source: 'check' | 'ai' // code check vs model judgement
  severity: 'error' | 'warning' | 'suggestion'
  code: string // AD0xx for checks, a category for AI findings
  message: string
  nodeIds: string[]
  edgeIds: string[]
}

export type ReviewEvent =
  | { type: 'checks'; findings: ReviewFinding[]; aiAvailable: boolean } // code checks, sent first
  | { type: 'attempt'; attempt: number }
  | { type: 'invalid'; attempt: number; issues: AgentIssue[] }
  | { type: 'result'; findings: ReviewFinding[]; aiAvailable: boolean }
  | { type: 'error'; message: string }

/** Review mode: read-only; nothing here changes the workflow. */
export async function reviewWorkflow(
  spec: SpecType,
  graph: CanvasGraph,
  focus: string,
  onEvent: (event: ReviewEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await apiStream(
    '/agent/review',
    { spec, graph: { nodes: graph.nodes, edges: graph.edges, dmnModel: graph.dmnModel ?? null }, focus: focus || null },
    ({ event, data }) => {
      const body = (data ?? {}) as Record<string, unknown>
      // Trusted shape: the service builds these events from its own validated models.
      onEvent({ findings: [], issues: [], ...body, type: event } as unknown as ReviewEvent)
    },
    signal,
  )
}
