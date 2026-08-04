import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { TaskNodeShell } from './TaskNodeShell'
import type { NodeData } from '../store/useWorkbenchStore'

export const UserTaskNode = memo((props: NodeProps) => (
  <TaskNodeShell
    {...props}
    data={props.data as NodeData}
    badge="UT"
    badgeClassName="bg-indigo-100 text-indigo-700"
    subtitle="User Task"
  />
))
UserTaskNode.displayName = 'UserTaskNode'

export const ServiceTaskNode = memo((props: NodeProps) => (
  <TaskNodeShell
    {...props}
    data={props.data as NodeData}
    badge="ST"
    badgeClassName="bg-sky-100 text-sky-700"
    subtitle="Service Task"
  />
))
ServiceTaskNode.displayName = 'ServiceTaskNode'

export const BusinessRuleTaskNode = memo((props: NodeProps) => (
  <TaskNodeShell
    {...props}
    data={props.data as NodeData}
    badge="BR"
    badgeClassName="bg-emerald-100 text-emerald-700"
    subtitle="Business Rule Task"
  />
))
BusinessRuleTaskNode.displayName = 'BusinessRuleTaskNode'

export const CallActivityNode = memo((props: NodeProps) => (
  <TaskNodeShell
    {...props}
    data={props.data as NodeData}
    badge="CA"
    badgeClassName="bg-slate-200 text-slate-700"
    subtitle="Call Activity"
  />
))
CallActivityNode.displayName = 'CallActivityNode'

export const SubProcessNode = memo((props: NodeProps) => (
  <TaskNodeShell
    {...props}
    data={props.data as NodeData}
    badge="SP"
    badgeClassName="bg-violet-100 text-violet-700"
    subtitle="Sub-Process"
  />
))
SubProcessNode.displayName = 'SubProcessNode'

export const GenericNode = memo((props: NodeProps) => (
  <TaskNodeShell
    {...props}
    data={props.data as NodeData}
    badge="?"
    badgeClassName="bg-slate-200 text-slate-600"
    subtitle="Unmapped Element"
  />
))
GenericNode.displayName = 'GenericNode'
