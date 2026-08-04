// Canvas Editor Workspace (Designer.html Section 1 / 9): React Flow wired to
// the Zustand store, with minimap, snap-to-grid, and drag-drop placement.
import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type ReactFlowInstance,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useWorkbenchStore, type NodeData } from '../store/useWorkbenchStore'
import { nodeTypes } from '../nodes/nodeTypes'

let nodeIdCounter = 0
function nextNodeId(type: string) {
  nodeIdCounter += 1
  return `${type}_${Date.now()}_${nodeIdCounter}`
}

export function Canvas() {
  const nodes = useWorkbenchStore((s) => s.nodes)
  const edges = useWorkbenchStore((s) => s.edges)
  const onNodesChange = useWorkbenchStore((s) => s.onNodesChange)
  const onEdgesChange = useWorkbenchStore((s) => s.onEdgesChange)
  const onConnect = useWorkbenchStore((s) => s.onConnect)
  const addNode = useWorkbenchStore((s) => s.addNode)
  const selectNode = useWorkbenchStore((s) => s.selectNode)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance<Node<NodeData>, Edge> | null>(null)

  const placeNode = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      const label = type.replace(/([A-Z])/g, ' $1').trim()
      addNode({
        id: nextNodeId(type),
        type,
        position: position ?? { x: 200, y: 200 },
        data: { label: label.charAt(0).toUpperCase() + label.slice(1) } as NodeData,
      })
    },
    [addNode],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow')
      if (!type || !wrapperRef.current || !instanceRef.current) return

      const bounds = wrapperRef.current.getBoundingClientRect()
      const position = instanceRef.current.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })
      placeNode(type, position)
    },
    [placeNode],
  )

  // These must be stable references. React Flow re-subscribes internal
  // listeners whenever the callback identity changes; inline arrow
  // functions here caused an infinite render loop (identity changes every
  // render -> re-subscribe -> fires -> store update -> re-render -> repeat).
  const handleInit = useCallback((instance: ReactFlowInstance<Node<NodeData>, Edge>) => {
    instanceRef.current = instance
  }, [])

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: Node<NodeData>[] }) => {
      const nextId = selected[0]?.id ?? null
      if (useWorkbenchStore.getState().selectedNodeId !== nextId) {
        selectNode(nextId)
      }
    },
    [selectNode],
  )

  const handlePaneClick = useCallback(() => {
    if (useWorkbenchStore.getState().selectedNodeId !== null) {
      selectNode(null)
    }
  }, [selectNode])

  // fitView only runs once on mount by default. Re-fit whenever the node
  // count changes (import, tidy-up, palette add/delete) so a freshly
  // imported or re-laid-out diagram is actually visible without manual
  // pan/zoom.
  const nodeCount = nodes.length
  useEffect(() => {
    if (nodeCount > 0) {
      instanceRef.current?.fitView({ padding: 0.2, duration: 200 })
    }
  }, [nodeCount])

  return (
    <div ref={wrapperRef} className="h-full flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={handleInit}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        snapToGrid
        snapGrid={[16, 16]}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} color="#c2d8ec" />
        <Controls />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(234, 243, 251, 0.6)"
          nodeColor="#56a0d3"
        />
      </ReactFlow>
    </div>
  )
}
