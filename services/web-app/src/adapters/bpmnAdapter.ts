// Bidirectional Moddle Schema Adapter Engine (Designer.html, Section 7.1)
// Converts between BPMN 2.0 XML (ISO 19510) and React Flow graph state.
//
// The canvas is flat; nothing the engine depends on is lost on a save (see
// bpmnAdapter.test.ts):
//   - elements inside a sub-process / event sub-process / ad-hoc sub-process
//     carry `parentId` and are re-nested on save;
//   - events keep their event definition (timer, message, signal, error,
//     escalation, conditional, compensation, terminate, Flowable variable
//     listener), boundary attachment and interrupting flags, and throw vs catch;
//   - script tasks, mail and case service tasks (fields, in/out mappings),
//     call activities, business rule tasks, multi-instance (with Flowable
//     variable aggregation), compensation handlers and associations, gateway
//     default flows, and any other BPMN element type (kept by its type name).
// Signals, messages, errors and escalations are rebuilt from the events
// that reference them.

import { BpmnModdle, type ModdleElement } from 'bpmn-moddle'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData } from '../store/useWorkbenchStore'
import flowableDescriptor from './flowable-moddle-descriptor.json'

const moddle = new BpmnModdle({ flowable: flowableDescriptor })

export interface ModdleParseResult {
  nodes: Node<NodeData>[]
  edges: Edge[]
  processId: string
  processName: string
}

export type EventKind =
  | 'timer' | 'message' | 'signal' | 'error' | 'escalation' | 'conditional'
  | 'compensate' | 'terminate' | 'variableListener'

export interface BpmnEventDefinition {
  type: EventKind
  refId?: string
  name?: string
  code?: string
  scope?: string
  timer?: { kind: 'timeDuration' | 'timeDate' | 'timeCycle'; value: string }
  condition?: string
  variableName?: string
  changeType?: string
}

export interface FieldMapping {
  name: string
  value: string
  kind: 'string' | 'expression'
}

export interface IoMapping {
  source?: string
  sourceExpression?: string
  target: string
}

export interface MultiInstance {
  sequential: boolean
  collection?: string
  elementVariable?: string
  loopCardinality?: string
  completionCondition?: string
  aggregations?: { target: string; variables: { source: string; target: string }[] }[]
}

/** BPMN-specific node data (stored in NodeData's open record). */
export interface BpmnNodeData {
  parentId?: string
  bpmnType?: string
  throwing?: boolean
  eventDefinition?: BpmnEventDefinition
  attachedTo?: string
  cancelActivity?: boolean
  interrupting?: boolean
  scriptFormat?: string
  script?: string
  serviceType?: string
  fields?: FieldMapping[]
  caseDefinitionKey?: string
  inputs?: IoMapping[]
  outputs?: IoMapping[]
  calledElement?: string
  decisionRef?: string
  isForCompensation?: boolean
  triggeredByEvent?: boolean
  ordering?: string
  completionCondition?: string
  defaultFlow?: string
  multiInstance?: MultiInstance
}

const DEFAULT_NODE_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 36, height: 36 },
  endEvent: { width: 36, height: 36 },
  intermediateEvent: { width: 36, height: 36 },
  boundaryEvent: { width: 36, height: 36 },
  userTask: { width: 120, height: 80 },
  serviceTask: { width: 120, height: 80 },
  scriptTask: { width: 120, height: 80 },
  businessRuleTask: { width: 120, height: 80 },
  subProcess: { width: 200, height: 140 },
  adHocSubProcess: { width: 200, height: 140 },
  callActivity: { width: 120, height: 80 },
  exclusiveGateway: { width: 44, height: 44 },
  parallelGateway: { width: 44, height: 44 },
  inclusiveGateway: { width: 44, height: 44 },
  genericNode: { width: 100, height: 60 },
}

const TO_NODE: Record<string, string> = {
  'bpmn:StartEvent': 'startEvent',
  'bpmn:EndEvent': 'endEvent',
  'bpmn:IntermediateCatchEvent': 'intermediateEvent',
  'bpmn:IntermediateThrowEvent': 'intermediateEvent',
  'bpmn:BoundaryEvent': 'boundaryEvent',
  'bpmn:UserTask': 'userTask',
  'bpmn:ServiceTask': 'serviceTask',
  'bpmn:ScriptTask': 'scriptTask',
  'bpmn:BusinessRuleTask': 'businessRuleTask',
  'bpmn:SubProcess': 'subProcess',
  'bpmn:AdHocSubProcess': 'adHocSubProcess',
  'bpmn:CallActivity': 'callActivity',
  'bpmn:ExclusiveGateway': 'exclusiveGateway',
  'bpmn:ParallelGateway': 'parallelGateway',
  'bpmn:InclusiveGateway': 'inclusiveGateway',
}

