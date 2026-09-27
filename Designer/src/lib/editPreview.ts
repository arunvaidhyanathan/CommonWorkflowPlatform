// Agentic Designer Edit mode (AgenticDesigner.html Section 4b): turn the
// agent's proposed graph into a canvas preview without disturbing the
// user's layout, highlight what changed, and describe it in plain words.
import type { Edge, Node } from '@xyflow/react'
import type { NodeData } from '../store/useWorkbenchStore'

export interface EditDiff {
  addedNodes: string[]
  removedNodes: string[]
  changedNodes: string[]
  addedEdges: string[]
  removedEdges: string[]
  changedEdges: string[]
}

// The node fields the agent's contract covers; anything else in node.data
// (Designer-only state) is kept as it was.
const CONTRACT_KEYS = ['label', 'documentation', 'assignee', 'candidateGroups', 'delegateExpression', 'formKey'] as const

// Status colors (dataviz reference palette): good = added, warning = changed.
// Always paired with the text summary in the panel, never color alone.
export const ADDED_COLOR = '#0ca30c'
export const CHANGED_COLOR = '#fab219'

const NEW_NODE_OFFSET = { x: 220, y: 90 }

export function mergeProposal(
  current: { nodes: Node<NodeData>[]; edges: Edge[] },
  proposed: { nodes: Node<NodeData>[]; edges: Edge[] },
  diff: EditDiff,
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
    for (const k of CONTRACT_KEYS) delete data[k]
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
    const merged = {
      ...existing,
      label: p.label,
      data: { ...(existing.data ?? {}), conditionExpression: (p.data as { conditionExpression?: string } | undefined)?.conditionExpression },
    }
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
): { kind: 'added' | 'changed' | 'removed'; text: string }[] {
  const label = (id: string) => {
    const n = proposed.nodes.find((x) => x.id === id) ?? current.nodes.find((x) => x.id === id)
    return n?.data?.label ? `“${n.data.label}”` : id
  }
  const flow = (e: Edge | undefined) => (e ? `${label(e.source)} → ${label(e.target)}` : '')
  const cond = (e: Edge | undefined) => (e?.data as { conditionExpression?: string } | undefined)?.conditionExpression
  const out: { kind: 'added' | 'changed' | 'removed'; text: string }[] = []

  for (const id of diff.addedNodes) {
    const n = proposed.nodes.find((x) => x.id === id)
    out.push({ kind: 'added', text: `Added step ${label(id)} (${n?.type ?? 'node'})` })
  }
  for (const id of diff.changedNodes) {
    const before = current.nodes.find((x) => x.id === id)?.data as Record<string, unknown> | undefined
    const after = proposed.nodes.find((x) => x.id === id)?.data as Record<string, unknown> | undefined
    const fields = CONTRACT_KEYS.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    out.push({ kind: 'changed', text: `Changed ${label(id)}: ${fields.join(', ') || 'details'}` })
  }
  for (const id of diff.removedNodes) out.push({ kind: 'removed', text: `Removed step ${label(id)}` })
  for (const id of diff.addedEdges) {
    const e = proposed.edges.find((x) => x.id === id)
    out.push({ kind: 'added', text: `Added flow ${flow(e)}${cond(e) ? ` when ${cond(e)}` : ''}` })
  }
  for (const id of diff.changedEdges) {
    const e = proposed.edges.find((x) => x.id === id)
    out.push({ kind: 'changed', text: `Changed flow ${flow(e)}${cond(e) ? `: now ${cond(e)}` : ': condition removed'}` })
  }
  for (const id of diff.removedEdges) out.push({ kind: 'removed', text: `Removed flow ${flow(current.edges.find((x) => x.id === id))}` })
  return out
}

function highlight(color: string): Node['style'] {
  return { outline: `3px solid ${color}`, outlineOffset: 3, borderRadius: 6 }
}
