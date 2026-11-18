// Publish as an app (#13): pick other workflows to release together with
// the open one. With any picked, Publish sends one multi-artifact manifest,
// which the runtime deploys as a single Flowable app so the related
// definitions (e.g. a process, the case it starts, the decisions the case
// calls) version together. Workflows the open model references by key are
// pre-selected.
import { useEffect, useState } from 'react'
import { listWorkflows, type WorkflowSummary } from '../data/workflows'

export function PublishBundlePicker({
  tenantId,
  currentWorkflowId,
  referencedKeys,
  selected,
  onChange,
}: {
  tenantId: string | null
  currentWorkflowId: string | null
  referencedKeys: string[]
  selected: WorkflowSummary[]
  onChange: (workflows: WorkflowSummary[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const referenced = referencedKeys.join(',')

  useEffect(() => {
    if (!tenantId) return
    listWorkflows(tenantId)
      .then((all) => {
        const others = all.filter((w) => w.id !== currentWorkflowId && w.currentVersionId && w.status !== 'archived')
        setWorkflows(others)
        const keys = referenced.split(',').filter(Boolean)
        onChange(others.filter((w) => keys.includes(w.definitionKey)))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load workflows.'))
    // onChange is a state setter from the parent; re-run only when the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, currentWorkflowId, referenced])

  const toggle = (w: WorkflowSummary) =>
    onChange(selected.some((s) => s.id === w.id) ? selected.filter((s) => s.id !== w.id) : [...selected, w])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Release related workflows together with this one, as one app"
        className="rounded border border-[#003b70] bg-white px-2 py-1.5 text-xs font-semibold text-[#003b70] hover:bg-sky-50"
      >
        {selected.length ? `Bundle: +${selected.length}` : 'Bundle...'}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-sky-200 bg-white p-3 text-xs shadow-lg">
          <p className="mb-2 text-slate-500">
            Publish these with the open workflow as one app (versioned and released together).
            {referencedKeys.length > 0 && ' Workflows this model references are pre-selected.'}
          </p>
          {error && <p className="text-red-600">{error}</p>}
          {workflows.length === 0 && !error && <p className="text-slate-500">No other saved workflows.</p>}
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {workflows.map((w) => (
              <li key={w.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.some((s) => s.id === w.id)} onChange={() => toggle(w)} />
                  <span className="flex-1 truncate">{w.name}</span>
                  <span className="font-mono text-[10px] text-slate-400">{w.definitionKey}</span>
                  <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{w.specType}</span>
                  {w.status !== 'approved' && w.status !== 'deployed' && (
                    <span className="text-[9px] text-amber-700" title="Not approved yet">{w.status}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
