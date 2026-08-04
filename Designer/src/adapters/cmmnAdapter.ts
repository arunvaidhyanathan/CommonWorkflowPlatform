// CMMN Adapter (Designer.html Section 7.2): converts between CMMN 1.1 XML
// and React Flow graph state. v1 scope: a single, flat case plan model —
// Stage plan items render as opaque nodes rather than true nested
// containers (matches the design doc's stated simplification). Sentries
// become diamond nodes; onPart/entry/exit criteria become typed edges.
import CmmnModdle, { type ModdleElement } from 'cmmn-moddle'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData } from '../store/useWorkbenchStore'

const moddle = new CmmnModdle()

function fromXML(xml: string): Promise<{ rootElement: ModdleElement; warnings: unknown[] }> {
  return new Promise((resolve, reject) => {
    moddle.fromXML(xml, (err, result, context) => {
      if (err) reject(err)
      else resolve({ rootElement: result, warnings: context?.warnings ?? [] })
    })
  })
}

function toXML(element: ModdleElement): Promise<string> {
  return new Promise((resolve, reject) => {
    moddle.toXML(element, { format: true }, (err, xml) => {
      if (err) reject(err)
      else resolve(xml)
    })
  })
}

export interface CmmnParseResult {
  nodes: Node<NodeData>[]
  edges: Edge[]
  caseId: string
  caseName: string
}

function mapDefinitionToNodeType(defType: string | undefined): string {
  switch (defType) {
    case 'cmmn:HumanTask':
      return 'cmmnHumanTask'
    case 'cmmn:Milestone':
      return 'cmmnMilestone'
    case 'cmmn:Stage':
      return 'cmmnStage'
    case 'cmmn:Task':
    case 'cmmn:ProcessTask':
    case 'cmmn:CaseTask':
    case 'cmmn:DecisionTask':
    default:
      return 'cmmnTask'
  }
}

export async function parseCmmnXml(xmlString: string): Promise<CmmnParseResult> {
  const { rootElement } = await fromXML(xmlString)

  const cases = (rootElement.cases as ModdleElement[] | undefined) ?? []
  const theCase = cases[0]

  if (!theCase) {
    throw new Error('CMMN-E101: No <case> element found in the document.')
  }

  const casePlanModel = theCase.casePlanModel as ModdleElement | undefined
  if (!casePlanModel) {
    throw new Error('CMMN-E102: Case has no casePlanModel (case plan stage).')
  }

  const planItems = (casePlanModel.planItems as ModdleElement[] | undefined) ?? []
  const sentries = (casePlanModel.sentries as ModdleElement[] | undefined) ?? []

  const nodes: Node<NodeData>[] = []
  const edges: Edge[] = []
  let xCursor = 100

  const planItemNodeId = new Map<string, string>() // plan item element id -> node id
  const sentryNodeId = new Map<string, string>() // sentry element id -> node id

  planItems.forEach((planItem) => {
    const definitionRef = planItem.definitionRef as ModdleElement | undefined
    const nodeType = mapDefinitionToNodeType(definitionRef?.$type)
    const id = (planItem.id as string) ?? crypto.randomUUID()
    planItemNodeId.set(id, id)

    nodes.push({
      id,
      type: nodeType,
      position: { x: xCursor, y: 200 },
      data: {
        label: (planItem.name as string) || (definitionRef?.name as string) || id,
        documentation: undefined,
        isBlocking: definitionRef?.isBlocking as boolean | undefined,
        performerRef: (definitionRef?.performerRef as ModdleElement | undefined)?.id,
      },
    })
    xCursor += 220
  })

  sentries.forEach((sentry) => {
    const id = (sentry.id as string) ?? crypto.randomUUID()
    sentryNodeId.set(id, id)
    const onParts = (sentry.onParts as ModdleElement[] | undefined) ?? []
    const ifPart = sentry.ifPart as ModdleElement | undefined
    const ifPartExpr = ifPart?.condition as ModdleElement | undefined

    nodes.push({
      id,
      type: 'cmmnSentry',
      position: { x: xCursor, y: 350 },
      data: {
        label: (sentry.name as string) || 'Sentry',
        conditionExpression: (ifPartExpr?.body as string) || undefined,
      },
    })
    xCursor += 180

    // onPart.sourceRef -> this sentry (the referenced plan item's event triggers the sentry)
    onParts.forEach((onPart) => {
      const sourceRef = onPart.sourceRef as ModdleElement | undefined
      if (sourceRef?.id && planItemNodeId.has(sourceRef.id)) {
        edges.push({
          id: `onpart_${onPart.id ?? crypto.randomUUID()}`,
          source: sourceRef.id,
          target: id,
          type: 'smoothstep',
          label: (onPart.standardEvent as string) || '',
          data: { criterionType: 'onPart', standardEvent: onPart.standardEvent },
        })
      }
    })
  })

  // entry/exit criteria -> edge FROM the sentry TO the gated plan item
  planItems.forEach((planItem) => {
    const targetId = planItem.id as string
    const entryCriteria = (planItem.entryCriteria as ModdleElement[] | undefined) ?? []
    const exitCriteria = (planItem.exitCriteria as ModdleElement[] | undefined) ?? []

    entryCriteria.forEach((criterion) => {
      const sentryRef = criterion.sentryRef as ModdleElement | undefined
      if (sentryRef?.id && sentryNodeId.has(sentryRef.id)) {
        edges.push({
          id: `entry_${criterion.id ?? crypto.randomUUID()}`,
          source: sentryRef.id,
          target: targetId,
          type: 'smoothstep',
          label: 'entry',
          data: { criterionType: 'entry' },
        })
      }
    })

    exitCriteria.forEach((criterion) => {
      const sentryRef = criterion.sentryRef as ModdleElement | undefined
      if (sentryRef?.id && sentryNodeId.has(sentryRef.id)) {
        edges.push({
          id: `exit_${criterion.id ?? crypto.randomUUID()}`,
          source: sentryRef.id,
          target: targetId,
          type: 'smoothstep',
          label: 'exit',
          data: { criterionType: 'exit' },
        })
      }
    })
  })

  return {
    nodes,
    edges,
    caseId: (theCase.id as string) ?? 'Case_1',
    caseName: (theCase.name as string) ?? 'Untitled Case',
  }
}