/** BPMN-E006 depends on this mapping matching mapReactFlowNodeToModdleType 1:1. */
export function mapModdleToReactFlowNode(type: string): string {
  return TO_NODE[type] ?? 'genericNode'
}

export function mapReactFlowNodeToModdleType(type: string, data?: BpmnNodeData): string {
  if (type === 'intermediateEvent') return data?.throwing ? 'bpmn:IntermediateThrowEvent' : 'bpmn:IntermediateCatchEvent'
  if (type === 'genericNode') return data?.bpmnType ?? 'bpmn:Task'
  return Object.entries(TO_NODE).find(([, node]) => node === type)?.[0] ?? 'bpmn:Task'
}

const EVENT_TYPES: Record<string, EventKind> = {
  'bpmn:TimerEventDefinition': 'timer',
  'bpmn:MessageEventDefinition': 'message',
  'bpmn:SignalEventDefinition': 'signal',
  'bpmn:ErrorEventDefinition': 'error',
  'bpmn:EscalationEventDefinition': 'escalation',
  'bpmn:ConditionalEventDefinition': 'conditional',
  'bpmn:CompensateEventDefinition': 'compensate',
  'bpmn:TerminateEventDefinition': 'terminate',
}

const bodyOf = (expr: unknown) => ((expr as ModdleElement | undefined)?.body as string | undefined)?.trim() || undefined
const extensionValues = (el: ModdleElement | undefined) =>
  ((el?.extensionElements as ModdleElement | undefined)?.values as ModdleElement[] | undefined) ?? []
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as T

function readEventDefinition(el: ModdleElement): BpmnEventDefinition | undefined {
  const def = ((el.eventDefinitions as ModdleElement[] | undefined) ?? [])[0]
  if (def) {
    const ref = (def.signalRef ?? def.messageRef ?? def.errorRef ?? def.escalationRef) as ModdleElement | undefined
    const timerKind = (['timeDuration', 'timeDate', 'timeCycle'] as const).find((k) => def[k])
    return compact({
      type: EVENT_TYPES[def.$type] ?? 'terminate',
      refId: ref?.id as string | undefined,
      name: ref?.name as string | undefined,
      code: (ref?.errorCode ?? ref?.escalationCode) as string | undefined,
      scope: ref?.scope as string | undefined,
      timer: timerKind ? { kind: timerKind, value: bodyOf(def[timerKind]) ?? '' } : undefined,
      condition: bodyOf(def.condition),
    })
  }
  const listener = extensionValues(el).find((v) => v.$type === 'flowable:VariableListenerEventDefinition')
  return listener
    ? compact({
        type: 'variableListener' as const,
        variableName: listener.variableName as string | undefined,
        changeType: listener.variableChangeType as string | undefined,
      })
    : undefined
}

function readMultiInstance(el: ModdleElement): MultiInstance | undefined {
  const loop = el.loopCharacteristics as ModdleElement | undefined
  if (loop?.$type !== 'bpmn:MultiInstanceLoopCharacteristics') return undefined
  const aggregations = extensionValues(loop)
    .filter((v) => v.$type === 'flowable:VariableAggregation')
    .map((a) => ({
      target: a.target as string,
      variables: ((a.variable as ModdleElement[] | undefined) ?? []).map((v) => ({
        source: v.source as string,
        target: v.target as string,
      })),
    }))
  return compact({
    sequential: Boolean(loop.isSequential),
    collection: loop.collection as string | undefined,
    elementVariable: loop.elementVariable as string | undefined,
    loopCardinality: bodyOf(loop.loopCardinality),
    completionCondition: bodyOf(loop.completionCondition),
    aggregations,
  })
}

/**
 * Deserializes BPMN 2.0 XML into React Flow graph state (Section 7.1).
 * Honors Diagram Interchange (DI) bounds when present; callers should run
 * elkjs auto-layout (Section 5.2) when DI is absent, e.g. hand-authored XML.
 */
