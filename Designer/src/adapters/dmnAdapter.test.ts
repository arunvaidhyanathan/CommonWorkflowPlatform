// Round-trip tests for the DMN adapter against the real sample files. The
// point: opening a model in the Designer and saving it must not change what
// the engine does. Run with `npm test` (Node's built-in runner).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseDmnXml, serializeDmnXml, type DmnModel } from './dmnAdapter.ts'

const sample = (name: string) => readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8')

async function roundTrip(xml: string): Promise<{ before: DmnModel; after: DmnModel; xml: string }> {
  const before = await parseDmnXml(xml)
  const out = await serializeDmnXml(before)
  return { before, after: await parseDmnXml(out), xml: out }
}

test('decision requirements survive a save (dependent decisions keep their inputs)', async () => {
  const { after } = await roundTrip(sample('kyc-risk-decisions.dmn'))
  const tier = after.decisions.find((d) => d.id === 'kycRiskTier')
  assert.deepEqual(tier?.requires, ['kycCountryRisk', 'kycProductRisk'])
  assert.deepEqual(after.decisions.find((d) => d.id === 'kycMonitoringFrequency')?.requires, ['kycRiskTier'])
})

test('PRIORITY output ranking survives a save (without it PRIORITY cannot pick a winner)', async () => {
  const { after } = await roundTrip(sample('kyc-risk-decisions.dmn'))
  const output = after.decisions.find((d) => d.id === 'kycMonitoringFrequency')?.decisionTable.outputs[0]
  assert.equal(output?.outputValues, '"MONTHLY","QUARTERLY","ANNUAL"')
})

test('decision services survive a save (CMMN decision tasks call them by key)', async () => {
  const { after, xml } = await roundTrip(sample('kyc-risk-decisions.dmn'))
  assert.deepEqual(after.decisionServices, [
    {
      id: 'kycAssessmentService',
      name: 'KYC Assessment Service',
      outputDecisions: ['kycRiskTier', 'kycDocumentRequirements', 'kycMonitoringFrequency'],
      encapsulatedDecisions: ['kycCountryRisk', 'kycProductRisk'],
    },
  ])
  // Flowable reads the namespace from the first element, so nothing may precede the root.
  assert.match(xml, /^<\?xml[^>]*\?>\s*<(dmn:)?definitions/)
})

test('the existing investigation sample keeps its requirements and ranking too', async () => {
  const { before, after } = await roundTrip(sample('investigation-decisions.dmn'))
  assert.deepEqual(
    after.decisions.map((d) => [d.id, d.requires, d.decisionTable.outputs.map((o) => o.outputValues ?? null)]),
    before.decisions.map((d) => [d.id, d.requires, d.decisionTable.outputs.map((o) => o.outputValues ?? null)]),
  )
  assert.ok(before.decisions.some((d) => d.requires.length > 0), 'sample has requirements to preserve')
})

test('rules, hit policies and aggregation are unchanged by a save', async () => {
  for (const file of ['kyc-risk-decisions.dmn', 'investigation-decisions.dmn']) {
    const { before, after } = await roundTrip(sample(file))
    const strip = (m: DmnModel) =>
      m.decisions.map((d) => ({
        id: d.id,
        hit: d.decisionTable.hitPolicy,
        agg: d.decisionTable.aggregation,
        rules: d.decisionTable.rules.map((r) => [r.inputEntries, r.outputEntries]),
      }))
    assert.deepEqual(strip(after), strip(before), file)
  }
})
