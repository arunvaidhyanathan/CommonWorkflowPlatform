// DMN Adapter (Designer.html Section 7.3): converts between DMN 1.3 XML and
// an internal decision-table model edited by the TanStack grid. DRD
// (multi-decision dependency) support is out of v1 scope per the design
// doc — this reads every standalone decision table in the file so a
// multi-decision file is still fully usable, just without dependency wiring.
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
}

export interface DmnModel {
  definitionsId: string
  definitionsName: string
  namespace: string
  decisions: DmnDecision[]
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

    const outputs = ((decisionLogic.output as ModdleElement[] | undefined) ?? []).map((clause) => ({
      id: (clause.id as string) ?? nextId('output'),
      name: (clause.name as string) ?? 'result',
      typeRef: (clause.typeRef as string) ?? 'string',
    }))

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

  return {
    definitionsId: (rootElement.id as string) ?? nextId('definitions'),
    definitionsName: (rootElement.name as string) ?? 'DMN Definitions',
    namespace: (rootElement.namespace as string) ?? 'http://waas.citi.com/dmn',
    decisions,
  }
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
      decisionLogic: decisionTable,
    })
  })

  const definitions = moddle.create('dmn:Definitions', {
    id: model.definitionsId,
    name: model.definitionsName,
    namespace: model.namespace,
    drgElement: drgElements,
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
