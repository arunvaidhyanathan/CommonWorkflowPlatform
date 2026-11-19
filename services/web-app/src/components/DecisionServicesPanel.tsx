// Decision services for the open DMN file: one key that evaluates several
// decisions. Output decisions are returned to the caller (e.g. a CMMN
// decision task, which stores them as one JSON variable named after the
// service id); encapsulated decisions run internally only. The service id is
// the key callers use.
import type { DmnDecision, DmnDecisionService } from '../adapters/dmnAdapter'

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function DecisionServicesPanel({
  decisions,
  services,
  onChange,
}: {
  decisions: DmnDecision[]
  services: DmnDecisionService[]
  onChange: (services: DmnDecisionService[]) => void
}) {
  const update = (index: number, patch: Partial<DmnDecisionService>) =>
    onChange(services.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  // A decision is either returned (output) or internal (encapsulated) in a service, never both.
  const setRole = (index: number, decisionId: string, role: 'output' | 'encapsulated' | 'none') => {
    const svc = services[index]
    const outputs = svc.outputDecisions.filter((d) => d !== decisionId)
    const encapsulated = svc.encapsulatedDecisions.filter((d) => d !== decisionId)
    if (role === 'output') outputs.push(decisionId)
    if (role === 'encapsulated') encapsulated.push(decisionId)
    update(index, { outputDecisions: outputs, encapsulatedDecisions: encapsulated })
  }

  const add = () => {
    const n = services.length + 1
    onChange([
      ...services,
      { id: `decisionService${n}`, name: `Decision Service ${n}`, outputDecisions: [], encapsulatedDecisions: [] },
    ])
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-sky-900">Decision Services</h2>
        <button
          type="button"
          onClick={add}
          className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-sky-700"
        >
          + Add
        </button>
      </div>
      {services.length === 0 && (
        <p className="text-[11px] text-slate-500">None. Add one to call several decisions with one key.</p>
      )}
      <div className="flex flex-col gap-2">
        {services.map((svc, index) => {
          const idInvalid = !ID_PATTERN.test(svc.id) || decisions.some((d) => d.id === svc.id)
          return (
            <div key={index} className="rounded border border-sky-200 bg-white p-2">
              <div className="flex items-center gap-1">
                <input
                  value={svc.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  className="min-w-0 flex-1 border-b border-sky-200 text-xs font-semibold outline-none"
                />
                <button
                  type="button"
                  onClick={() => onChange(services.filter((_, i) => i !== index))}
                  className="text-[10px] text-red-500 hover:underline"
                  title="Remove service"
                >
                  x
                </button>
              </div>
              <label className="mt-1 block text-[10px] text-slate-500">
                Key
                <input
                  value={svc.id}
                  onChange={(e) => update(index, { id: e.target.value.trim() })}
                  className={`ml-1 w-[calc(100%-2rem)] border-b font-mono text-[11px] outline-none ${
                    idInvalid ? 'border-red-400 text-red-700' : 'border-sky-200'
                  }`}
                />
              </label>
              {idInvalid && (
                <p className="text-[10px] text-red-600">Use letters, digits, _ or -, unique among decisions.</p>
              )}
              <table className="mt-1 w-full text-[10px]">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left font-normal">Decision</th>
                    <th className="font-normal" title="Returned to the caller">Out</th>
                    <th className="font-normal" title="Evaluated internally only">Int</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => {
                    const role = svc.outputDecisions.includes(d.id)
                      ? 'output'
                      : svc.encapsulatedDecisions.includes(d.id)
                        ? 'encapsulated'
                        : 'none'
                    return (
                      <tr key={d.id}>
                        <td className="truncate pr-1 text-slate-700">{d.name || d.id}</td>
                        {(['output', 'encapsulated'] as const).map((r) => (
                          <td key={r} className="text-center">
                            <input
                              type="checkbox"
                              checked={role === r}
                              onChange={(e) => setRole(index, d.id, e.target.checked ? r : 'none')}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {svc.outputDecisions.length === 0 && (
                <p className="mt-1 text-[10px] text-amber-700">Pick at least one output decision.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
