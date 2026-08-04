// CMMN node components (Designer.html Section 7.2). Stage renders as an
// opaque node in v1 (no true nested containment yet — see design doc).
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { NodeData } from '../store/useWorkbenchStore'

function LabelInput({ id, label }: { id: string; label: string }) {
  const updateNodeData = useWorkbenchStore((s) => s.updateNodeData)
  return (
    <input
      value={label}
      onChange={(e) => updateNodeData(id, { label: e.target.value })}
      className="w-full bg-transparent text-center text-xs font-medium text-slate-800 outline-none"
    />
  )
}

export const CmmnHumanTaskNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <div
      className={`relative min-w-[140px] rounded-lg border-2 bg-white p-2.5 shadow-md ${
        selected ? 'border-sky-600 ring-2 ring-sky-600/20' : 'border-slate-300'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-600" />
      <div className="mb-1 flex items-center gap-1.5">
        <div className="rounded bg-indigo-100 p-1 font-mono text-[10px] font-bold text-indigo-700">
          HT
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-700">
          Human Task
        </span>
      </div>
      <LabelInput id={id} label={d.label} />
      {d.performerRef ? (
        <div className="mt-1 truncate rounded bg-indigo-50 p-1 text-[10px] text-indigo-600">
          performer: {String(d.performerRef)}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-sky-600" />
    </div>
  )
})
CmmnHumanTaskNode.displayName = 'CmmnHumanTaskNode'

export const CmmnTaskNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <div
      className={`relative min-w-[140px] rounded-lg border-2 bg-white p-2.5 shadow-md ${
        selected ? 'border-sky-600 ring-2 ring-sky-600/20' : 'border-slate-300'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-600" />
      <div className="mb-1 flex items-center gap-1.5">
        <div className="rounded bg-slate-200 p-1 font-mono text-[10px] font-bold text-slate-700">
          T
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Task</span>
      </div>
      <LabelInput id={id} label={d.label} />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-sky-600" />
    </div>
  )
})
CmmnTaskNode.displayName = 'CmmnTaskNode'

export const CmmnMilestoneNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <div
      className={`relative flex min-w-[140px] items-center justify-center rounded-full border-2 bg-amber-50 px-4 py-2.5 shadow-md ${
        selected ? 'border-sky-600 ring-2 ring-sky-600/20' : 'border-amber-500'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-600" />
      <LabelInput id={id} label={d.label} />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-sky-600" />
    </div>
  )
})
CmmnMilestoneNode.displayName = 'CmmnMilestoneNode'

export const CmmnStageNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <div
      className={`relative min-w-[180px] rounded-md border-[3px] bg-violet-50 p-3 shadow-md ${
        selected ? 'border-sky-600 ring-2 ring-sky-600/20' : 'border-violet-400'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-600" />
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-violet-700">
        Stage
      </div>
      <LabelInput id={id} label={d.label} />
      <div className="mt-1 text-[9px] text-violet-500">
        (opaque in v1 — contents not expanded)
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-sky-600" />
    </div>
  )
})
CmmnStageNode.displayName = 'CmmnStageNode'

export const CmmnSentryNode = memo(({ data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`relative flex h-8 w-8 rotate-45 items-center justify-center border-2 bg-white ${
          selected ? 'border-sky-600 ring-2 ring-sky-600/30' : 'border-slate-700'
        }`}
      >
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
      <div className="w-28 text-center text-[10px] text-slate-600">{d.label}</div>
      {d.conditionExpression ? (
        <div className="max-w-[140px] truncate rounded bg-slate-100 px-1 font-mono text-[9px] text-slate-500">
          if: {String(d.conditionExpression)}
        </div>
      ) : null}
    </div>
  )
})
CmmnSentryNode.displayName = 'CmmnSentryNode'