export async function serializeToCmmnXml(
  nodes: Node<NodeData>[],
  edges: Edge[],
  caseId: string,
  caseName: string,
): Promise<string> {
  const definitionElements: ModdleElement[] = []
  const planItemElements: ModdleElement[] = []
  const sentryElements: ModdleElement[] = []
  const planItemById = new Map<string, ModdleElement>()
  const sentryById = new Map<string, ModdleElement>()

  const taskNodes = nodes.filter((n) => n.type !== 'cmmnSentry')
  const sentryNodes = nodes.filter((n) => n.type === 'cmmnSentry')

  for (const node of taskNodes) {
    let definition: ModdleElement
    const attrs: Record<string, unknown> = { id: `Def_${node.id}`, name: node.data.label }

    switch (node.type) {
      case 'cmmnHumanTask':
        if (node.data.isBlocking !== undefined) attrs.isBlocking = node.data.isBlocking
        definition = moddle.create('cmmn:HumanTask', attrs)
        break
      case 'cmmnMilestone':
        definition = moddle.create('cmmn:Milestone', attrs)
        break
      case 'cmmnStage':
        definition = moddle.create('cmmn:Stage', attrs)
        break
      default:
        definition = moddle.create('cmmn:Task', attrs)
    }
    definitionElements.push(definition)

    const planItem = moddle.create('cmmn:PlanItem', {
      id: node.id,
      name: node.data.label,
      definitionRef: definition,
    })
    planItemElements.push(planItem)
    planItemById.set(node.id, planItem)
  }

  for (const node of sentryNodes) {
    const conditionExpr = node.data.conditionExpression as string | undefined
    const sentry = moddle.create('cmmn:Sentry', {
      id: node.id,
      name: node.data.label,
      ...(conditionExpr
        ? {
            ifPart: moddle.create('cmmn:IfPart', {
              condition: moddle.create('cmmn:Expression', { body: conditionExpr }),
            }),
          }
        : {}),
    })
    sentryElements.push(sentry)
    sentryById.set(node.id, sentry)
  }

  // Wire onParts (edges INTO a sentry from a plan item)
  for (const edge of edges) {
    if (edge.data?.criterionType === 'onPart') {
      const sentry = sentryById.get(edge.target)
      const sourcePlanItem = planItemById.get(edge.source)
      if (sentry && sourcePlanItem) {
        const onPart = moddle.create('cmmn:PlanItemOnPart', {
          id: `OnPart_${edge.id}`,
          sourceRef: sourcePlanItem,
          standardEvent: (edge.data as { standardEvent?: string }).standardEvent || 'complete',
        })
        sentry.onParts = [...((sentry.onParts as ModdleElement[]) ?? []), onPart]
      }
    }
  }

  // Wire entry/exit criteria (edges FROM a sentry to a gated plan item)
  for (const edge of edges) {
    const criterionType = edge.data?.criterionType as string | undefined
    if (criterionType !== 'entry' && criterionType !== 'exit') continue

    const sentry = sentryById.get(edge.source)
    const targetPlanItem = planItemById.get(edge.target)
    if (!sentry || !targetPlanItem) continue

    if (criterionType === 'entry') {
      const criterion = moddle.create('cmmn:EntryCriterion', {
        id: `Entry_${edge.id}`,
        sentryRef: sentry,
      })
      targetPlanItem.entryCriteria = [
        ...((targetPlanItem.entryCriteria as ModdleElement[]) ?? []),
        criterion,
      ]
    } else {
      const criterion = moddle.create('cmmn:ExitCriterion', {
        id: `Exit_${edge.id}`,
        sentryRef: sentry,
      })
      targetPlanItem.exitCriteria = [
        ...((targetPlanItem.exitCriteria as ModdleElement[]) ?? []),
        criterion,
      ]
    }
  }

  const casePlanModel = moddle.create('cmmn:Stage', {
    id: `${caseId}_PlanModel`,
    name: caseName,
    planItemDefinitions: definitionElements,
    planItems: planItemElements,
    sentries: sentryElements,
  })

  const theCase = moddle.create('cmmn:Case', {
    id: caseId,
    name: caseName,
    casePlanModel,
  })

  const definitions = moddle.create('cmmn:Definitions', {
    id: `Definitions_${caseId}`,
    targetNamespace: 'http://waas.citi.com/cmmn',
    cases: [theCase],
  })

  return toXML(definitions)
}
