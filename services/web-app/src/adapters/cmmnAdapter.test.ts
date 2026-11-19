// Round-trip tests for the CMMN adapter against the real sample files: open
// in the Designer, save, and the case must still mean the same thing to the
// engine. The comparison is computed straight from cmmn-moddle (not from the
// adapter's own graph model), so the adapter can't grade its own homework.
// Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import CmmnModdle, { type ModdleElement } from 'cmmn-moddle'
import { parseCmmnXml, serializeToCmmnXml } from './cmmnAdapter.ts'

const sample = (name: string) => readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8')
const moddle = new CmmnModdle()

function fromXML(xml: string): Promise<ModdleElement> {
  return new Promise((resolve, reject) =>
    moddle.fromXML(xml, (err: unknown, root: ModdleElement) => (err ? reject(err) : resolve(root))),
  )
}

type Els = ModdleElement[] | undefined
const attr = (el: ModdleElement | undefined, name: string) =>
  ((el?.$attrs as Record<string, string> | undefined)?.[name] ?? undefined) as string | undefined
const body = (expr: unknown) => ((expr as ModdleElement | undefined)?.body as string | undefined)?.trim()

/** Engine-relevant meaning of a case, keyed by plan item id, independent of layout and generated ids. */
async function meaning(xml: string) {
  const root = await fromXML(xml)
  const theCase = (root.cases as ModdleElement[])[0]
  const plan = theCase.casePlanModel as ModdleElement
  const items: Record<string, unknown> = {}
  const sentry = (s: ModdleElement) => ({
    on: ((s.onParts as Els) ?? []).map((o) => `${(o.sourceRef as ModdleElement)?.id}:${o.standardEvent}`).sort(),
    if: body((s.ifPart as ModdleElement | undefined)?.condition),
  })
  const walk = (stage: ModdleElement, path: string) => {
    for (const pi of (stage.planItems as Els) ?? []) {
      const def = pi.definitionRef as ModdleElement
      const ctl = pi.itemControl as ModdleElement | undefined
      const rep = ctl?.repetitionRule as ModdleElement | undefined
      items[pi.id as string] = {
        in: path,
        name: pi.name,
        type: def.$type,
        required: Boolean(ctl?.requiredRule),
        manual: Boolean(ctl?.manualActivationRule),
        repetition: rep ? { counter: attr(rep, 'flowable:counterVariable'), if: body(rep.condition) } : null,
        entry: ((pi.entryCriteria as Els) ?? []).map((c) => sentry(c.sentryRef as ModdleElement)),
        exit: ((pi.exitCriteria as Els) ?? []).map((c) => sentry(c.sentryRef as ModdleElement)),
        candidateGroups: attr(def, 'flowable:candidateGroups'),
        assignee: attr(def, 'flowable:assignee'),
        formKey: attr(def, 'flowable:formKey'),
        performer: (def.performerRef as ModdleElement | undefined)?.name,
        blocking: def.isBlocking,
        timer: body(def.timerExpression),
        decision: body(def.decisionRefExpression) ?? def.decisionRef,
        process: body(def.processRefExpression) ?? def.processRef,
        case: body(def.caseRefExpression) ?? def.caseRef,
        autoComplete: def.$type === 'cmmn:Stage' ? attr(def, 'flowable:autoComplete') === 'true' || def.autoComplete === true : undefined,
      }
      if (def.$type === 'cmmn:Stage') walk(def, `${path}/${pi.id}`)
    }
  }
  walk(plan, '')
  return {
    caseId: theCase.id,
    autoComplete: attr(plan, 'flowable:autoComplete') === 'true' || plan.autoComplete === true,
    exit: ((plan.exitCriteria as Els) ?? []).map((c) => sentry(c.sentryRef as ModdleElement)),
    roles: (((theCase.caseRoles as ModdleElement | undefined)?.role as Els) ?? []).map((r) => r.name).sort(),
    items,
  }
}

async function resave(xml: string) {
  const parsed = await parseCmmnXml(xml)
  return serializeToCmmnXml(parsed.nodes, parsed.edges, parsed.caseId, parsed.caseName)
}

for (const file of ['kyc-onboarding-case.cmmn', 'investigation-case.cmmn']) {
  test(`${file}: saving in the Designer keeps the case's meaning`, async () => {
    const original = sample(file)
    assert.deepEqual(await meaning(await resave(original)), await meaning(original))
  })
}

test('KYC meaning includes the features under test (so the round trip is not vacuous)', async () => {
  const m = await meaning(sample('kyc-onboarding-case.cmmn'))
  const items = m.items as Record<string, Record<string, unknown>>
  assert.equal(m.autoComplete, true)
  assert.equal(m.exit.length, 1)
  assert.equal(items.PI_CollectDocs.in, '/PI_DocCollection')
  assert.equal(items.PI_CollectDocs.required, true)
  assert.deepEqual(items.PI_RequestDoc.repetition, { counter: 'additionalDocRequests', if: undefined })
  assert.equal(items.PI_RequestDoc.manual, true)
  assert.equal(items.PI_AssessRisk.decision, 'kycAssessmentService')
  assert.equal(items.PI_SlaTimer.timer, 'P5D')
  assert.equal(items.PI_Withdraw.type, 'cmmn:UserEventListener')
  assert.equal(items.PI_SourceOfWealth.candidateGroups, 'eddTeam')
})

test('saved XML declares the Flowable namespace and starts with the root element', async () => {
  const xml = await resave(sample('kyc-onboarding-case.cmmn'))
  assert.match(xml, /xmlns:flowable="http:\/\/flowable\.org\/cmmn"/)
  assert.match(xml, /^<\?xml[^>]*\?>\s*<(cmmn:)?definitions/)
})

test('a graph from the old flat adapter (no case plan node) still saves', async () => {
  const xml = await serializeToCmmnXml(
    [
      { id: 'PI_A', type: 'cmmnHumanTask', position: { x: 0, y: 0 }, data: { label: 'Do A' } },
      { id: 'S_1', type: 'cmmnSentry', position: { x: 0, y: 0 }, data: { label: 'Sentry' } },
      { id: 'PI_B', type: 'cmmnTask', position: { x: 0, y: 0 }, data: { label: 'Do B' } },
    ],
    [
      { id: 'e1', source: 'PI_A', target: 'S_1', data: { criterionType: 'onPart', standardEvent: 'complete' } },
      { id: 'e2', source: 'S_1', target: 'PI_B', data: { criterionType: 'entry' } },
    ],
    'oldCase',
    'Old Case',
  )
  const m = await meaning(xml)
  assert.deepEqual(Object.keys(m.items).sort(), ['PI_A', 'PI_B'])
  assert.deepEqual((m.items.PI_B as { entry: unknown }).entry, [{ on: ['PI_A:complete'], if: undefined }])
})
