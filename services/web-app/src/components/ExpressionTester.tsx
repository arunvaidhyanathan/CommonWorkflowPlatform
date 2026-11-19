// Test an expression before deploying it (#12). Evaluated by the runtime with
// the engines' own expression manager and sandbox (no beans, no reflection),
// so Flowable 8 features such as lambdas and stream() behave exactly as they
// will at runtime. Pre-filled from the selected element's condition.
import { useEffect, useMemo, useState } from 'react'
import { evaluateExpression, parseVariables, type ExpressionResult } from '../data/work'
import type { NodeData } from '../store/useWorkbenchStore'

const EXAMPLES = [
  '${amount > 5000}',
  "${vars:getOrDefault('riskTier', '') == 'HIGH'}",
  '${reviews.stream().allMatch(r -> r.vote == "approve")}',
  '${items.stream().filter(i -> i.price > 100).toList()}',
]

/** The first condition-like field the element has, to start from. */
function conditionOf(data: NodeData | undefined): string {
  if (!data) return ''
  const d = data as Record<string, unknown>
  const event = d.eventDefinition as { condition?: string } | undefined
  const mi = d.multiInstance as { completionCondition?: string } | undefined
  return String(d.conditionExpression ?? d.completionCondition ?? d.repetitionCondition ?? event?.condition ?? mi?.completionCondition ?? '')
}

export function ExpressionTester({ selected }: { selected?: NodeData }) {
  const [open, setOpen] = useState(false)
  const [expression, setExpression] = useState('')
  const [variablesText, setVariablesText] = useState('{\n  "amount": 6000\n}')
  const [result, setResult] = useState<ExpressionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const parsed = useMemo(() => parseVariables(variablesText), [variablesText])

  useEffect(() => {
    const condition = conditionOf(selected)
    if (condition) setExpression(condition)
    setResult(null)
  }, [selected])

  const run = async () => {
    if ('error' in parsed) return
    setError(null)
    try {
      setResult(await evaluateExpression(expression, parsed.variables))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not evaluate.')
    }
  }

  const input = 'w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs outline-none focus:border-sky-500'
  return (
    <div className="border-t border-sky-200 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="text-[10px] font-bold uppercase text-slate-500 hover:text-sky-700">
        {open ? '-' : '+'} Test an expression
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <input value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="${...}" className={input} />
          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setExpression(ex)} title={ex}
                className="max-w-full truncate rounded bg-slate-100 px-1 font-mono text-[9px] text-slate-600 hover:bg-sky-100">
                {ex}
              </button>
            ))}
          </div>
          <label className="block text-[10px] text-slate-500">
            Sample variables (JSON)
            <textarea value={variablesText} onChange={(e) => setVariablesText(e.target.value)} rows={4} spellCheck={false} className={input} />
          </label>
          {'error' in parsed && <p className="text-[11px] text-red-600">{parsed.error}</p>}
          <button type="button" disabled={!expression.trim() || 'error' in parsed} onClick={run}
            className="rounded bg-[#0066b2] px-3 py-1 text-xs font-semibold text-white hover:bg-[#003b70] disabled:opacity-50">
            Evaluate
          </button>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {result && (
            <pre className={`overflow-auto rounded p-2 text-[11px] ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {result.ok ? `${JSON.stringify(result.value)}  (${result.valueType ?? 'null'})` : result.error}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
