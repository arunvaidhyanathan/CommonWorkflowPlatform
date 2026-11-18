// Round-trip tests for the BPMN adapter against the real sample files: open
// in the Designer, save, and the process must still mean the same thing to
// the engine. The comparison is computed straight from bpmn-moddle (with the
// Flowable descriptor), not from the adapter's graph model. Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle'
import flowable from './flowable-moddle-descriptor.json' with { type: 'json' }
import { parseBpmnXml, serializeToBpmnXml } from './bpmnAdapter.ts'

const sample = (name: string) => readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8')
const moddle = new BpmnModdle({ flowable })

type Els = ModdleElement[] | undefined
const body = (e: unknown) => ((e as ModdleElement | undefined)?.body as string | undefined)?.trim()

function eventDefinition(d: ModdleElement) {
  const ref = (d.signalRef ?? d.messageRef ?? d.errorRef ?? d.escalationRef) as ModdleElement | undefined
  return {
    type: d.$type,
    ref: ref ? { name: ref.name, code: ref.errorCode ?? ref.escalationCode, scope: ref.scope } : undefined,
    timer: body(d.timeDuration) ?? body(d.timeDate) ?? body(d.timeCycle),
    condition: body(d.condition),
  }
}

function extensions(el: ModdleElement | undefined) {
  return (((el?.extensionElements as ModdleElement | undefined)?.values as Els) ?? []).map((v) => ({
    type: v.$type,
    name: v.name,
    value: (v.expression ?? v.string ?? v.stringValue) as string | undefined,
    source: v.source,
    target: v.target,
    variables: ((v.variable as Els) ?? []).map((x) => `${x.source}->${x.target}`),
    variableName: v.variableName,
    changeType: v.variableChangeType,
  }))
}

/** Engine-relevant meaning of the first process, keyed by element id. */
async function meaning(xml: string) {
  const { rootElement } = await moddle.fromXML(xml)
  const process = (rootElement.rootElements as ModdleElement[]).find((r) => r.$type === 'bpmn:Process') as ModdleElement
  const elements: Record<string, unknown> = {}
  const flows: string[] = []
  const walk = (container: ModdleElement, parent: string) => {
    for (const el of (container.flowElements as Els) ?? []) {
      if (el.$type === 'bpmn:SequenceFlow') {
        flows.push(`${(el.sourceRef as ModdleElement).id}->${(el.targetRef as ModdleElement).id}${body(el.conditionExpression) ? ` [${body(el.conditionExpression)}]` : ''}`)
        continue
      }
      const loop = el.loopCharacteristics as ModdleElement | undefined
      elements[el.id as string] = {
        parent,
        type: el.$type,
        name: el.name,
        assignee: el.assignee,
        candidateGroups: el.candidateGroups,
        formKey: el.formKey,
        serviceType: el.type,
        caseDefinitionKey: el.caseDefinitionKey,
        calledElement: el.calledElement,
        decisionRef: el.decisionRef,
        script: el.$type === 'bpmn:ScriptTask' ? { format: el.scriptFormat, body: (el.script as string)?.trim() } : undefined,
        isForCompensation: el.isForCompensation || undefined,
        triggeredByEvent: el.triggeredByEvent || undefined,
        ordering: el.ordering,
        completionCondition: body(el.completionCondition),
        attachedTo: (el.attachedToRef as ModdleElement | undefined)?.id,
        cancelActivity: el.$type === 'bpmn:BoundaryEvent' ? el.cancelActivity !== false : undefined,
        interrupting: el.$type === 'bpmn:StartEvent' && el.isInterrupting === false ? false : undefined,
        defaultFlow: (el.default as ModdleElement | undefined)?.id,
        events: ((el.eventDefinitions as Els) ?? []).map(eventDefinition),
        loop: loop
          ? {
              sequential: Boolean(loop.isSequential),
              collection: loop.collection,
              elementVariable: loop.elementVariable,
              completion: body(loop.completionCondition),
              extensions: extensions(loop),
            }
          : undefined,
        extensions: extensions(el),
      }
      if ((el.flowElements as Els)?.length) walk(el, el.id as string)
    }
    for (const a of (container.artifacts as Els) ?? []) {
      if (a.$type === 'bpmn:Association') flows.push(`assoc ${(a.sourceRef as ModdleElement).id}->${(a.targetRef as ModdleElement).id}`)
    }
  }
  walk(process, '')
  return { id: process.id, elements, flows: flows.sort() }
}

