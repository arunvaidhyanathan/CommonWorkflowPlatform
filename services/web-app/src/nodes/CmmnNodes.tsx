// CMMN node components (Designer.html Section 7.2). The canvas is flat:
// items inside a stage show an "in: <stage>" marker (data.parentStage) and
// are placed in the stage when saved. Item controls (required, manual
// activation, repetition) show as small markers on the node.
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import type { NodeData } from '../store/useWorkbenchStore'

/** Required / manual activation / repetition / stage-membership markers. */
export function ItemControlMarkers({ data }: { data: NodeData }) {
  const stageId = data.parentStage as string | undefined
  const stageLabel = useWorkbenchStore((s) =>
    stageId ? (s.nodes.find((n) => n.id === stageId)?.data.label ?? stageId) : null,
  )
  const markers = [
    data.required ? { text: 'required', title: 'Required: its stage cannot complete without it' } : null,
    data.manualActivation ? { text: 'manual', title: 'Manual activation: offered to a case worker to start' } : null,
    data.repetition ? { text: 'repeat', title: 'Repetition: can run more than once' } : null,
  ].filter((m): m is { text: string; title: string } => m !== null)
  if (!markers.length && !stageLabel) return null
  return (
    <div className="mt-1 flex flex-wrap gap-0.5">
      {markers.map((m) => (
        <span key={m.text} title={m.title} className="rounded bg-slate-100 px-1 text-[8px] font-bold uppercase text-slate-500">
          {m.text}
        </span>
      ))}
      {stageLabel && (
        <span title="Inside this stage" className="truncate rounded bg-violet-100 px-1 text-[8px] text-violet-700">
          in: {stageLabel}
        </span>
      )}
    </div>
  )
}

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
      {d.candidateGroups?.length ? (
        <div className="mt-1 truncate rounded bg-indigo-50 p-1 text-[10px] text-indigo-600">
          groups: {d.candidateGroups.join(', ')}
        </div>
      ) : null}
      <ItemControlMarkers data={d} />
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
      <ItemControlMarkers data={d} />
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
      <div>
        <LabelInput id={id} label={d.label} />
        <ItemControlMarkers data={d} />
      </div>
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
      {d.autoComplete ? (
        <div className="mt-1 text-[9px] text-violet-600">auto-completes when required work is done</div>
      ) : null}
      <ItemControlMarkers data={d} />
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

/** Shared shell for the plan item kinds that differ only by badge and detail line. */
function PlanItemShell({
  id,
  data,
  selected,
  badge,
  kind,
  tone,
  detail,
  rounded = 'rounded-lg',
}: {
  id: string
  data: NodeData
  selected: boolean
  badge: string
  kind: string
  tone: string
  detail?: string
  rounded?: string
}) {
  return (
    <div
      className={`relative min-w-[140px] ${rounded} border-2 bg-white p-2.5 shadow-md ${
        selected ? 'border-sky-600 ring-2 ring-sky-600/20' : 'border-slate-300'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-600" />
      <div className="mb-1 flex items-center gap-1.5">
        <div className={`rounded p-1 font-mono text-[10px] font-bold ${tone}`}>{badge}</div>
        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-600">{kind}</span>
      </div>
      <LabelInput id={id} label={data.label} />
      {detail ? <div className="mt-1 truncate rounded bg-slate-50 p-1 font-mono text-[10px] text-slate-600">{detail}</div> : null}
      <ItemControlMarkers data={data} />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-sky-600" />
    </div>
  )
}

export const CmmnDecisionTaskNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <PlanItemShell id={id} data={d} selected={selected} badge="DT" kind="Decision Task" tone="bg-emerald-100 text-emerald-700"
      detail={d.decisionKey ? `decision: ${String(d.decisionKey)}` : 'no decision key'} />
  )
})
CmmnDecisionTaskNode.displayName = 'CmmnDecisionTaskNode'

export const CmmnProcessTaskNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <PlanItemShell id={id} data={d} selected={selected} badge="PT" kind="Process Task" tone="bg-sky-100 text-sky-700"
      detail={d.processKey ? `process: ${String(d.processKey)}` : 'no process key'} />
  )
})
CmmnProcessTaskNode.displayName = 'CmmnProcessTaskNode'

export const CmmnCaseTaskNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <PlanItemShell id={id} data={d} selected={selected} badge="CT" kind="Case Task" tone="bg-violet-100 text-violet-700"
      detail={d.caseKey ? `case: ${String(d.caseKey)}` : 'no case key'} />
  )
})
CmmnCaseTaskNode.displayName = 'CmmnCaseTaskNode'

export const CmmnTimerListenerNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <PlanItemShell id={id} data={d} selected={selected} badge="TM" kind="Timer Listener" tone="bg-amber-100 text-amber-700"
      rounded="rounded-full" detail={d.timerExpression ? `after ${String(d.timerExpression)}` : 'no timer expression'} />
  )
})
CmmnTimerListenerNode.displayName = 'CmmnTimerListenerNode'

export const CmmnUserListenerNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  return (
    <PlanItemShell id={id} data={d} selected={selected} badge="UE" kind="User Event" tone="bg-rose-100 text-rose-700"
      rounded="rounded-full" detail="fired by a case worker" />
  )
})
CmmnUserListenerNode.displayName = 'CmmnUserListenerNode'

/** The case plan model: case-level settings. An exit edge into it ends the whole case. */
export const CmmnCasePlanNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as NodeData
  const roles = (d.roles as { name: string }[] | undefined) ?? []
  return (
    <div
      className={`relative min-w-[200px] rounded-md border-[3px] border-dashed bg-slate-50 p-3 shadow ${
        selected ? 'border-sky-600 ring-2 ring-sky-600/20' : 'border-slate-400'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-red-500" />
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-600">Case Plan</div>
      <LabelInput id={id} label={d.label} />
      <div className="mt-1 text-[9px] text-slate-500">
        {d.autoComplete ? 'auto-completes when required work is done' : 'completes when all work is done'}
        {roles.length ? ` · roles: ${roles.map((r) => r.name).join(', ')}` : ''}
      </div>
      <div className="text-[9px] text-red-500">exit edges here end the whole case</div>
    </div>
  )
})
CmmnCasePlanNode.displayName = 'CmmnCasePlanNode'
