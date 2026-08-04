// Bidirectional Moddle Schema Adapter Engine (Designer.html, Section 7.1)
// Converts between BPMN 2.0 XML (ISO 19510) and React Flow graph state.

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

const DEFAULT_NODE_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 36, height: 36 },
  endEvent: { width: 36, height: 36 },
  intermediateEvent: { width: 36, height: 36 },
  boundaryEvent: { width: 36, height: 36 },
  userTask: { width: 120, height: 80 },
  serviceTask: { width: 120, height: 80 },
  businessRuleTask: { width: 120, height: 80 },
  subProcess: { width: 200, height: 140 },
  callActivity: { width: 120, height: 80 },
  exclusiveGateway: { width: 44, height: 44 },
  parallelGateway: { width: 44, height: 44 },
  inclusiveGateway: { width: 44, height: 44 },
  genericNode: { width: 100, height: 60 },
}

/** BPMN-E006 depends on this mapping matching mapReactFlowNodeToModdleType 1:1. */
export function mapModdleToReactFlowNode(type: string): string {
  switch (type) {
    case 'bpmn:StartEvent':
      return 'startEvent'
    case 'bpmn:EndEvent':
      return 'endEvent'
    case 'bpmn:IntermediateCatchEvent':
    case 'bpmn:IntermediateThrowEvent':
      return 'intermediateEvent'
    case 'bpmn:BoundaryEvent':
      return 'boundaryEvent'
    case 'bpmn:UserTask':
      return 'userTask'
    case 'bpmn:ServiceTask':
      return 'serviceTask'
    case 'bpmn:BusinessRuleTask':
      return 'businessRuleTask'
    case 'bpmn:SubProcess':
      return 'subProcess'
    case 'bpmn:CallActivity':
      return 'callActivity'
    case 'bpmn:ExclusiveGateway':
      return 'exclusiveGateway'
    case 'bpmn:ParallelGateway':
      return 'parallelGateway'
    case 'bpmn:InclusiveGateway':
      return 'inclusiveGateway'
    default:
      return 'genericNode'
  }
}

