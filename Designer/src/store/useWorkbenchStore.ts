import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react'
import type { DmnDecision, DmnModel } from '../adapters/dmnAdapter'
import { createEmptyDecision } from '../adapters/dmnAdapter'

export type SpecType = 'BPMN' | 'CMMN' | 'DMN'

export interface NodeData extends Record<string, unknown> {
  label: string
  documentation?: string
  assignee?: string
  candidateGroups?: string[]
  delegateExpression?: string
  conditionExpression?: string
  formKey?: string
}

interface WorkbenchState {
  // Workspace context (Section 4.2: user-captured workflow identity)
  activeSpec: SpecType
  workflowId: string | null
  definitionKey: string
  workflowName: string
  workflowDescription: string
  draftVersionId: string | null
  tenantId: string | null
  isDirty: boolean

  // Graph model (BPMN / CMMN)
  nodes: Node<NodeData>[]
  edges: Edge[]
  selectedNodeId: string | null

  // Decision model (DMN) — not React Flow nodes/edges, so tracked separately
  // and excluded from the undo/redo temporal partialize below.
  dmnModel: DmnModel | null
  activeDecisionId: string | null

  // Actions
  setActiveSpec: (spec: SpecType) => void
  setWorkflowIdentity: (identity: {
    workflowId?: string | null
    definitionKey: string
    workflowName: string
    workflowDescription?: string
    tenantId?: string | null
  }) => void
  onNodesChange: OnNodesChange<Node<NodeData>>
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  selectNode: (id: string | null) => void
  updateNodeData: (id: string, data: Partial<NodeData>) => void
  addNode: (node: Node<NodeData>) => void
  removeNode: (id: string) => void
  setGraph: (nodes: Node<NodeData>[], edges: Edge[]) => void
  markSaved: (versionId: string) => void
  resetWorkspace: () => void

  // DMN actions
  setDmnModel: (model: DmnModel | null) => void
  selectDecision: (id: string | null) => void
  updateDecision: (id: string, patch: Partial<DmnDecision>) => void
  addDecision: (name: string) => void
  removeDecision: (id: string) => void
}

const initialWorkspace = {
  activeSpec: 'BPMN' as SpecType,
  workflowId: null,
  definitionKey: '',
  workflowName: '',
  workflowDescription: '',
  draftVersionId: null,
  tenantId: null,
  isDirty: false,
  nodes: [] as Node<NodeData>[],
  edges: [] as Edge[],
  selectedNodeId: null,
  dmnModel: null as DmnModel | null,
  activeDecisionId: null as string | null,
}

export const useWorkbenchStore = create<WorkbenchState>()(
  temporal(
    (set, get) => ({
      ...initialWorkspace,

      setActiveSpec: (activeSpec) => set({ activeSpec }),

      setWorkflowIdentity: ({
        workflowId = null,
        definitionKey,
        workflowName,
        workflowDescription = '',
        tenantId = null,
      }) =>
        set({
          workflowId,
          definitionKey,
          workflowName,
          workflowDescription,
          tenantId,
        }),

      // React Flow also reports node measurements ('dimensions', e.g. on first
      // render) and clicks ('select'). Neither changes what gets saved, so
      // they must not mark the workflow as having unsaved changes.
      onNodesChange: (changes) =>
        set({
          nodes: applyNodeChanges(changes, get().nodes),
          isDirty: get().isDirty || changes.some((c) => c.type !== 'dimensions' && c.type !== 'select'),
        }),

      onEdgesChange: (changes) =>
        set({
          edges: applyEdgeChanges(changes, get().edges),
          isDirty: get().isDirty || changes.some((c) => c.type !== 'select'),
        }),

      onConnect: (connection) =>
        set({
          edges: addEdge({ ...connection, type: 'smoothstep' }, get().edges),
          isDirty: true,
        }),

      selectNode: (selectedNodeId) => set({ selectedNodeId }),

      updateNodeData: (id, data) =>
        set({
          nodes: get().nodes.map((node) =>
            node.id === id
              ? { ...node, data: { ...node.data, ...data } }
              : node,
          ),
          isDirty: true,
        }),

      addNode: (node) =>
        set({
          nodes: [...get().nodes, node],
          isDirty: true,
        }),

      removeNode: (id) =>
        set({
          nodes: get().nodes.filter((n) => n.id !== id),
          edges: get().edges.filter((e) => e.source !== id && e.target !== id),
          selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
          isDirty: true,
        }),

      setGraph: (nodes, edges) => set({ nodes, edges, isDirty: false }),

      markSaved: (versionId) =>
        set({ draftVersionId: versionId, isDirty: false }),

      resetWorkspace: () => set({ ...initialWorkspace }),

      setDmnModel: (dmnModel) =>
        set({
          dmnModel,
          activeDecisionId: dmnModel?.decisions[0]?.id ?? null,
        }),

      selectDecision: (activeDecisionId) => set({ activeDecisionId }),

      updateDecision: (id, patch) => {
        const model = get().dmnModel
        if (!model) return
        set({
          dmnModel: {
            ...model,
            decisions: model.decisions.map((d) => (d.id === id ? { ...d, ...patch } : d)),
          },
          isDirty: true,
        })
      },

      addDecision: (name) => {
        const model = get().dmnModel
        if (!model) return
        const decision = createEmptyDecision(name)
        set({
          dmnModel: { ...model, decisions: [...model.decisions, decision] },
          activeDecisionId: decision.id,
          isDirty: true,
        })
      },

      removeDecision: (id) => {
        const model = get().dmnModel
        if (!model) return
        const decisions = model.decisions.filter((d) => d.id !== id)
        set({
          dmnModel: { ...model, decisions },
          activeDecisionId:
            get().activeDecisionId === id ? (decisions[0]?.id ?? null) : get().activeDecisionId,
          isDirty: true,
        })
      },
    }),
    {
      // Only the graph is undo/redo-tracked; identity and dirty flags are not.
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
    },
  ),
)