export async function parseBpmnXml(xmlString: string): Promise<ModdleParseResult> {
  const { rootElement, elementsById } = await moddle.fromXML(xmlString)

  const process = (rootElement.rootElements as ModdleElement[] | undefined)?.find(
    (el) => el.$type === 'bpmn:Process',
  )
  if (!process) {
    throw new Error(
      'BPMN-E101: No <bpmn:Process> found in the document. The XML does not conform to the BPMN 2.0 schema.',
    )
  }

  const diBounds = new Map<string, { x: number; y: number; width: number; height: number }>()
  Object.values(elementsById).forEach((el) => {
    if (el.$type === 'bpmndi:BPMNShape') {
      const bpmnElement = el.bpmnElement as ModdleElement | undefined
      const bounds = el.bounds as { x: number; y: number; width: number; height: number } | undefined
      if (bpmnElement?.id && bounds) diBounds.set(bpmnElement.id, bounds)
    }
  })

  const nodes: Node<NodeData>[] = []
  const edges: Edge[] = []
  let cursor = 0

  const walk = (container: ModdleElement, parentId: string | undefined, depth: number) => {
    for (const element of (container.flowElements as ModdleElement[] | undefined) ?? []) {
      if (element.$type === 'bpmn:SequenceFlow') {
        const sourceRef = element.sourceRef as ModdleElement | undefined
        const targetRef = element.targetRef as ModdleElement | undefined
        edges.push({
          id: element.id ?? `flow_${sourceRef?.id}_${targetRef?.id}`,
          source: sourceRef?.id ?? '',
          target: targetRef?.id ?? '',
          label: (element.name as string) || '',
          type: 'smoothstep',
          data: { conditionExpression: bodyOf(element.conditionExpression) },
        })
        continue
      }

      const type = mapModdleToReactFlowNode(element.$type)
      const bounds = diBounds.get(element.id ?? '') ?? {
        x: 150 + (cursor++ % 6) * 180,
        y: 150 + depth * 200 + Math.floor(cursor / 6) * 120,
        ...DEFAULT_NODE_SIZE[type],
      }
      const documentation = element.documentation as { text?: string }[] | undefined
      const values = extensionValues(element)
      const fields = values
        .filter((v) => v.$type === 'flowable:Field')
        .map((f) => ({
          name: f.name as string,
          value: ((f.expression ?? f.string ?? f.stringValue) as string | undefined) ?? '',
          kind: f.expression !== undefined ? ('expression' as const) : ('string' as const),
        }))
      const io = (t: string) =>
        values
          .filter((v) => v.$type === t)
          .map((m) => compact({ source: m.source as string | undefined, sourceExpression: m.sourceExpression as string | undefined, target: m.target as string }))

      const data: NodeData & BpmnNodeData = {
        label: (element.name as string) || element.id || '',
        documentation: documentation?.[0]?.text,
        assignee: element.assignee as string | undefined,
        candidateGroups: (element.candidateGroups as string | undefined)?.split(',').map((s) => s.trim()).filter(Boolean),
        delegateExpression: element.delegateExpression as string | undefined,
        formKey: element.formKey as string | undefined,
        parentId,
        bpmnType: type === 'genericNode' ? element.$type : undefined,
        throwing: element.$type === 'bpmn:IntermediateThrowEvent' || undefined,
        eventDefinition: readEventDefinition(element),
        attachedTo: (element.attachedToRef as ModdleElement | undefined)?.id,
        cancelActivity: element.$type === 'bpmn:BoundaryEvent' && element.cancelActivity === false ? false : undefined,
        interrupting: element.$type === 'bpmn:StartEvent' && element.isInterrupting === false ? false : undefined,
        scriptFormat: element.scriptFormat as string | undefined,
        script: (element.script as string | undefined)?.trim(),
        serviceType: element.type as string | undefined,
        fields,
        caseDefinitionKey: element.caseDefinitionKey as string | undefined,
        inputs: io('flowable:In'),
        outputs: io('flowable:Out'),
        calledElement: element.calledElement as string | undefined,
        decisionRef: element.decisionRef as string | undefined,
        isForCompensation: element.isForCompensation ? true : undefined,
        triggeredByEvent: element.triggeredByEvent ? true : undefined,
        ordering: element.ordering as string | undefined,
        completionCondition: bodyOf(element.completionCondition),
        defaultFlow: (element.default as ModdleElement | undefined)?.id,
        multiInstance: readMultiInstance(element),
      }
      nodes.push({
        id: element.id ?? crypto.randomUUID(),
        type,
        position: { x: bounds.x, y: bounds.y },
        data: compact(data) as NodeData,
      })

      if ((element.flowElements as ModdleElement[] | undefined)?.length) walk(element, element.id, depth + 1)
    }
    for (const artifact of (container.artifacts as ModdleElement[] | undefined) ?? []) {
      if (artifact.$type !== 'bpmn:Association') continue
      edges.push({
        id: artifact.id ?? crypto.randomUUID(),
        source: (artifact.sourceRef as ModdleElement).id as string,
        target: (artifact.targetRef as ModdleElement).id as string,
        type: 'straight',
        data: { kind: 'association' },
        style: { strokeDasharray: '4 4' },
      })
    }
  }
  walk(process, undefined, 0)

  return {
    nodes,
    edges,
    processId: (process.id as string) ?? `process_${crypto.randomUUID()}`,
    processName: (process.name as string) ?? '',
  }
}

