import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { NodeData } from '../store/useWorkbenchStore'

interface GatewayNodeProps extends NodeProps {
  data: NodeData
  symbol: string
  variant: 'exclusive' | 'parallel' | 'inclusive'
}

const VARIANT_STYLE: Record<GatewayNodeProps['variant'], string> = {
  exclusive: 'text-amber-600 border-amber-500',
  parallel: 'text-sky-600 border-sky-500',
  inclusive: 'text-indigo-600 border-indigo-500',
}

export const GatewayNode = memo(({ id, data, selected, symbol, variant }: GatewayNodeProps) => {
  const updateNodeData = useWorkbenchStore((s) => s.updateNodeData)

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`relative flex h-11 w-11 rotate-45 items-center justify-center border-2 bg-white ${
          VARIANT_STYLE[variant]
        } ${selected ? 'ring-2 ring-sky-600/30' : ''}`}
      >
        <span className="-rotate-45 text-base font-bold">{symbol}</span>
        <Handle
          type="target"
          position={Position.Left}
          className="!-rotate-45 !h-2 !w-2 !bg-sky-600"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!-rotate-45 !h-2 !w-2 !bg-sky-600"
        />
      </div>
      <input
        value={data.label || ''}
        onChange={(e) => updateNodeData(id, { label: e.target.value })}
        className="w-24 bg-transparent text-center text-[10px] text-slate-700 outline-none"
      />
    </div>
  )
})
GatewayNode.displayName = 'GatewayNode'

export const ExclusiveGatewayNode = memo((props: NodeProps) => (
  <GatewayNode {...props} data={props.data as NodeData} symbol="X" variant="exclusive" />
))
ExclusiveGatewayNode.displayName = 'ExclusiveGatewayNode'

export const ParallelGatewayNode = memo((props: NodeProps) => (
  <GatewayNode {...props} data={props.data as NodeData} symbol="+" variant="parallel" />
))
ParallelGatewayNode.displayName = 'ParallelGatewayNode'

export const InclusiveGatewayNode = memo((props: NodeProps) => (
  <GatewayNode {...props} data={props.data as NodeData} symbol="O" variant="inclusive" />
))
InclusiveGatewayNode.displayName = 'InclusiveGatewayNode'
