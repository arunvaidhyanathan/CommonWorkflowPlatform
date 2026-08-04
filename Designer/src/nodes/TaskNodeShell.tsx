// Shared chrome for activity nodes (Designer.html Section 9), styled per the
// Citi light-blue theme. Individual task types wrap this with their own
// badge label and color accent.
import { memo } from 'react'
import { Handle, Position, type NodeProps, NodeToolbar } from '@xyflow/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { NodeData } from '../store/useWorkbenchStore'

interface TaskNodeShellProps extends NodeProps {
  data: NodeData
  badge: string
  badgeClassName: string
  subtitle?: string
}

export const TaskNodeShell = memo(
  ({ id, data, selected, badge, badgeClassName, subtitle }: TaskNodeShellProps) => {
    const updateNodeData = useWorkbenchStore((s) => s.updateNodeData)
    const removeNode = useWorkbenchStore((s) => s.removeNode)

    return (
      <div
        className={`relative min-w-[180px] rounded-lg border-2 bg-white p-3 shadow-md ${
          selected ? 'border-sky-600 ring-2 ring-sky-600/20' : 'border-slate-300'
        }`}
      >
        <NodeToolbar
          isVisible={selected}
          position={Position.Top}
          className="flex gap-1 rounded border border-sky-200 bg-sky-50 p-1"
        >
          <button
            type="button"
            onClick={() => removeNode(id)}
            className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            Delete
          </button>
        </NodeToolbar>

        <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-600" />

        <div className="flex items-center gap-2">
          <div className={`rounded p-1.5 font-mono text-xs font-bold ${badgeClassName}`}>
            {badge}
          </div>
          <div className="flex-1">
            {subtitle && (
              <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                {subtitle}
              </div>
            )}
            <input
              type="text"
              value={data.label || ''}
              onChange={(e) => updateNodeData(id, { label: e.target.value })}
              className="w-full bg-transparent text-xs font-medium text-slate-800 outline-none focus:border-b focus:border-sky-600"
            />
          </div>
        </div>

        {data.delegateExpression && (
          <div className="mt-2 truncate rounded bg-sky-50 p-1 font-mono text-[10px] text-slate-500">
            {data.delegateExpression}
          </div>
        )}
        {data.formKey && (
          <div className="mt-2 truncate rounded bg-emerald-50 p-1 font-mono text-[10px] text-emerald-700">
            form: {data.formKey}
          </div>
        )}

        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-sky-600" />
      </div>
    )
  },
)
TaskNodeShell.displayName = 'TaskNodeShell'