// ---------------------------------------------------------------- serialize

const formal = (body: string) => moddle.create('bpmn:FormalExpression', { body })

function extensionElements(values: ModdleElement[]): ModdleElement | undefined {
  return values.length ? moddle.create('bpmn:ExtensionElements', { values }) : undefined
}

/** Shared root elements (signals, messages, errors, escalations), one per id. */
class RootElements {
  readonly all: ModdleElement[] = []
  private readonly byKey = new Map<string, ModdleElement>()

  get(def: BpmnEventDefinition): ModdleElement | undefined {
    const typeName = { signal: 'bpmn:Signal', message: 'bpmn:Message', error: 'bpmn:Error', escalation: 'bpmn:Escalation' }[
      def.type as 'signal' | 'message' | 'error' | 'escalation'
    ]
    if (!typeName || (!def.name && !def.code && !def.refId)) return undefined
    const key = `${typeName}:${def.refId ?? def.name ?? def.code}`
    const existing = this.byKey.get(key)
    if (existing) return existing
    const id = def.refId ?? `${typeName.slice(5)}_${(def.name ?? def.code ?? 'ref').replace(/\W+/g, '_')}`
    const element = moddle.create(typeName, {
      id,
      ...(def.name ? { name: def.name } : {}),
      ...(def.type === 'error' && def.code ? { errorCode: def.code } : {}),
      ...(def.type === 'escalation' && def.code ? { escalationCode: def.code } : {}),
      ...(def.type === 'signal' && def.scope ? { scope: def.scope } : {}),
    })
    this.byKey.set(key, element)
    this.all.push(element)
    return element
  }
}

function eventDefinitions(def: BpmnEventDefinition | undefined, roots: RootElements): ModdleElement[] {
  if (!def || def.type === 'variableListener') return []
  const ref = roots.get(def)
  switch (def.type) {
    case 'timer':
      return [moddle.create('bpmn:TimerEventDefinition', def.timer?.value ? { [def.timer.kind]: formal(def.timer.value) } : {})]
    case 'message':
      return [moddle.create('bpmn:MessageEventDefinition', ref ? { messageRef: ref } : {})]
    case 'signal':
      return [moddle.create('bpmn:SignalEventDefinition', ref ? { signalRef: ref } : {})]
    case 'error':
      return [moddle.create('bpmn:ErrorEventDefinition', ref ? { errorRef: ref } : {})]
    case 'escalation':
      return [moddle.create('bpmn:EscalationEventDefinition', ref ? { escalationRef: ref } : {})]
    case 'conditional':
      return [moddle.create('bpmn:ConditionalEventDefinition', { condition: formal(def.condition ?? '') })]
    case 'compensate':
      return [moddle.create('bpmn:CompensateEventDefinition', {})]
    default:
      return [moddle.create('bpmn:TerminateEventDefinition', {})]
  }
}

