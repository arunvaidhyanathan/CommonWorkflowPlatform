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
  { type: 'serviceTask', label: 'Service Task', category: 'Activities' },
  { type: 'businessRuleTask', label: 'Business Rule Task', category: 'Activities' },
  { type: 'callActivity', label: 'Call Activity', category: 'Activities' },
  { type: 'subProcess', label: 'Sub-Process', category: 'Activities' },
  { type: 'exclusiveGateway', label: 'Exclusive Gateway', category: 'Gateways' },
  { type: 'parallelGateway', label: 'Parallel Gateway', category: 'Gateways' },
  { type: 'inclusiveGateway', label: 'Inclusive Gateway', category: 'Gateways' },
]

export const CMMN_PALETTE_ITEMS: PaletteItem[] = [
  { type: 'cmmnHumanTask', label: 'Human Task', category: 'Plan Items' },
  { type: 'cmmnTask', label: 'Task', category: 'Plan Items' },
  { type: 'cmmnMilestone', label: 'Milestone', category: 'Plan Items' },
  { type: 'cmmnStage', label: 'Stage', category: 'Plan Items' },
  { type: 'cmmnSentry', label: 'Sentry', category: 'Sentries' },
]

export function getPaletteItems(spec: SpecType): PaletteItem[] {
  return spec === 'CMMN' ? CMMN_PALETTE_ITEMS : BPMN_PALETTE_ITEMS
}

/** Back-compat alias for existing BPMN-only call sites. */
export const PALETTE_ITEMS = BPMN_PALETTE_ITEMS
