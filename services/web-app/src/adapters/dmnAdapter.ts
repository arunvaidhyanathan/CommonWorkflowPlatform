// DMN Adapter (Designer.html Section 7.3): converts between DMN 1.3 XML and
// an internal decision-table model edited by the TanStack grid. Besides the
// tables it keeps what the engine depends on: decision requirements (which
// decisions feed which), output value ranking (PRIORITY / OUTPUT ORDER need
// it) and decision services (the key a CMMN decision task calls). Saving a
// model must not change how it evaluates -- see dmnAdapter.test.ts.
import { DmnModdle, type ModdleElement } from 'dmn-moddle'

const moddle = new DmnModdle()

export type HitPolicy = 'UNIQUE' | 'FIRST' | 'PRIORITY' | 'ANY' | 'COLLECT' | 'RULE ORDER' | 'OUTPUT ORDER'
export type Aggregation = 'SUM' | 'COUNT' | 'MIN' | 'MAX'

export interface DmnInputClause {
  id: string
  label: string
  expression: string
  typeRef: string
}

export interface DmnOutputClause {
  id: string
  name: string
  typeRef: string
  // Ranked allowed values, e.g. '"HIGH","MEDIUM","LOW"'. Required for PRIORITY / OUTPUT ORDER.
  outputValues?: string
}

export interface DmnRule {
  id: string
  inputEntries: string[]
  outputEntries: string[]
}

export interface DmnDecisionTable {
  id: string
  hitPolicy: HitPolicy
  aggregation?: Aggregation
  inputs: DmnInputClause[]
  outputs: DmnOutputClause[]
  rules: DmnRule[]
}

export interface DmnDecision {
  id: string
  name: string
  decisionTable: DmnDecisionTable
  // Ids of decisions whose outputs this decision reads (informationRequirement).
  requires?: string[]
}

// One entry point over several decisions: outputs are returned to the
// caller, encapsulated decisions are evaluated internally.
export interface DmnDecisionService {
  id: string
  name: string
  outputDecisions: string[]
  encapsulatedDecisions: string[]
}

export interface DmnModel {
  definitionsId: string
  definitionsName: string
  namespace: string
  decisions: DmnDecision[]
  decisionServices?: DmnDecisionService[]
}