function multiInstance(mi: MultiInstance | undefined): ModdleElement | undefined {
  if (!mi) return undefined
  const aggregations = (mi.aggregations ?? []).map((a) =>
    moddle.create('flowable:VariableAggregation', {
      target: a.target,
      variable: a.variables.map((v) => moddle.create('flowable:Variable', { source: v.source, target: v.target })),
    }),
  )
  return moddle.create('bpmn:MultiInstanceLoopCharacteristics', {
    isSequential: mi.sequential,
    ...(mi.collection ? { collection: mi.collection } : {}),
    ...(mi.elementVariable ? { elementVariable: mi.elementVariable } : {}),
    ...(mi.loopCardinality ? { loopCardinality: formal(mi.loopCardinality) } : {}),
    ...(mi.completionCondition ? { completionCondition: formal(mi.completionCondition) } : {}),
    ...(aggregations.length ? { extensionElements: extensionElements(aggregations) } : {}),
  })
}

function createElement(node: Node<NodeData>, roots: RootElements): ModdleElement {
  const d = node.data as NodeData & BpmnNodeData
  const type = mapReactFlowNodeToModdleType(node.type ?? 'genericNode', d)
  // The canvas shows the id for an unnamed element; don't turn that into a name.
  const attrs: Record<string, unknown> = { id: node.id }
  if (d.label && d.label !== node.id) attrs.name = d.label
  if (d.assignee) attrs.assignee = d.assignee
  if (d.candidateGroups?.length) attrs.candidateGroups = d.candidateGroups.join(',')
  if (d.delegateExpression) attrs.delegateExpression = d.delegateExpression
  if (d.formKey) attrs.formKey = d.formKey
  if (d.scriptFormat) attrs.scriptFormat = d.scriptFormat
  if (d.script !== undefined) attrs.script = d.script
  if (d.serviceType) attrs.type = d.serviceType
  if (d.caseDefinitionKey) attrs.caseDefinitionKey = d.caseDefinitionKey
  if (d.calledElement) attrs.calledElement = d.calledElement
  if (d.decisionRef) attrs.decisionRef = d.decisionRef
  if (d.isForCompensation) attrs.isForCompensation = true
  if (d.triggeredByEvent) attrs.triggeredByEvent = true
  if (d.ordering) attrs.ordering = d.ordering
  if (d.completionCondition) attrs.completionCondition = formal(d.completionCondition)
  if (d.cancelActivity === false) attrs.cancelActivity = false
  if (d.interrupting === false) attrs.isInterrupting = false
  const defs = eventDefinitions(d.eventDefinition, roots)
  if (defs.length) attrs.eventDefinitions = defs
  const loop = multiInstance(d.multiInstance)
  if (loop) attrs.loopCharacteristics = loop

  const values: ModdleElement[] = [
    ...(d.fields ?? []).map((f) =>
      moddle.create('flowable:Field', { name: f.name, [f.kind === 'expression' ? 'expression' : 'string']: f.value }),
    ),
    ...(d.inputs ?? []).map((m) => moddle.create('flowable:In', compact({ ...m }))),
    ...(d.outputs ?? []).map((m) => moddle.create('flowable:Out', compact({ ...m }))),
    ...(d.eventDefinition?.type === 'variableListener'
      ? [moddle.create('flowable:VariableListenerEventDefinition', compact({
          variableName: d.eventDefinition.variableName,
          variableChangeType: d.eventDefinition.changeType,
        }))]
      : []),
  ]
  const ext = extensionElements(values)
  if (ext) attrs.extensionElements = ext

  const element = moddle.create(type, attrs)
  if (d.documentation) element.documentation = [moddle.create('bpmn:Documentation', { text: d.documentation })]
  return element
}

/**
 * Serializes React Flow graph state back to BPMN 2.0 XML, including
 * Diagram Interchange so the file round-trips through other ISO
 * 19510-conformant tooling without losing layout (Section 5.2).
 */
