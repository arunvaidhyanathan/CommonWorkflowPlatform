// Workflow Identity Capture (Designer.html Section 4.2). Shown on New and on
// Import; validates and locks the process ID (definition key) before the
// canvas opens.
import { useEffect, useState } from 'react'
import { validateDefinitionKey, isDefinitionKeyTaken } from '../data/workflows'
import type { SpecType } from '../store/useWorkbenchStore'

export interface IdentityResult {
  definitionKey: string
  name: string
  description: string
  specType: SpecType
}

interface WorkflowIdentityDialogProps {
  open: boolean
  tenantId: string
  mode: 'create' | 'import'
  initial?: Partial<IdentityResult>
  onCancel: () => void
  onConfirm: (result: IdentityResult) => void
}

const SPEC_OPTIONS: { value: SpecType; label: string }[] = [
  { value: 'BPMN', label: 'BPMN — Process' },
  { value: 'CMMN', label: 'CMMN — Case' },
  { value: 'DMN', label: 'DMN — Decision' },
]

export function WorkflowIdentityDialog({
  open,
  tenantId,
  mode,
  initial,
  onCancel,
  onConfirm,
}: WorkflowIdentityDialogProps) {
  const [definitionKey, setDefinitionKey] = useState(initial?.definitionKey ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [specType, setSpecType] = useState<SpecType>(initial?.specType ?? 'BPMN')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (open) {
      setDefinitionKey(initial?.definitionKey ?? '')
      setName(initial?.name ?? '')
      setDescription(initial?.description ?? '')
      setSpecType(initial?.specType ?? 'BPMN')
      setError(null)
    }
  }, [open, initial])

  if (!open) return null

  const handleConfirm = async () => {
    setError(null)

    const keyError = validateDefinitionKey(definitionKey)
    if (keyError) {
      setError(keyError)
      return
    }
    if (!name.trim()) {
      setError('Name is required.')
      return
    }

    setChecking(true)
    try {
      const taken = await isDefinitionKeyTaken(tenantId, definitionKey)
      if (taken) {
        setError(
          `Process ID "${definitionKey}" is already in use in this tenant. Choose a different ID, or open the existing workflow to import as a new version.`,
        )
        return
      }
      onConfirm({ definitionKey, name, description, specType })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not validate the process ID.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="w-96 space-y-4 rounded-lg border border-sky-200 bg-white p-6 shadow-xl">
        <h2 className="text-base font-bold text-[#003b70]">
          {mode === 'create' ? 'New Workflow' : 'Confirm Imported Workflow Identity'}
        </h2>
        <p className="text-xs text-slate-500">
          The Process ID correlates versions of this workflow in Flowable. It cannot be
          changed after the first deploy.
        </p>

        {mode === 'create' ? (
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-slate-500">
              Specification Type
            </label>
            <div className="flex gap-1.5">
              {SPEC_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSpecType(opt.value)}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium ${
                    specType === opt.value
                      ? 'border-[#0066b2] bg-[#0066b2] text-white'
                      : 'border-sky-200 bg-white text-slate-600 hover:bg-sky-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
            Detected type: <span className="font-bold">{specType}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">
            {specType === 'DMN' ? 'Decision ID' : specType === 'CMMN' ? 'Case ID' : 'Process ID'}{' '}
            (definition key)
          </label>
          <input
            type="text"
            value={definitionKey}
            onChange={(e) => setDefinitionKey(e.target.value)}
            placeholder="loan_approval_process"
            className="w-full rounded border border-sky-200 bg-sky-50 p-2 font-mono text-sm outline-none focus:border-sky-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Loan Approval Process"
            className="w-full rounded border border-sky-200 bg-sky-50 p-2 text-sm outline-none focus:border-sky-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded border border-sky-200 bg-sky-50 p-2 text-sm outline-none focus:border-sky-500"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={checking}
            className="rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
          >
            {checking ? 'Checking...' : mode === 'create' ? 'Create' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
