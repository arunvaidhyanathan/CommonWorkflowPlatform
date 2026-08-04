import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { NodeData } from '../store/useWorkbenchStore'

interface EventNodeProps extends NodeProps {
  data: NodeData
  variant: 'start' | 'end' | 'intermediate' | 'boundary'
}

const VARIANT_STYLE: Record<EventNodeProps['variant'], string> = {
  start: 'border-emerald-600 text-emerald-700',
  end: 'border-red-600 border-[3px] text-red-700',
  intermediate: 'border-amber-500 border-double border-[3px] text-amber-700',
  boundary: 'border-amber-500 border-dashed text-amber-700',
}

export const EventNode = memo(({ id, data, selected, variant }: EventNodeProps) => {
  const updateNodeData = useWorkbenchStore((s) => s.updateNodeData)

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border-2 bg-white ${
          VARIANT_STYLE[variant]
        } ${selected ? 'ring-2 ring-sky-600/30' : ''}`}
      >
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-sky-600" />
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-sky-600" />
      </div>
      <input
        value={data.label || ''}
        onChange={(e) => updateNodeData(id, { label: e.target.value })}
        className="w-20 bg-transparent text-center text-[10px] text-slate-700 outline-none"
      />
    </div>
  )
})
EventNode.displayName = 'EventNode'

export const StartEventNode = memo((props: NodeProps) => (
  <EventNode {...props} data={props.data as NodeData} variant="start" />
))
StartEventNode.displayName = 'StartEventNode'

export const EndEventNode = memo((props: NodeProps) => (
  <EventNode {...props} data={props.data as NodeData} variant="end" />
))
EndEventNode.displayName = 'EndEventNode'

export const IntermediateEventNode = memo((props: NodeProps) => (
  <EventNode {...props} data={props.data as NodeData} variant="intermediate" />
))
IntermediateEventNode.displayName = 'IntermediateEventNode'

export const BoundaryEventNode = memo((props: NodeProps) => (
  <EventNode {...props} data={props.data as NodeData} variant="boundary" />
))
BoundaryEventNode.displayName = 'BoundaryEventNode'