export async function serializeToBpmnXml(
  nodes: Node<NodeData>[],
  edges: Edge[],
  processId: string,
  processName: string,
): Promise<string> {
  const roots = new RootElements()
  const elementRefs = new Map<string, ModdleElement>()
  const shapes: ModdleElement[] = []
  const diEdges: ModdleElement[] = []

  const process = moddle.create('bpmn:Process', { id: processId, name: processName, isExecutable: true, flowElements: [] })
  const containerOf = (nodeId: string | undefined): ModdleElement => {
    const parent = nodeId ? (nodes.find((n) => n.id === nodeId)?.data as BpmnNodeData | undefined)?.parentId : undefined
    const container = parent ? elementRefs.get(parent) : undefined
    return container ?? process
  }

  for (const node of nodes) {
    const element = createElement(node, roots)
    elementRefs.set(node.id, element)
    const size = DEFAULT_NODE_SIZE[node.type ?? 'genericNode'] ?? DEFAULT_NODE_SIZE.genericNode
    shapes.push(
      moddle.create('bpmndi:BPMNShape', {
        id: `${node.id}_di`,
        bpmnElement: element,
        bounds: moddle.create('dc:Bounds', { x: node.position.x, y: node.position.y, width: size.width, height: size.height }),
      }),
    )
  }
  // Place each element in its sub-process (or the process), and attach boundary events.
  for (const node of nodes) {
    const element = elementRefs.get(node.id) as ModdleElement
    const container = containerOf(node.id)
    container.flowElements = [...((container.flowElements as ModdleElement[]) ?? []), element]
    const attachedTo = (node.data as BpmnNodeData).attachedTo
    if (attachedTo && elementRefs.get(attachedTo)) element.attachedToRef = elementRefs.get(attachedTo)
  }

  // BPMN DI requires at least two waypoints per edge; an edge without them makes
  // the whole file fail schema validation on deploy. Connect shape centres.
  const centre = (id: string) => {
    const n = nodes.find((x) => x.id === id) as Node<NodeData>
    const size = DEFAULT_NODE_SIZE[n.type ?? 'genericNode'] ?? DEFAULT_NODE_SIZE.genericNode
    return moddle.create('dc:Point', { x: n.position.x + size.width / 2, y: n.position.y + size.height / 2 })
  }
  const waypoints = (edge: Edge) => [centre(edge.source), centre(edge.target)]

  const flowById = new Map<string, ModdleElement>()
  for (const edge of edges) {
    const sourceEl = elementRefs.get(edge.source)
    const targetEl = elementRefs.get(edge.target)
    if (!sourceEl || !targetEl) continue
    const container = containerOf(edge.source)
    if ((edge.data as { kind?: string } | undefined)?.kind === 'association') {
      const association = moddle.create('bpmn:Association', {
        id: edge.id,
        sourceRef: sourceEl,
        targetRef: targetEl,
        associationDirection: 'One',
      })
      container.artifacts = [...((container.artifacts as ModdleElement[]) ?? []), association]
      diEdges.push(moddle.create('bpmndi:BPMNEdge', { id: `${edge.id}_di`, bpmnElement: association, waypoint: waypoints(edge) }))
      continue
    }
    const condition = (edge.data as { conditionExpression?: string } | undefined)?.conditionExpression
    const flow = moddle.create('bpmn:SequenceFlow', {
      id: edge.id,
      sourceRef: sourceEl,
      targetRef: targetEl,
      ...(typeof edge.label === 'string' && edge.label ? { name: edge.label } : {}),
      ...(condition ? { conditionExpression: formal(condition) } : {}),
    })
    sourceEl.outgoing = [...((sourceEl.outgoing as ModdleElement[]) ?? []), flow]
    targetEl.incoming = [...((targetEl.incoming as ModdleElement[]) ?? []), flow]
    container.flowElements = [...((container.flowElements as ModdleElement[]) ?? []), flow]
    flowById.set(edge.id, flow)
    diEdges.push(moddle.create('bpmndi:BPMNEdge', { id: `${edge.id}_di`, bpmnElement: flow, waypoint: waypoints(edge) }))
  }
  for (const node of nodes) {
    const defaultFlow = (node.data as BpmnNodeData).defaultFlow
    if (defaultFlow && flowById.get(defaultFlow)) (elementRefs.get(node.id) as ModdleElement).default = flowById.get(defaultFlow)
  }

  const plane = moddle.create('bpmndi:BPMNPlane', {
    id: `${processId}_plane`,
    bpmnElement: process,
    planeElement: [...shapes, ...diEdges],
  })
  const diagram = moddle.create('bpmndi:BPMNDiagram', { id: `${processId}_diagram`, plane })
  const definitions = moddle.create('bpmn:Definitions', {
    id: `Definitions_${processId}`,
    targetNamespace: 'http://waas.citi.com/bpmn',
    rootElements: [...roots.all, process],
    diagrams: [diagram],
  })

  const { xml } = await moddle.toXML(definitions, { format: true, preamble: true })
  return xml
}