/** '#kycRiskTier' -> 'kycRiskTier' */
function refId(ref: ModdleElement | undefined): string | null {
  const href = ref?.href as string | undefined
  return href ? href.replace(/^#/, '') : null
}

function refs(list: unknown): string[] {
  return ((list as ModdleElement[] | undefined) ?? []).map(refId).filter((id): id is string => id !== null)
}

function href(id: string): ModdleElement {
  return moddle.create('dmn:DMNElementReference', { href: `#${id}` })
}

let counter = 0
function nextId(prefix: string) {
  counter += 1
  return `${prefix}_${Date.now()}_${counter}`
}

export async function parseDmnXml(xmlString: string): Promise<DmnModel> {
  const { rootElement } = await moddle.fromXML(xmlString)

  const drgElements = (rootElement.drgElement as ModdleElement[] | undefined) ?? []
  const decisionElements = drgElements.filter((el) => el.$type === 'dmn:Decision')

  if (decisionElements.length === 0) {
    throw new Error(
      'DMN-E101: No <decision> elements found. The file does not contain any decision tables to edit.',
    )
  }

  const decisions: DmnDecision[] = decisionElements.map((decisionEl) => {
    const decisionLogic = decisionEl.decisionLogic as ModdleElement | undefined

    if (!decisionLogic || decisionLogic.$type !== 'dmn:DecisionTable') {
      // Literal-expression-only decisions (no table) aren't editable by the
      // grid yet; surface an empty table so the decision is still visible
      // and won't crash the import.
      return {
        id: (decisionEl.id as string) ?? nextId('decision'),
        name: (decisionEl.name as string) ?? 'Untitled Decision',
        requires: requiredDecisions(decisionEl),
        decisionTable: {
          id: nextId('table'),
          hitPolicy: 'UNIQUE',
          inputs: [],
          outputs: [],
          rules: [],
        },
      }
    }

    const inputs = ((decisionLogic.input as ModdleElement[] | undefined) ?? []).map((clause) => {
      const inputExpression = clause.inputExpression as ModdleElement | undefined
      return {
        id: (clause.id as string) ?? nextId('input'),
        label: (clause.label as string) ?? (inputExpression?.text as string) ?? '',
        expression: (inputExpression?.text as string) ?? '',
        typeRef: (inputExpression?.typeRef as string) ?? 'string',
      }
    })

    const outputs = ((decisionLogic.output as ModdleElement[] | undefined) ?? []).map((clause) => {
      const outputValues = (clause.outputValues as ModdleElement | undefined)?.text as string | undefined
      return {
        id: (clause.id as string) ?? nextId('output'),
        name: (clause.name as string) ?? 'result',
        typeRef: (clause.typeRef as string) ?? 'string',
        ...(outputValues ? { outputValues } : {}),
      }
    })

    const rules = ((decisionLogic.rule as ModdleElement[] | undefined) ?? []).map((rule) => ({
      id: (rule.id as string) ?? nextId('rule'),
      inputEntries: ((rule.inputEntry as ModdleElement[] | undefined) ?? []).map(
        (entry) => (entry.text as string) ?? '',
      ),
      outputEntries: ((rule.outputEntry as ModdleElement[] | undefined) ?? []).map(
        (entry) => (entry.text as string) ?? '',
      ),
    }))

    return {
      id: (decisionEl.id as string) ?? nextId('decision'),
      name: (decisionEl.name as string) ?? 'Untitled Decision',
      requires: requiredDecisions(decisionEl),
      decisionTable: {
        id: (decisionLogic.id as string) ?? nextId('table'),
        hitPolicy: ((decisionLogic.hitPolicy as HitPolicy) || 'UNIQUE') as HitPolicy,
        aggregation: decisionLogic.aggregation as Aggregation | undefined,
        inputs,
        outputs,
        rules,
      },
    }
  })

  const decisionServices = drgElements
    .filter((el) => el.$type === 'dmn:DecisionService')
    .map((el) => ({
      id: el.id as string,
      name: (el.name as string) ?? (el.id as string),
      outputDecisions: refs(el.outputDecision),
      encapsulatedDecisions: refs(el.encapsulatedDecision),
    }))

  return {
    definitionsId: (rootElement.id as string) ?? nextId('definitions'),
    definitionsName: (rootElement.name as string) ?? 'DMN Definitions',
    namespace: (rootElement.namespace as string) ?? 'http://waas.citi.com/dmn',
    decisions,
    decisionServices,
  }
}

function requiredDecisions(decisionEl: ModdleElement): string[] {
  return ((decisionEl.informationRequirement as ModdleElement[] | undefined) ?? [])
    .map((ir) => refId(ir.requiredDecision as ModdleElement | undefined))
    .filter((id): id is string => id !== null)
}

export async function serializeDmnXml(model: DmnModel): Promise<string> {
  const drgElements = model.decisions.map((decision) => {
    const inputs = decision.decisionTable.inputs.map((input) =>
      moddle.create('dmn:InputClause', {
        id: input.id,
        label: input.label,
        inputExpression: moddle.create('dmn:LiteralExpression', {
          id: nextId('LE'),
          typeRef: input.typeRef,
          text: input.expression,
        }),
      }),
    )

    const outputs = decision.decisionTable.outputs.map((output) =>
      moddle.create('dmn:OutputClause', {
        id: output.id,
        name: output.name,
        typeRef: output.typeRef,
        ...(output.outputValues?.trim()
          ? { outputValues: moddle.create('dmn:UnaryTests', { id: nextId('OV'), text: output.outputValues.trim() }) }
          : {}),
      }),
    )

    const rules = decision.decisionTable.rules.map((rule) =>
      moddle.create('dmn:DecisionRule', {
        id: rule.id,
        inputEntry: rule.inputEntries.map((text) =>
          moddle.create('dmn:UnaryTests', { id: nextId('IE'), text }),
        ),
        outputEntry: rule.outputEntries.map((text) =>
          moddle.create('dmn:LiteralExpression', { id: nextId('OE'), text }),
        ),
      }),
    )

    const decisionTable = moddle.create('dmn:DecisionTable', {
      id: decision.decisionTable.id,
      hitPolicy: decision.decisionTable.hitPolicy,
      aggregation: decision.decisionTable.aggregation,
      input: inputs,
      output: outputs,
      rule: rules,
    })

    return moddle.create('dmn:Decision', {
      id: decision.id,
      name: decision.name,
      informationRequirement: (decision.requires ?? []).map((required) =>
        moddle.create('dmn:InformationRequirement', { id: nextId('IR'), requiredDecision: href(required) }),
      ),
      decisionLogic: decisionTable,
    })
  })

  const services = (model.decisionServices ?? []).map((service) =>
    moddle.create('dmn:DecisionService', {
      id: service.id,
      name: service.name,
      outputDecision: service.outputDecisions.map(href),
      encapsulatedDecision: service.encapsulatedDecisions.map(href),
    }),
  )

  const definitions = moddle.create('dmn:Definitions', {
    id: model.definitionsId,
    name: model.definitionsName,
    namespace: model.namespace,
    drgElement: [...drgElements, ...services],
  })

  const { xml } = await moddle.toXML(definitions, { format: true, preamble: true })
  return xml
}

export function createEmptyDecision(name: string): DmnDecision {
  return {
    id: nextId('Decision'),
    name,
    decisionTable: {
      id: nextId('DecisionTable'),
      hitPolicy: 'UNIQUE',
      inputs: [
        { id: nextId('Input'), label: 'Input 1', expression: 'input1', typeRef: 'string' },
      ],
      outputs: [{ id: nextId('Output'), name: 'result', typeRef: 'string' }],
      rules: [{ id: nextId('Rule'), inputEntries: [''], outputEntries: [''] }],
    },
  }
}
