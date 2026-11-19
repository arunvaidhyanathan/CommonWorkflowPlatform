// History panels for Running Work's instance view (#11): the business status
// (Flowable 8) a case worker can set, and the timeline of every step (and, at
// history level "full", every variable change) in order.
import { useEffect, useState } from 'react'
import { getTimeline, setBusinessStatus, type InstanceDetail, type TimelineEntry } from '../data/work'

const WHAT_STYLE: Record<string, string> = {
  started: 'text-sky-700',
  completed: 'text-emerald-700',
  occurred: 'text-emerald-700',
  cancelled: 'text-slate-500',
  terminated: 'text-slate-500',
  exited: 'text-slate-500',
  variable: 'text-violet-700',
}

export function BusinessStatusField({ detail, canEdit, onSaved }: { detail: InstanceDetail; canEdit: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(detail.instance.businessStatus ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (value === (detail.instance.businessStatus ?? '')) return
    try {
      await setBusinessStatus(detail.instance.kind, detail.instance.id, value)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the status.')
    }
  }
  return (
    <div className="mt-3 text-xs">
      <label className="font-semibold text-slate-500">
        Business status{' '}
        {canEdit ? (
          <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="e.g. Awaiting documents" maxLength={255}
            className="ml-1 w-64 rounded border border-sky-200 px-1.5 py-0.5 font-normal text-slate-800" />
        ) : (
          <span className="font-normal text-slate-800">{detail.instance.businessStatus || '--'}</span>
        )}
      </label>
      {error && <span className="ml-2 text-red-600">{error}</span>}
    </div>
  )
}

export function TimelinePanel({ detail, nameOf }: { detail: InstanceDetail; nameOf: (id: string | null) => string }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showVariables, setShowVariables] = useState(false)

  useEffect(() => {
    getTimeline(detail.instance.kind, detail.instance.id)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the timeline.'))
  }, [detail])

  const shown = (entries ?? []).filter((e) => showVariables || e.what !== 'variable')
  return (
    <div className="mt-5 rounded-lg border border-sky-200 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Timeline</h3>
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          <input type="checkbox" checked={showVariables} onChange={(e) => setShowVariables(e.target.checked)} />
          Variable changes
        </label>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {entries && shown.length === 0 && <p className="text-xs text-slate-500">Nothing recorded yet.</p>}
      <ol className="max-h-80 space-y-0.5 overflow-y-auto text-[11px]">
        {shown.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-36 shrink-0 text-slate-400">{e.time && new Date(e.time).toLocaleString()}</span>
            <span className={`w-20 shrink-0 font-semibold ${WHAT_STYLE[e.what] ?? 'text-slate-600'}`}>{e.what}</span>
            <span className="truncate text-slate-800">
              {e.name || e.elementId}
              {e.what === 'variable' && <span className="font-mono text-slate-500"> = {e.detail}</span>}
              {e.userId && <span className="text-slate-500"> by {nameOf(e.userId)}</span>}
              {e.what !== 'variable' && e.type && <span className="text-slate-400"> ({e.type})</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