async function resave(xml: string) {
  const parsed = await parseBpmnXml(xml)
  return serializeToBpmnXml(parsed.nodes, parsed.edges, parsed.processId, parsed.processName)
}

for (const file of ['expense-claim-process.bpmn', 'customer-onboarding-process.bpmn']) {
  test(`${file}: saving in the Designer keeps the process's meaning`, async () => {
    const original = sample(file)
    assert.deepEqual(await meaning(await resave(original)), await meaning(original))
  })
}

test('the meaning covers the features under test (so the round trip is not vacuous)', async () => {
  const m = (await meaning(sample('expense-claim-process.bpmn'))).elements as Record<string, Record<string, any>>
  assert.equal(m.peerReview.parent, 'approval')
  assert.equal(m.peerReview.loop.collection, '${reviewers}')
  assert.deepEqual(m.peerReview.loop.extensions[0].variables, ['vote->vote', 'reviewer->reviewer'])
  assert.equal(m.notify.serviceType, 'mail')
  assert.equal(m.notify.extensions.length, 3)
  assert.equal(m.directorEscalation.cancelActivity, false)
  assert.equal(m.directorEscalation.events[0].ref.code, 'directorApproval')
  assert.equal(m.release.isForCompensation, true)
  assert.equal(m.withdrawal.triggeredByEvent, true)
  assert.equal(m.withdrawn.events[0].ref.name, 'claimWithdrawn')
  assert.equal(m.undoReservation.events[0].type, 'bpmn:CompensateEventDefinition')
  const o = (await meaning(sample('customer-onboarding-process.bpmn'))).elements as Record<string, Record<string, any>>
  assert.equal(o.runKyc.caseDefinitionKey, 'kycOnboardingCase')
  assert.equal(o.accountSetup.type, 'bpmn:AdHocSubProcess')
  assert.equal(o.awaitWelcomeCall.extensions[0].variableName, 'welcomeCallDone')
})

test('saved XML starts with the root element and declares the Flowable namespace', async () => {
  const xml = await resave(sample('expense-claim-process.bpmn'))
  assert.match(xml, /^<\?xml[^>]*\?>\s*<(bpmn:)?definitions/)
  assert.match(xml, /xmlns:flowable="http:\/\/flowable\.org\/bpmn"/)
})

test('every diagram edge has the two waypoints the BPMN DI schema requires (Flowable rejects the file otherwise)', async () => {
  const xml = await resave(sample('expense-claim-process.bpmn'))
  const edges = xml.match(/<bpmndi:BPMNEdge[\s\S]*?<\/bpmndi:BPMNEdge>|<bpmndi:BPMNEdge[^>]*\/>/g) ?? []
  assert.ok(edges.length > 10)
  for (const edge of edges) assert.equal((edge.match(/<di:waypoint/g) ?? []).length, 2, edge)
})

test('a graph from the old flat adapter still saves', async () => {
  const xml = await serializeToBpmnXml(
    [
      { id: 'start', type: 'startEvent', position: { x: 0, y: 0 }, data: { label: 'Start' } },
      { id: 'review', type: 'userTask', position: { x: 100, y: 0 }, data: { label: 'Review', candidateGroups: ['designer'] } },
      { id: 'end', type: 'endEvent', position: { x: 200, y: 0 }, data: { label: 'End' } },
    ],
    [
      { id: 'f1', source: 'start', target: 'review' },
      { id: 'f2', source: 'review', target: 'end' },
    ],
    'oldProcess',
    'Old Process',
  )
  const m = await meaning(xml)
  assert.deepEqual(m.flows, ['review->end', 'start->review'])
  assert.equal((m.elements.review as { candidateGroups: string }).candidateGroups, 'designer')
})
