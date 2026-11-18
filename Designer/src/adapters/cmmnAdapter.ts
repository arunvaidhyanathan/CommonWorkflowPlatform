// CMMN Adapter (Designer.html Section 7.2): converts between CMMN 1.1 XML
// and React Flow graph state. The graph stays flat (no nested containers on
// the canvas), but nothing the engine depends on is lost on a save -- see
// cmmnAdapter.test.ts:
//   - the case plan model is a `cmmnCasePlan` node carrying case-level
//     settings (autoComplete, case roles); an exit edge into it is a
//     case-level exit criterion;
//   - plan items and sentries inside a stage carry `parentStage` (the stage
//     plan item's node id), so stages keep their contents;
//   - item controls (required, manual activation, repetition with Flowable's
//     counter variable), timer and user event listeners, decision / process /
//     case tasks and Flowable attributes (assignee, candidateGroups, formKey,
//     autoComplete) round-trip.
// Sentries are diamond nodes; onPart / entry / exit become typed edges.
import CmmnModdle, { type ModdleElement } from 'cmmn-moddle'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData } from '../store/useWorkbenchStore'

const moddle = new CmmnModdle()
const FLOWABLE_NS = 'http://flowable.org/cmmn'

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

export interface CaseRole {
  id: string
  name: string
}

/** CMMN-specific node data (stored in NodeData's open record). */
export interface CmmnNodeData {
  parentStage?: string
  definitionId?: string
  required?: boolean
  manualActivation?: boolean
  repetition?: boolean
  repetitionCounter?: string
  repetitionCondition?: string
  autoComplete?: boolean
  timerExpression?: string
  decisionKey?: string
  processKey?: string
  caseKey?: string
  roles?: CaseRole[]
}

const DEFINITION_TO_NODE: Record<string, string> = {
  'cmmn:HumanTask': 'cmmnHumanTask',
  'cmmn:Milestone': 'cmmnMilestone',
  'cmmn:Stage': 'cmmnStage',
  'cmmn:DecisionTask': 'cmmnDecisionTask',
  'cmmn:ProcessTask': 'cmmnProcessTask',
  'cmmn:CaseTask': 'cmmnCaseTask',
  'cmmn:TimerEventListener': 'cmmnTimerListener',
  'cmmn:UserEventListener': 'cmmnUserListener',
}

const attrOf = (el: ModdleElement | undefined, name: string) =>
  (el?.$attrs as Record<string, string> | undefined)?.[`flowable:${name}`]
const bodyOf = (expr: unknown) => ((expr as ModdleElement | undefined)?.body as string | undefined)?.trim() || undefined
const isTrue = (value: unknown) => value === true || value === 'true'

