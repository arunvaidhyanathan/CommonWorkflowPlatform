// Auto-layout (Designer.html Section 5.2): elkjs layered layout, used when
// imported XML lacks Diagram Interchange bounds, and available on-demand as
// a "tidy up" action.
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData } from '../store/useWorkbenchStore'

const elk = new ELK()

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 36, height: 36 },
  endEvent: { width: 36, height: 36 },
  intermediateEvent: { width: 36, height: 36 },
  boundaryEvent: { width: 36, height: 36 },
  userTask: { width: 120, height: 80 },
  serviceTask: { width: 120, height: 80 },
  businessRuleTask: { width: 120, height: 80 },
  subProcess: { width: 200, height: 140 },
  callActivity: { width: 120, height: 80 },
  exclusiveGateway: { width: 44, height: 44 },
  parallelGateway: { width: 44, height: 44 },
  inclusiveGateway: { width: 44, height: 44 },
  genericNode: { width: 100, height: 60 },
}

export async function applyAutoLayout(
  nodes: Node<NodeData>[],
  edges: Edge[],
): Promise<Node<NodeData>[]> {
  if (nodes.length === 0) return nodes

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '48',
    },
    children: nodes.map((node) => {
      const size = DEFAULT_SIZE[node.type ?? 'genericNode'] ?? DEFAULT_SIZE.genericNode
      return { id: node.id, width: size.width, height: size.height }
    }),
    edges: edges
      .filter((edge) => edge.source && edge.target)
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }

  const layout = await elk.layout(elkGraph)
  const positionById = new Map<string, { x: number; y: number }>()
  layout.children?.forEach((child) => {
    if (child.id && child.x !== undefined && child.y !== undefined) {
      positionById.set(child.id, { x: child.x, y: child.y })
    }
  })

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? node.position,
  }))
}

/** True if every node's position is identical — the telltale sign of a lost/missing DI fallback. */
export function needsAutoLayout(nodes: Node<NodeData>[]): boolean {
  if (nodes.length < 2) return false
  const [first, ...rest] = nodes
  return rest.every((n) => n.position.x === first.position.x && n.position.y === first.position.y)
}
