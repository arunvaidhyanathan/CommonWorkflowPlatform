// Agentic Designer Edit mode (AgenticDesigner.html Section 4b): turn the
// agent's proposed graph into a canvas preview without disturbing the
// user's layout, highlight what changed, and describe it in plain words.
import type { Edge, Node } from '@xyflow/react'
import type { NodeData } from '../store/useWorkbenchStore'
import type { DmnModel } from '../adapters/dmnAdapter'

export interface EditDiff {
  addedNodes: string[]
  removedNodes: string[]
  changedNodes: string[]
  addedEdges: string[]
  removedEdges: string[]
  changedEdges: string[]
}

type CanvasSpec = 'BPMN' | 'CMMN'

// The node and link fields the agent's contract covers, per notation;
// anything else in node.data / edge.data (Designer-only state) is kept.
const NODE_KEYS: Record<CanvasSpec, readonly string[]> = {
  BPMN: ['label', 'documentation', 'assignee', 'candidateGroups', 'delegateExpression', 'formKey'],
  CMMN: ['label', 'isBlocking', 'conditionExpression'],
}
const EDGE_KEYS: Record<CanvasSpec, readonly string[]> = {
  BPMN: ['conditionExpression'],
  CMMN: ['criterionType', 'standardEvent'],
}

// Status colors (dataviz reference palette): good = added, warning = changed.
// Always paired with the text summary in the panel, never color alone.
export const ADDED_COLOR = '#0ca30c'
export const CHANGED_COLOR = '#fab219'

const NEW_NODE_OFFSET = { x: 220, y: 90 }

export function mergeProposal(
  current: { nodes: Node<NodeData>[]; edges: Edge[] },
  proposed: { nodes: Node<NodeData>[]; edges: Edge[] },
  diff: EditDiff,
  spec: CanvasSpec = 'BPMN',
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const currentNodes = new Map(current.nodes.map((n) => [n.id, n]))
  const currentEdges = new Map(current.edges.map((e) => [e.id, e]))
  const placed = new Map<string, { x: number; y: number }>()
  current.nodes.forEach((n) => placed.set(n.id, n.position))

  const changed = new Set(diff.changedNodes)

  // Place new nodes beside the node they connect from (or to), in order, so
  // a chain of inserted steps fans out instead of stacking.
  let fallbackIndex = 0
  const maxX = Math.max(0, ...current.nodes.map((n) => n.position.x))
  for (const id of diff.addedNodes) {
    const incoming = proposed.edges.find((e) => e.target === id && placed.has(e.source))
    const outgoing = proposed.edges.find((e) => e.source === id && placed.has(e.target))
    const anchor = incoming ? placed.get(incoming.source)! : outgoing ? placed.get(outgoing.target)! : null
    let pos = anchor
      ? { x: anchor.x + (incoming ? NEW_NODE_OFFSET.x : -NEW_NODE_OFFSET.x), y: anchor.y + NEW_NODE_OFFSET.y }
      : { x: maxX + NEW_NODE_OFFSET.x, y: 80 + fallbackIndex++ * NEW_NODE_OFFSET.y }
    // Keep clear of existing nodes (a task is about 150 x 60 on the canvas).
    while ([...placed.values()].some((p) => Math.abs(p.x - pos.x) < 160 && Math.abs(p.y - pos.y) < 80)) {
      pos = { x: pos.x, y: pos.y + NEW_NODE_OFFSET.y }
    }
    placed.set(id, pos)
  }

  const nodes = proposed.nodes.map((p) => {
    const existing = currentNodes.get(p.id)
    if (!existing) {
      return { ...p, position: placed.get(p.id)!, style: highlight(ADDED_COLOR) }
    }
    const data = { ...existing.data } as Record<string, unknown>
    for (const k of NODE_KEYS[spec]) delete data[k]
    return {
      ...existing,
      data: { ...data, ...p.data } as NodeData,
      style: changed.has(p.id) ? { ...existing.style, ...highlight(CHANGED_COLOR) } : existing.style,
    }
  })

  const changedEdges = new Set(diff.changedEdges)
  const edges = proposed.edges.map((p) => {
    const existing = currentEdges.get(p.id)
    if (!existing) return { ...p, style: { stroke: ADDED_COLOR, strokeWidth: 2 } }
    const data = { ...(existing.data ?? {}) } as Record<string, unknown>
    for (const k of EDGE_KEYS[spec]) delete data[k]
    const merged = { ...existing, label: p.label, data: { ...data, ...(p.data ?? {}) } }
    return changedEdges.has(p.id) ? { ...merged, style: { ...existing.style, stroke: CHANGED_COLOR, strokeWidth: 2 } } : merged
  })

  return { nodes, edges }
}

/** Remove preview highlights, restoring each node's and edge's own style. */
export function stripHighlights(
  preview: { nodes: Node<NodeData>[]; edges: Edge[] },
  before: { nodes: Node<NodeData>[]; edges: Edge[] },
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const nodeStyle = new Map(before.nodes.map((n) => [n.id, n.style]))
  const edgeStyle = new Map(before.edges.map((e) => [e.id, e.style]))
  return {
    nodes: preview.nodes.map((n) => ({ ...n, style: nodeStyle.get(n.id) })),
    edges: preview.edges.map((e) => ({ ...e, style: edgeStyle.get(e.id) })),
  }
}