export async function parseCmmnXml(xmlString: string): Promise<CmmnParseResult> {
  const { rootElement } = await fromXML(xmlString)
  const theCase = ((rootElement.cases as ModdleElement[] | undefined) ?? [])[0]
  if (!theCase) {
    throw new Error('CMMN-E101: No <case> element found in the document.')
  }
  const plan = theCase.casePlanModel as ModdleElement | undefined
  if (!plan) {
    throw new Error('CMMN-E102: Case has no casePlanModel (case plan stage).')
  }

  const nodes: Node<NodeData>[] = []
  const edges: Edge[] = []
  const planItems: ModdleElement[] = []
  const planId = (plan.id as string) ?? `${theCase.id}_PlanModel`
  const roles = (((theCase.caseRoles as ModdleElement | undefined)?.role as ModdleElement[] | undefined) ?? []).map(
    (r) => ({ id: r.id as string, name: (r.name as string) ?? (r.id as string) }),
  )

  nodes.push({
    id: planId,
    type: 'cmmnCasePlan',
    position: { x: 100, y: 40 },
    data: {
      label: (plan.name as string) || (theCase.name as string) || 'Case Plan',
      autoComplete: isTrue(attrOf(plan, 'autoComplete')) || isTrue(plan.autoComplete) || undefined,
      roles: roles.length ? roles : undefined,
    },
  })

  let xCursor = 100
  const walk = (stage: ModdleElement, parentStage: string | undefined, depth: number) => {
    for (const planItem of (stage.planItems as ModdleElement[] | undefined) ?? []) {
      planItems.push(planItem)
      const def = planItem.definitionRef as ModdleElement | undefined
      const control = planItem.itemControl as ModdleElement | undefined
      const repetition = control?.repetitionRule as ModdleElement | undefined
      const candidateGroups = attrOf(def, 'candidateGroups')
      const data: NodeData & CmmnNodeData = {
        label: (planItem.name as string) || (def?.name as string) || (planItem.id as string),
        parentStage,
        definitionId: def?.id as string | undefined,
        isBlocking: def?.isBlocking as boolean | undefined,
        performerRef: (def?.performerRef as ModdleElement | undefined)?.id,
        assignee: attrOf(def, 'assignee'),
        candidateGroups: candidateGroups ? candidateGroups.split(',').map((g) => g.trim()).filter(Boolean) : undefined,
        formKey: attrOf(def, 'formKey'),
        required: control?.requiredRule ? true : undefined,
        manualActivation: control?.manualActivationRule ? true : undefined,
        repetition: repetition ? true : undefined,
        repetitionCounter: attrOf(repetition, 'counterVariable'),
        repetitionCondition: bodyOf(repetition?.condition),
        autoComplete:
          def?.$type === 'cmmn:Stage' && (isTrue(attrOf(def, 'autoComplete')) || isTrue(def.autoComplete)) ? true : undefined,
        timerExpression: bodyOf(def?.timerExpression),
        decisionKey: bodyOf(def?.decisionRefExpression) ?? (def?.decisionRef as string | undefined),
        processKey: bodyOf(def?.processRefExpression) ?? (def?.processRef as string | undefined),
        caseKey: bodyOf(def?.caseRefExpression) ?? (def?.caseRef as string | undefined),
      }
      nodes.push({
        id: planItem.id as string,
        type: DEFINITION_TO_NODE[def?.$type as string] ?? 'cmmnTask',
        position: { x: xCursor, y: 200 + depth * 160 },
        data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as NodeData,
      })
      xCursor += 220
      if (def?.$type === 'cmmn:Stage') walk(def, planItem.id as string, depth + 1)
    }

    for (const sentry of (stage.sentries as ModdleElement[] | undefined) ?? []) {
      const id = sentry.id as string
      const condition = bodyOf((sentry.ifPart as ModdleElement | undefined)?.condition)
      nodes.push({
        id,
        type: 'cmmnSentry',
        position: { x: xCursor, y: 330 + depth * 160 },
        data: {
          label: (sentry.name as string) || 'Sentry',
          ...(condition ? { conditionExpression: condition } : {}),
          ...(parentStage ? { parentStage } : {}),
        },
      })
      xCursor += 180
      for (const onPart of (sentry.onParts as ModdleElement[] | undefined) ?? []) {
        const source = (onPart.sourceRef as ModdleElement | undefined)?.id as string | undefined
        if (!source) continue
        edges.push({
          id: `onpart_${onPart.id ?? crypto.randomUUID()}`,
          source,
          target: id,
          type: 'smoothstep',
          label: (onPart.standardEvent as string) || '',
          data: { criterionType: 'onPart', standardEvent: onPart.standardEvent },
        })
      }
    }
  }
  walk(plan, undefined, 0)

  const criterionEdge = (criterion: ModdleElement, target: string, kind: 'entry' | 'exit'): Edge | null => {
    const sentryId = (criterion.sentryRef as ModdleElement | undefined)?.id as string | undefined
    return sentryId
      ? {
          id: `${kind}_${criterion.id ?? crypto.randomUUID()}`,
          source: sentryId,
          target,
          type: 'smoothstep',
          label: kind,
          data: { criterionType: kind },
        }
      : null
  }
  for (const planItem of planItems) {
    for (const c of (planItem.entryCriteria as ModdleElement[] | undefined) ?? []) {
      const e = criterionEdge(c, planItem.id as string, 'entry')
      if (e) edges.push(e)
    }
    for (const c of (planItem.exitCriteria as ModdleElement[] | undefined) ?? []) {
      const e = criterionEdge(c, planItem.id as string, 'exit')
      if (e) edges.push(e)
    }
  }
  for (const c of (plan.exitCriteria as ModdleElement[] | undefined) ?? []) {
    const e = criterionEdge(c, planId, 'exit')
    if (e) edges.push(e)
  }

  return {
    nodes,
    edges,
    caseId: (theCase.id as string) ?? 'Case_1',
    caseName: (theCase.name as string) ?? 'Untitled Case',
  }
}

