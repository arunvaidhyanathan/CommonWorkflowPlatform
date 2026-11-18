// Decision Tester: evaluate any deployed DMN decision or decision service
// with sample inputs and see the result plus, for every decision evaluated,
// its hit policy and which rules matched. Read-only: nothing is changed, so
// every member can use it. Decisions encapsulated in a service aren't listed
// on their own -- the engine only exposes them through the service.
import { useEffect, useMemo, useState } from 'react'
import {
  evaluateDecision,
  listDecisions,
  parseVariables,
  type DecisionEvaluation,
  type DecisionSummary,
} from '../data/work'

export function DecisionsPage() {
  const [decisions, setDecisions] = useState<DecisionSummary[]>([])
  const [key, setKey] = useState('')
  const [inputsText, setInputsText] = useState('{\n  \n}')
  const [evaluation, setEvaluation] = useState<DecisionEvaluation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listDecisions()
      .then((list) => {
        setDecisions(list)
        setKey((current) => current || list[0]?.key || '')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load decisions.'))
  }, [])

  const parsed = useMemo(() => parseVariables(inputsText), [inputsText])

  const onEvaluate = async () => {
    if (!key || 'error' in parsed) return
    setBusy(true)
    setError(null)
    try {
      setEvaluation(await evaluateDecision(key, parsed.variables))
    } catch (err) {
      setEvaluation(null)
      setError(err instanceof Error ? err.message : 'Evaluation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-bold text-[#003b70]">Decision Tester</h1>
      <p className="mb-4 text-sm text-slate-500">
        Evaluate a deployed decision or decision service with sample inputs. Nothing is saved.
      </p>

      <div className="grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <label className="block text-xs font-semibold text-slate-500">
            Decision
            <select
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setEvaluation(null)
              }}
              className="mt-1 w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-sm"
            >
              {decisions.length === 0 && <option value="">No deployed decisions</option>}
              {decisions.map((d) => (
                <option key={d.id} value={d.key}>
                  {d.name || d.key} ({d.type === 'decision_service' ? 'service' : 'table'}, v{d.version})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Inputs (JSON object)
            <textarea
              value={inputsText}
              onChange={(e) => setInputsText(e.target.value)}
              rows={12}
              spellCheck={false}
              className="mt-1 w-full rounded border border-sky-200 p-2 font-mono text-xs outline-none focus:border-sky-500"
            />
          </label>
          {'error' in parsed && <p className="text-xs text-red-600">{parsed.error}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="button"
            disabled={busy || !key || 'error' in parsed}
            onClick={onEvaluate}
            className="rounded bg-[#0066b2] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
          >
            {busy ? 'Evaluating...' : 'Evaluate'}
          </button>
        </section>

        <section>
          {evaluation ? (
            <>
              <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Result</h2>
              <pre className="max-h-72 overflow-auto rounded border border-sky-200 bg-slate-50 p-3 text-xs">
                {JSON.stringify(evaluation.result, null, 2)}
              </pre>
              <h2 className="mt-4 mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                How it was decided
              </h2>
              <ul className="divide-y divide-sky-100 rounded border border-sky-200 text-xs">
                {evaluation.decisions.map((d) => (
                  <li key={d.key} className="p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">{d.name || d.key}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                        {d.hitPolicy}
                      </span>
                    </div>
                    {d.failed ? (
                      <p className="mt-1 text-red-600">Failed: {d.message}</p>
                    ) : (
                      <p className="mt-1 text-slate-600">
                        {d.matchedRules.length === 0
                          ? 'No rule matched.'
                          : `Matched rule${d.matchedRules.length > 1 ? 's' : ''} ${d.matchedRules.join(', ')}`}
                        {' -> '}
                        <span className="font-mono">{JSON.stringify(d.result)}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {evaluation.decisions.length > 1 && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Note: inside a decision service, a decision that feeds another passes on its last matching
                  row, not its hit-policy result. Keep FIRST/UNIQUE for decisions other decisions depend on.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">Run an evaluation to see the result and rule trace.</p>
          )}
        </section>
      </div>
    </div>
  )
}