/** Plain-language list of the changes, for the panel. */
export function describeChanges(
  current: { nodes: Node<NodeData>[]; edges: Edge[] },
  proposed: { nodes: Node<NodeData>[]; edges: Edge[] },
  diff: EditDiff,
  spec: CanvasSpec = 'BPMN',
): { kind: 'added' | 'changed' | 'removed'; text: string }[] {
  const label = (id: string) => {
    const n = proposed.nodes.find((x) => x.id === id) ?? current.nodes.find((x) => x.id === id)
    return n?.data?.label ? `“${n.data.label}”` : id
  }
  const flow = (e: Edge | undefined) => (e ? `${label(e.source)} → ${label(e.target)}` : '')
  // BPMN flows carry a condition; CMMN links carry their kind or event.
  const cond = (e: Edge | undefined) => {
    const d = e?.data as { conditionExpression?: string; criterionType?: string; standardEvent?: string } | undefined
    if (spec === 'CMMN') return d?.criterionType === 'onPart' ? `on ${d.standardEvent ?? 'complete'}` : d?.criterionType
    return d?.conditionExpression
  }
  const linkWord = spec === 'CMMN' ? 'link' : 'flow'
  const out: { kind: 'added' | 'changed' | 'removed'; text: string }[] = []

  for (const id of diff.addedNodes) {
    const n = proposed.nodes.find((x) => x.id === id)
    out.push({ kind: 'added', text: `Added step ${label(id)} (${n?.type ?? 'node'})` })
  }
  for (const id of diff.changedNodes) {
    const before = current.nodes.find((x) => x.id === id)?.data as Record<string, unknown> | undefined
    const after = proposed.nodes.find((x) => x.id === id)?.data as Record<string, unknown> | undefined
    const fields = NODE_KEYS[spec].filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    out.push({ kind: 'changed', text: `Changed ${label(id)}: ${fields.join(', ') || 'details'}` })
  }
  for (const id of diff.removedNodes) out.push({ kind: 'removed', text: `Removed step ${label(id)}` })
  for (const id of diff.addedEdges) {
    const e = proposed.edges.find((x) => x.id === id)
    out.push({ kind: 'added', text: `Added ${linkWord} ${flow(e)}${cond(e) ? (spec === 'CMMN' ? ` (${cond(e)})` : ` when ${cond(e)}`) : ''}` })
  }
  for (const id of diff.changedEdges) {
    const e = proposed.edges.find((x) => x.id === id)
    out.push({ kind: 'changed', text: `Changed ${linkWord} ${flow(e)}${cond(e) ? `: now ${cond(e)}` : ': condition removed'}` })
  }
  for (const id of diff.removedEdges) out.push({ kind: 'removed', text: `Removed ${linkWord} ${flow(current.edges.find((x) => x.id === id))}` })
  return out
}

function highlight(color: string): Node['style'] {
  return { outline: `3px solid ${color}`, outlineOffset: 3, borderRadius: 6 }
}

// --- DMN: no canvas; the panel lists the changes and nothing applies until Accept ---

export interface DmnDiff {
  addedDecisions: string[]
  removedDecisions: string[]
  changedDecisions: {
    id: string
    name: string
    addedRules: string[]
    removedRules: string[]
    changedRules: string[]
    tableChanged: boolean // hit policy, inputs, outputs or name
  }[]
}

export function describeDmnChanges(
  current: DmnModel | null,
  proposed: DmnModel,
  diff: DmnDiff,
): { kind: 'added' | 'changed' | 'removed'; text: string }[] {
  const name = (id: string) =>
    proposed.decisions.find((d) => d.id === id)?.name ?? current?.decisions.find((d) => d.id === id)?.name ?? id
  const ruleNo = (decisionId: string, ruleId: string, model: DmnModel | null) => {
    const i = model?.decisions.find((d) => d.id === decisionId)?.decisionTable.rules.findIndex((r) => r.id === ruleId) ?? -1
    return i >= 0 ? `rule ${i + 1}` : ruleId
  }
  const out: { kind: 'added' | 'changed' | 'removed'; text: string }[] = []
  for (const id of diff.addedDecisions) {
    const d = proposed.decisions.find((x) => x.id === id)
    out.push({ kind: 'added', text: `Added decision “${name(id)}” (${d?.decisionTable.rules.length ?? 0} rules)` })
  }
  for (const id of diff.removedDecisions) out.push({ kind: 'removed', text: `Removed decision “${name(id)}”` })
  for (const c of diff.changedDecisions) {
    if (c.tableChanged) out.push({ kind: 'changed', text: `“${c.name}”: table changed (name, hit policy, inputs or outputs)` })
    for (const r of c.addedRules) out.push({ kind: 'added', text: `“${c.name}”: added ${ruleNo(c.id, r, proposed)}` })
    for (const r of c.changedRules) out.push({ kind: 'changed', text: `“${c.name}”: changed ${ruleNo(c.id, r, proposed)}` })
    for (const r of c.removedRules) out.push({ kind: 'removed', text: `“${c.name}”: removed ${ruleNo(c.id, r, current)}` })
  }
  return out
}