// moddle.create ignores an `$attrs` property; foreign (flowable:) attributes
// must be written onto the created element's $attrs.
function withAttrs(element: ModdleElement, attrs: Record<string, string> | undefined): ModdleElement {
  if (attrs) Object.assign(element.$attrs as Record<string, string>, attrs)
  return element
}

function expression(body: string) {
  return moddle.create('cmmn:Expression', { body })
}

function flowableAttrs(values: Record<string, string | undefined>): Record<string, string> | undefined {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined && v !== '')
  return entries.length ? Object.fromEntries(entries.map(([k, v]) => [`flowable:${k}`, v as string])) : undefined
}

function createDefinition(node: Node<NodeData>, roleById: Map<string, ModdleElement>): ModdleElement {
  const d = node.data as NodeData & CmmnNodeData
  const attrs: Record<string, unknown> = { id: d.definitionId || `Def_${node.id}`, name: d.label }
  switch (node.type) {
    case 'cmmnHumanTask': {
      if (d.isBlocking !== undefined) attrs.isBlocking = d.isBlocking
      const role = d.performerRef ? roleById.get(d.performerRef as string) : undefined
      if (role) attrs.performerRef = role
      return withAttrs(
        moddle.create('cmmn:HumanTask', attrs),
        flowableAttrs({
          assignee: d.assignee,
          candidateGroups: d.candidateGroups?.length ? d.candidateGroups.join(',') : undefined,
          formKey: d.formKey,
        }),
      )
    }
    case 'cmmnMilestone':
      return moddle.create('cmmn:Milestone', attrs)
    case 'cmmnStage':
      return withAttrs(
        moddle.create('cmmn:Stage', attrs),
        flowableAttrs({ autoComplete: d.autoComplete ? 'true' : undefined }),
      )
    case 'cmmnDecisionTask':
      if (d.decisionKey) attrs.decisionRefExpression = expression(d.decisionKey)
      return moddle.create('cmmn:DecisionTask', attrs)
    case 'cmmnProcessTask':
      if (d.processKey) attrs.processRefExpression = expression(d.processKey)
      return moddle.create('cmmn:ProcessTask', attrs)
    case 'cmmnCaseTask':
      if (d.caseKey) attrs.caseRefExpression = expression(d.caseKey)
      return moddle.create('cmmn:CaseTask', attrs)
    case 'cmmnTimerListener':
      if (d.timerExpression) attrs.timerExpression = expression(d.timerExpression)
      return moddle.create('cmmn:TimerEventListener', attrs)
    case 'cmmnUserListener':
      return moddle.create('cmmn:UserEventListener', attrs)
    default:
      if (d.isBlocking !== undefined) attrs.isBlocking = d.isBlocking
      return moddle.create('cmmn:Task', attrs)
  }
}

function createItemControl(node: Node<NodeData>): ModdleElement | undefined {
  const d = node.data as NodeData & CmmnNodeData
  if (!d.required && !d.manualActivation && !d.repetition) return undefined
  return moddle.create('cmmn:PlanItemControl', {
    id: `IC_${node.id}`,
    ...(d.repetition
      ? {
          repetitionRule: withAttrs(
            moddle.create('cmmn:RepetitionRule', {
              id: `Rep_${node.id}`,
              ...(d.repetitionCondition ? { condition: expression(d.repetitionCondition) } : {}),
            }),
            flowableAttrs({ counterVariable: d.repetitionCounter }),
          ),
        }
      : {}),
    ...(d.required ? { requiredRule: moddle.create('cmmn:RequiredRule', { id: `Req_${node.id}` }) } : {}),
    ...(d.manualActivation
      ? { manualActivationRule: moddle.create('cmmn:ManualActivationRule', { id: `Man_${node.id}` }) }
      : {}),
  })
}