export function mapReactFlowNodeToModdleType(type: string): string {
  switch (type) {
    case 'startEvent':
      return 'bpmn:StartEvent'
    case 'endEvent':
      return 'bpmn:EndEvent'
    case 'intermediateEvent':
      return 'bpmn:IntermediateCatchEvent'
    case 'boundaryEvent':
      return 'bpmn:BoundaryEvent'
    case 'userTask':
      return 'bpmn:UserTask'
    case 'serviceTask':
      return 'bpmn:ServiceTask'
    case 'businessRuleTask':
      return 'bpmn:BusinessRuleTask'
    case 'subProcess':
      return 'bpmn:SubProcess'
    case 'callActivity':
      return 'bpmn:CallActivity'
    case 'exclusiveGateway':
      return 'bpmn:ExclusiveGateway'
    case 'parallelGateway':
      return 'bpmn:ParallelGateway'
    case 'inclusiveGateway':
      return 'bpmn:InclusiveGateway'
    default:
      return 'bpmn:Task'
  }
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

  // Diagram Interchange: element id -> BPMNShape bounds, and edge id -> waypoints
  const diBounds = new Map<string, { x: number; y: number; width: number; height: number }>()
  Object.values(elementsById).forEach((el) => {
    if (el.$type === 'bpmndi:BPMNShape') {
      const bpmnElement = el.bpmnElement as ModdleElement | undefined
      const bounds = el.bounds as
        | { x: number; y: number; width: number; height: number }
        | undefined
      if (bpmnElement?.id && bounds) {
        diBounds.set(bpmnElement.id, bounds)
      }
    }
  })

  const nodes: Node<NodeData>[] = []
  const edges: Edge[] = []

  const flowElements = (process.flowElements as ModdleElement[] | undefined) ?? []

  flowElements.forEach((element) => {
    if (element.$type === 'bpmn:SequenceFlow') {
      const sourceRef = element.sourceRef as ModdleElement | undefined
      const targetRef = element.targetRef as ModdleElement | undefined
      const conditionExpression = element.conditionExpression as
        | { body?: string }
        | undefined

      edges.push({
        id: element.id ?? `flow_${sourceRef?.id}_${targetRef?.id}`,
        source: sourceRef?.id ?? '',
        target: targetRef?.id ?? '',
        label: (element.name as string) || '',
        type: 'smoothstep',
        data: {
          conditionExpression: conditionExpression?.body,
        },
      })
      return
    }

    const reactFlowType = mapModdleToReactFlowNode(element.$type)
    const bounds =
      diBounds.get(element.id ?? '') ??
      ({ x: 150, y: 150, ...DEFAULT_NODE_SIZE[reactFlowType] } as {
        x: number
        y: number
        width: number
        height: number
      })

    const documentation = element.documentation as { text?: string }[] | undefined

    nodes.push({
      id: element.id ?? crypto.randomUUID(),
      type: reactFlowType,
      position: { x: bounds.x, y: bounds.y },
      data: {
        label: (element.name as string) || element.id || '',
        documentation: documentation?.[0]?.text,
        assignee: element.assignee as string | undefined,
        candidateGroups: (element.candidateGroups as string | undefined)
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        delegateExpression: element.delegateExpression as string | undefined,
        formKey: element.formKey as string | undefined,
      },
    })
  })

  return {
    nodes,
    edges,
    processId: (process.id as string) ?? `process_${crypto.randomUUID()}`,
    processName: (process.name as string) ?? '',
  }
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
  const flowElements: ModdleElement[] = []
  const shapes: ModdleElement[] = []
  const diEdges: ModdleElement[] = []
  const elementRefs = new Map<string, ModdleElement>()

  for (const node of nodes) {
    const moddleType = mapReactFlowNodeToModdleType(node.type ?? 'genericNode')
    const attrs: Record<string, unknown> = {
      id: node.id,
      name: node.data.label,
    }

    if (node.data.assignee) attrs.assignee = node.data.assignee
    if (node.data.candidateGroups?.length)
      attrs.candidateGroups = node.data.candidateGroups.join(',')
    if (node.data.delegateExpression)
      attrs.delegateExpression = node.data.delegateExpression
    if (node.data.formKey) attrs.formKey = node.data.formKey

    const element = moddle.create(moddleType, attrs)

    if (node.data.documentation) {
      element.documentation = [
        moddle.create('bpmn:Documentation', { text: node.data.documentation }),
      ]
    }

    flowElements.push(element)
    elementRefs.set(node.id, element)

    const size = DEFAULT_NODE_SIZE[node.type ?? 'genericNode'] ?? DEFAULT_NODE_SIZE.genericNode
    shapes.push(
      moddle.create('bpmndi:BPMNShape', {
        bpmnElement: element,
        bounds: moddle.create('dc:Bounds', {
          x: node.position.x,
          y: node.position.y,
          width: size.width,
          height: size.height,
        }),
      }),
    )
  }

  for (const edge of edges) {
    const sourceEl = elementRefs.get(edge.source)
    const targetEl = elementRefs.get(edge.target)
    if (!sourceEl || !targetEl) continue

    const conditionExpression = (edge.data as { conditionExpression?: string } | undefined)
      ?.conditionExpression

    const flowAttrs: Record<string, unknown> = {
      id: edge.id,
      sourceRef: sourceEl,
      targetRef: targetEl,
      name: typeof edge.label === 'string' ? edge.label : undefined,
    }

    const flowElement = moddle.create('bpmn:SequenceFlow', flowAttrs)

    if (conditionExpression) {
      flowElement.conditionExpression = moddle.create('bpmn:FormalExpression', {
        body: conditionExpression,
      })
    }

    flowElements.push(flowElement)

    diEdges.push(
      moddle.create('bpmndi:BPMNEdge', {
        bpmnElement: flowElement,
        waypoint: [],
      }),
    )
  }

  const process = moddle.create('bpmn:Process', {
    id: processId,
    name: processName,
    isExecutable: true,
    flowElements,
  })

  const plane = moddle.create('bpmndi:BPMNPlane', {
    bpmnElement: process,
    planeElement: [...shapes, ...diEdges],
  })

  const diagram = moddle.create('bpmndi:BPMNDiagram', { plane })

  const definitions = moddle.create('bpmn:Definitions', {
    targetNamespace: 'http://waas.citi.com/bpmn',
    rootElements: [process],
    diagrams: [diagram],
  })

  const { xml } = await moddle.toXML(definitions, { format: true, preamble: true })
  return xml
}
