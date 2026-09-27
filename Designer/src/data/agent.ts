// Agentic Designer (AgenticDesigner.html): the SPA side of /api/agent.
// The service returns graphs already validated against its contract, in the
// same GraphSnapshot shape parseBpmnXml produces, so they drop straight onto
// the canvas. Nothing here saves: the user reviews, then uses Save Version.
import type { Edge, Node } from '@xyflow/react'
import type { NodeData } from '../store/useWorkbenchStore'
import { apiStream } from '../lib/apiClient'

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
  | { type: 'result'; attempt: number; issues: AgentIssue[]; graph: { nodes: Node<NodeData>[]; edges: Edge[] } }
  | { type: 'failed'; attempt: number; issues: AgentIssue[] }
  | { type: 'error'; message: string }

export async function generateWorkflow(
  description: string,
  onEvent: (event: GenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await apiStream(
    '/agent/generate',
    { description },
    ({ event, data }) => {
      const body = (data ?? {}) as Record<string, unknown>
      // Trusted shape: the service builds these events from its own validated models.
      onEvent({ issues: [], ...body, type: event } as unknown as GenerateEvent)
    },
    signal,
  )
}