export async function serializeToCmmnXml(
  nodes: Node<NodeData>[],
  edges: Edge[],
  caseId: string,
  caseName: string,
): Promise<string> {
  const planNode = nodes.find((n) => n.type === 'cmmnCasePlan')
  const planData = (planNode?.data ?? {}) as NodeData & CmmnNodeData
  const roles = (planData.roles ?? []).map((r) => moddle.create('cmmn:Role', { id: r.id, name: r.name }))
  const roleById = new Map(roles.map((r) => [r.id as string, r]))

  const plan = withAttrs(
    moddle.create('cmmn:Stage', {
      id: planNode?.id ?? `${caseId}_PlanModel`,
      name: planData.label || caseName,
      planItemDefinitions: [],
      planItems: [],
      sentries: [],
    }),
    flowableAttrs({ autoComplete: planData.autoComplete ? 'true' : undefined }),
  )

  const planItemById = new Map<string, ModdleElement>()
  const sentryById = new Map<string, ModdleElement>()
  const stageDefById = new Map<string, ModdleElement>() // stage plan item node id -> its cmmn:Stage definition
  const placed: { node: Node<NodeData>; element: ModdleElement; definition?: ModdleElement }[] = []

  for (const node of nodes) {
    if (node.type === 'cmmnCasePlan') continue
    if (node.type === 'cmmnSentry') {
      const condition = node.data.conditionExpression as string | undefined
      const sentry = moddle.create('cmmn:Sentry', {
        id: node.id,
        ...(node.data.label && node.data.label !== 'Sentry' ? { name: node.data.label } : {}),
        onParts: [],
        ...(condition
          ? { ifPart: moddle.create('cmmn:IfPart', { id: `If_${node.id}`, condition: expression(condition) }) }
          : {}),
      })
      sentryById.set(node.id, sentry)
      placed.push({ node, element: sentry })
      continue
    }
    const definition = createDefinition(node, roleById)
    const control = createItemControl(node)
    const planItem = moddle.create('cmmn:PlanItem', {
      id: node.id,
      name: node.data.label,
      definitionRef: definition,
      ...(control ? { itemControl: control } : {}),
    })
    planItemById.set(node.id, planItem)
    if (node.type === 'cmmnStage') {
      definition.planItemDefinitions = []
      definition.planItems = []
      definition.sentries = []
      stageDefById.set(node.id, definition)
    }
    placed.push({ node, element: planItem, definition })
  }

  // Place every element in its stage (or the case plan when the stage is missing).
  const containerOf = (node: Node<NodeData>) =>
    stageDefById.get((node.data as CmmnNodeData).parentStage ?? '') ?? plan
  for (const { node, element, definition } of placed) {
    const container = containerOf(node)
    if (node.type === 'cmmnSentry') {
      ;(container.sentries as ModdleElement[]).push(element)
    } else {
      ;(container.planItems as ModdleElement[]).push(element)
      ;(container.planItemDefinitions as ModdleElement[]).push(definition as ModdleElement)
    }
  }

  for (const edge of edges) {
    const criterionType = edge.data?.criterionType as string | undefined
    if (criterionType === 'onPart') {
      const sentry = sentryById.get(edge.target)
      const source = planItemById.get(edge.source)
      if (sentry && source) {
        ;(sentry.onParts as ModdleElement[]).push(
          moddle.create('cmmn:PlanItemOnPart', {
            id: `OnPart_${edge.id}`,
            sourceRef: source,
            standardEvent: (edge.data as { standardEvent?: string }).standardEvent || 'complete',
          }),
        )
      }
      continue
    }
    if (criterionType !== 'entry' && criterionType !== 'exit') continue
    const sentry = sentryById.get(edge.source)
    if (!sentry) continue
    if (criterionType === 'exit' && planNode && edge.target === planNode.id) {
      plan.exitCriteria = [
        ...((plan.exitCriteria as ModdleElement[]) ?? []),
        moddle.create('cmmn:ExitCriterion', { id: `Exit_${edge.id}`, sentryRef: sentry }),
      ]
      continue
    }
    const target = planItemById.get(edge.target)
    if (!target) continue
    const key = criterionType === 'entry' ? 'entryCriteria' : 'exitCriteria'
    const type = criterionType === 'entry' ? 'cmmn:EntryCriterion' : 'cmmn:ExitCriterion'
    const prefix = criterionType === 'entry' ? 'Entry' : 'Exit'
    target[key] = [
      ...((target[key] as ModdleElement[]) ?? []),
      moddle.create(type, { id: `${prefix}_${edge.id}`, sentryRef: sentry }),
    ]
  }

  const theCase = moddle.create('cmmn:Case', {
    id: caseId,
    name: caseName,
    casePlanModel: plan,
    ...(roles.length ? { caseRoles: moddle.create('cmmn:CaseRoles', { id: `${caseId}_Roles`, role: roles }) } : {}),
  })

  const definitions = withAttrs(
    moddle.create('cmmn:Definitions', {
      id: `Definitions_${caseId}`,
      targetNamespace: 'http://waas.citi.com/cmmn',
      cases: [theCase],
    }),
    { 'xmlns:flowable': FLOWABLE_NS },
  )

  return toXML(definitions)
}
