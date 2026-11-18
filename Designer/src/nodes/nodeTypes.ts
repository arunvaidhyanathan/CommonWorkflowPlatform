import type { NodeTypes } from '@xyflow/react'
import type { SpecType } from '../store/useWorkbenchStore'
import {
  StartEventNode,
  EndEventNode,
  IntermediateEventNode,
  BoundaryEventNode,
} from './EventNode'
import {
  UserTaskNode,
  ServiceTaskNode,
  BusinessRuleTaskNode,
  CallActivityNode,
  SubProcessNode,
  GenericNode,
  ScriptTaskNode,
  AdHocSubProcessNode,
} from './TaskNodes'
import {
  ExclusiveGatewayNode,
  ParallelGatewayNode,
  InclusiveGatewayNode,
} from './GatewayNode'
import {
  CmmnHumanTaskNode,
  CmmnTaskNode,
  CmmnMilestoneNode,
  CmmnStageNode,
  CmmnSentryNode,
  CmmnDecisionTaskNode,
  CmmnProcessTaskNode,
  CmmnCaseTaskNode,
  CmmnTimerListenerNode,
  CmmnUserListenerNode,
  CmmnCasePlanNode,
} from './CmmnNodes'

// All node types are registered together (keys never collide across specs),
// so switching activeSpec never requires swapping the nodeTypes prop —
// only the palette offered to the user changes.
export const nodeTypes: NodeTypes = {
  // BPMN
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  intermediateEvent: IntermediateEventNode,
  boundaryEvent: BoundaryEventNode,
  userTask: UserTaskNode,
  serviceTask: ServiceTaskNode,
  businessRuleTask: BusinessRuleTaskNode,
  callActivity: CallActivityNode,
  subProcess: SubProcessNode,
  scriptTask: ScriptTaskNode,
  adHocSubProcess: AdHocSubProcessNode,
  exclusiveGateway: ExclusiveGatewayNode,
  parallelGateway: ParallelGatewayNode,
  inclusiveGateway: InclusiveGatewayNode,
  genericNode: GenericNode,
  // CMMN
  cmmnHumanTask: CmmnHumanTaskNode,
  cmmnTask: CmmnTaskNode,
  cmmnMilestone: CmmnMilestoneNode,
  cmmnStage: CmmnStageNode,
  cmmnSentry: CmmnSentryNode,
  cmmnDecisionTask: CmmnDecisionTaskNode,
  cmmnProcessTask: CmmnProcessTaskNode,
  cmmnCaseTask: CmmnCaseTaskNode,
  cmmnTimerListener: CmmnTimerListenerNode,
  cmmnUserListener: CmmnUserListenerNode,
  cmmnCasePlan: CmmnCasePlanNode,
}

interface PaletteItem {
  type: string
  label: string
  category: string
}

export const BPMN_PALETTE_ITEMS: PaletteItem[] = [
  { type: 'startEvent', label: 'Start Event', category: 'Events' },
  { type: 'endEvent', label: 'End Event', category: 'Events' },
  { type: 'intermediateEvent', label: 'Intermediate Event', category: 'Events' },
  { type: 'boundaryEvent', label: 'Boundary Event', category: 'Events' },
  { type: 'userTask', label: 'User Task', category: 'Activities' },
  { type: 'serviceTask', label: 'Service / Mail / Case Task', category: 'Activities' },
  { type: 'scriptTask', label: 'Script Task', category: 'Activities' },
  { type: 'businessRuleTask', label: 'Business Rule Task', category: 'Activities' },
  { type: 'callActivity', label: 'Call Activity', category: 'Activities' },
  { type: 'subProcess', label: 'Sub-Process / Event Sub-Process', category: 'Activities' },
  { type: 'adHocSubProcess', label: 'Ad-hoc Sub-Process', category: 'Activities' },
  { type: 'exclusiveGateway', label: 'Exclusive Gateway', category: 'Gateways' },
  { type: 'parallelGateway', label: 'Parallel Gateway', category: 'Gateways' },
  { type: 'inclusiveGateway', label: 'Inclusive Gateway', category: 'Gateways' },
]

export const CMMN_PALETTE_ITEMS: PaletteItem[] = [
  { type: 'cmmnHumanTask', label: 'Human Task', category: 'Plan Items' },
  { type: 'cmmnTask', label: 'Task', category: 'Plan Items' },
  { type: 'cmmnMilestone', label: 'Milestone', category: 'Plan Items' },
  { type: 'cmmnStage', label: 'Stage', category: 'Plan Items' },
  { type: 'cmmnDecisionTask', label: 'Decision Task', category: 'Plan Items' },
  { type: 'cmmnProcessTask', label: 'Process Task', category: 'Plan Items' },
  { type: 'cmmnCaseTask', label: 'Case Task', category: 'Plan Items' },
  { type: 'cmmnTimerListener', label: 'Timer Listener', category: 'Event Listeners' },
  { type: 'cmmnUserListener', label: 'User Event Listener', category: 'Event Listeners' },
  { type: 'cmmnSentry', label: 'Sentry', category: 'Sentries' },
  { type: 'cmmnCasePlan', label: 'Case Plan (settings)', category: 'Case' },
]

export function getPaletteItems(spec: SpecType): PaletteItem[] {
  return spec === 'CMMN' ? CMMN_PALETTE_ITEMS : BPMN_PALETTE_ITEMS
}

/** Back-compat alias for existing BPMN-only call sites. */
export const PALETTE_ITEMS = BPMN_PALETTE_ITEMS
