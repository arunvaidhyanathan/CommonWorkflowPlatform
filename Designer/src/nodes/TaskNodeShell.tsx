// Shared chrome for activity nodes (Designer.html Section 9), styled per the
// Citi light-blue theme. Individual task types wrap this with their own
// badge label and color accent.
import { memo } from 'react'
import { Handle, Position, type NodeProps, NodeToolbar } from '@xyflow/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { NodeData } from '../store/useWorkbenchStore'
import type { BpmnNodeData } from '../adapters/bpmnAdapter'

/** Multi-instance, compensation, event/ad-hoc sub-process and container markers. */
function ActivityMarkers({ data }: { data: NodeData }) {
  const d = data as NodeData & BpmnNodeData
  const parentLabel = useWorkbenchStore((s) =>
    d.parentId ? (s.nodes.find((n) => n.id === d.parentId)?.data.label ?? d.parentId) : null,
  )
  const markers = [
    d.multiInstance ? (d.multiInstance.sequential ? 'multi: sequential' : 'multi: parallel') : null,
    d.multiInstance?.aggregations?.length ? `collects ${d.multiInstance.aggregations.map((a) => a.target).join(', ')}` : null,
    d.isForCompensation ? 'compensation' : null,
    d.triggeredByEvent ? 'event sub-process' : null,
    d.serviceType === 'mail' ? 'sends mail' : null,
    d.serviceType === 'case' ? `starts case ${d.caseDefinitionKey ?? ''}` : null,
    d.calledElement ? `calls ${d.calledElement}` : null,
    d.decisionRef ? `decision ${d.decisionRef}` : null,
  ].filter((m): m is string => m !== null)
  if (!markers.length && !parentLabel) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-0.5">
      {markers.map((m) => (
        <span key={m} className="truncate rounded bg-slate-100 px-1 text-[8px] font-bold uppercase text-slate-500">{m}</span>
      ))}
      {parentLabel && <span className="truncate rounded bg-violet-100 px-1 text-[8px] text-violet-700">in: {parentLabel}</span>}
    </div>
  )
}

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

        <ActivityMarkers data={data} />
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
