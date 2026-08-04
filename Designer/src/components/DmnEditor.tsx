// DMN Decision Table Editor (Designer.html Section 10, extended to dynamic
// columns): clause editor above a TanStack-table rule grid below.
import { useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import type {
  DmnDecision,
  DmnInputClause,
  DmnOutputClause,
  DmnRule,
  HitPolicy,
  Aggregation,
} from '../adapters/dmnAdapter'

const HIT_POLICIES: HitPolicy[] = [
  'UNIQUE',
  'FIRST',
  'PRIORITY',
  'ANY',
  'COLLECT',
  'RULE ORDER',
  'OUTPUT ORDER',
]
const AGGREGATIONS: Aggregation[] = ['SUM', 'COUNT', 'MIN', 'MAX']

let idCounter = 0
function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}_${Date.now()}_${idCounter}`
}

interface DmnEditorProps {
  decision: DmnDecision
  onChange: (decision: DmnDecision) => void
}

export function DmnEditor({ decision, onChange }: DmnEditorProps) {
  const table = decision.decisionTable

  const updateTable = (patch: Partial<typeof table>) => {
    onChange({ ...decision, decisionTable: { ...table, ...patch } })
  }

  const addInput = () => {
    const newInput: DmnInputClause = {
      id: nextId('Input'),
      label: `Input ${table.inputs.length + 1}`,
      expression: '',
      typeRef: 'string',
    }
    updateTable({
      inputs: [...table.inputs, newInput],
      rules: table.rules.map((r) => ({ ...r, inputEntries: [...r.inputEntries, ''] })),
    })
  }

  const removeInput = (index: number) => {
    updateTable({
      inputs: table.inputs.filter((_, i) => i !== index),
      rules: table.rules.map((r) => ({
        ...r,
        inputEntries: r.inputEntries.filter((_, i) => i !== index),
      })),
    })
  }

  const addOutput = () => {
    const newOutput: DmnOutputClause = {
      id: nextId('Output'),
      name: `output${table.outputs.length + 1}`,
      typeRef: 'string',
    }
    updateTable({
      outputs: [...table.outputs, newOutput],
      rules: table.rules.map((r) => ({ ...r, outputEntries: [...r.outputEntries, ''] })),
    })
  }

  const removeOutput = (index: number) => {
    updateTable({
      outputs: table.outputs.filter((_, i) => i !== index),
      rules: table.rules.map((r) => ({
        ...r,
        outputEntries: r.outputEntries.filter((_, i) => i !== index),
      })),
    })
  }

  const addRule = () => {
    const newRule: DmnRule = {
      id: nextId('Rule'),
      inputEntries: table.inputs.map(() => ''),
      outputEntries: table.outputs.map(() => ''),
    }
    updateTable({ rules: [...table.rules, newRule] })
  }

  const removeRule = (ruleId: string) => {
    updateTable({ rules: table.rules.filter((r) => r.id !== ruleId) })
  }

  const updateRuleCell = (
    ruleId: string,
    kind: 'inputEntries' | 'outputEntries',
    index: number,
    value: string,
  ) => {
    updateTable({
      rules: table.rules.map((r) =>
        r.id === ruleId
          ? { ...r, [kind]: r[kind].map((v, i) => (i === index ? value : v)) }
          : r,
      ),
    })
  }

  const columnHelper = createColumnHelper<DmnRule>()

  const columns = useMemo(() => {
    const cols = [
      columnHelper.display({
        id: 'rowNum',
        header: '#',
        cell: (info) => info.row.index + 1,
      }),
      ...table.inputs.map((input, index) =>
        columnHelper.display({
          id: `input_${input.id}`,
          header: () => (
            <span className="font-mono text-[10px] text-slate-500">
              {input.label || input.expression}
            </span>
          ),
          cell: (info) => (
            <input
              value={info.row.original.inputEntries[index] ?? ''}
              onChange={(e) =>
                updateRuleCell(info.row.original.id, 'inputEntries', index, e.target.value)
              }
              placeholder="-"
              className="w-full bg-transparent p-1 font-mono text-xs text-slate-800 outline-none"
            />
          ),
        }),
      ),
      ...table.outputs.map((output, index) =>
        columnHelper.display({
          id: `output_${output.id}`,
          header: () => (
            <span className="font-mono text-[10px] text-emerald-700">{output.name}</span>
          ),
          cell: (info) => (
            <input
              value={info.row.original.outputEntries[index] ?? ''}
              onChange={(e) =>
                updateRuleCell(info.row.original.id, 'outputEntries', index, e.target.value)
              }
              placeholder="-"
              className="w-full bg-emerald-50/50 p-1 font-mono text-xs text-slate-800 outline-none"
            />
          ),
        }),
      ),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => (
          <button
            type="button"
            onClick={() => removeRule(info.row.original.id)}
            className="rounded px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        ),
      }),
    ]
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.inputs, table.outputs])

  const reactTable = useReactTable({
    data: table.rules,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="flex h-full flex-col overflow-auto bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={decision.name}
          onChange={(e) => onChange({ ...decision, name: e.target.value })}
          className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sm font-semibold text-[#003b70] outline-none focus:border-sky-500"
        />
        <label className="text-xs text-slate-500">
          Hit Policy
          <select
            value={table.hitPolicy}
            onChange={(e) => updateTable({ hitPolicy: e.target.value as HitPolicy })}
            className="ml-1.5 rounded border border-sky-200 bg-white px-1.5 py-1 text-xs"
          >
            {HIT_POLICIES.map((hp) => (
              <option key={hp} value={hp}>
                {hp}
              </option>
            ))}
          </select>
        </label>
        {table.hitPolicy === 'COLLECT' && (
          <label className="text-xs text-slate-500">
            Aggregation
            <select
              value={table.aggregation ?? ''}
              onChange={(e) =>
                updateTable({ aggregation: (e.target.value || undefined) as Aggregation })
              }
              className="ml-1.5 rounded border border-sky-200 bg-white px-1.5 py-1 text-xs"
            >
              <option value="">None</option>
              {AGGREGATIONS.map((agg) => (
                <option key={agg} value={agg}>
                  {agg}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-4">
        <div className="min-w-[280px] flex-1 rounded border border-sky-200 bg-sky-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-sky-800">Input Clauses</span>
            <button
              type="button"
              onClick={addInput}
              className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-sky-700"
            >
              + Add Input
            </button>
          </div>
          <div className="space-y-2">
            {table.inputs.map((input, index) => (
              <div key={input.id} className="flex items-center gap-1.5 rounded bg-white p-1.5">
                <input
                  value={input.label}
                  onChange={(e) => {
                    const inputs = [...table.inputs]
                    inputs[index] = { ...input, label: e.target.value }
                    updateTable({ inputs })
                  }}
                  placeholder="Label"
                  className="w-24 border-b border-sky-200 p-0.5 text-xs outline-none"
                />
                <input
                  value={input.expression}
                  onChange={(e) => {
                    const inputs = [...table.inputs]
                    inputs[index] = { ...input, expression: e.target.value }
                    updateTable({ inputs })
                  }}
                  placeholder="FEEL expression"
                  className="flex-1 border-b border-sky-200 p-0.5 font-mono text-xs outline-none"
                />
                <input
                  value={input.typeRef}
                  onChange={(e) => {
                    const inputs = [...table.inputs]
                    inputs[index] = { ...input, typeRef: e.target.value }
                    updateTable({ inputs })
                  }}
                  placeholder="type"
                  className="w-16 border-b border-sky-200 p-0.5 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeInput(index)}
                  className="text-[10px] text-red-500 hover:underline"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-[220px] flex-1 rounded border border-emerald-200 bg-emerald-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-emerald-800">
              Output Clauses
            </span>
            <button
              type="button"
              onClick={addOutput}
              className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
            >
              + Add Output
            </button>
          </div>
          <div className="space-y-2">
            {table.outputs.map((output, index) => (
              <div key={output.id} className="flex items-center gap-1.5 rounded bg-white p-1.5">
                <input
                  value={output.name}
                  onChange={(e) => {
                    const outputs = [...table.outputs]
                    outputs[index] = { ...output, name: e.target.value }
                    updateTable({ outputs })
                  }}
                  placeholder="name"
                  className="flex-1 border-b border-emerald-200 p-0.5 font-mono text-xs outline-none"
                />
                <input
                  value={output.typeRef}
                  onChange={(e) => {
                    const outputs = [...table.outputs]
                    outputs[index] = { ...output, typeRef: e.target.value }
                    updateTable({ outputs })
                  }}
                  placeholder="type"
                  className="w-16 border-b border-emerald-200 p-0.5 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeOutput(index)}
                  className="text-[10px] text-red-500 hover:underline"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-sky-200 bg-white p-2">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-sky-50 text-slate-700">
            {reactTable.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="border border-sky-100 p-2">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {reactTable.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-sky-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="border border-sky-50 p-1">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addRule}
          className="mt-2 rounded border border-sky-300 bg-white px-3 py-1 text-xs text-sky-700 hover:bg-sky-50"
        >
          + Add Rule
        </button>
      </div>
    </div>
  )
}
