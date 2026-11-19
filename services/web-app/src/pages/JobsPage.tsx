// Background Jobs (tenant admins): failed jobs that ran out of retries,
// scheduled timers, and jobs waiting for the async executor. Failed jobs can
// be inspected (stack trace), retried or deleted; a timer can be fired now,
// e.g. to test an SLA path without waiting.
import { useCallback, useEffect, useState } from 'react'
import { deleteJob, fireTimer, jobStacktrace, listJobs, retryJob, type JobSummary } from '../data/work'

const STATES: { key: JobSummary['state']; label: string }[] = [
  { key: 'failed', label: 'Failed' },
  { key: 'timer', label: 'Timers' },
  { key: 'waiting', label: 'Waiting to run' },
]

export function JobsPage() {
  const [state, setState] = useState<JobSummary['state']>('failed')
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [trace, setTrace] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setJobs(await listJobs(state))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load jobs.')
    }
  }, [state])

  useEffect(() => {
    refresh()
  }, [refresh])

  const act = async (id: string, action: () => Promise<void>) => {
    setBusy(id)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action failed.')
    } finally {
      setBusy(null)
    }
  }

  const button = 'rounded border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50'

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-bold text-[#003b70]">Background Jobs</h1>
      <p className="mb-4 text-sm text-slate-500">Timers, async steps and batch parts run by the engines for your tenant.</p>
      <div className="mb-4 flex gap-1">
        {STATES.map((s) => (
          <button key={s.key} type="button" onClick={() => { setState(s.key); setTrace(null) }}
            className={`rounded px-3 py-1 text-xs font-semibold ${state === s.key ? 'bg-[#0066b2] text-white' : 'bg-sky-50 text-slate-600 hover:bg-sky-100'}`}>
            {s.label}
          </button>
        ))}
        <button type="button" onClick={refresh} className="ml-auto rounded border border-sky-200 px-2 py-1 text-xs text-slate-600 hover:bg-sky-50">
          Refresh
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {jobs.length === 0 && !error && <p className="text-sm text-slate-500">No {STATES.find((s) => s.key === state)?.label.toLowerCase()} jobs.</p>}
      <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
        {jobs.map((j) => (
          <div key={j.id} className="p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">{j.elementName || j.elementId || j.handler}</div>
                <div className="text-[11px] text-slate-500">
                  {j.kind} {j.instanceId?.slice(0, 8)} &middot; {j.handler}
                  {j.dueDate && <> &middot; due {new Date(j.dueDate).toLocaleString()}</>}
                  {state === 'failed' && <> &middot; retries left {j.retries}</>}
                </div>
                {j.exceptionMessage && <div className="mt-1 truncate font-mono text-[11px] text-red-700">{j.exceptionMessage}</div>}
              </div>
              <div className="flex shrink-0 gap-1">
                {state === 'failed' && (
                  <>
                    <button type="button" disabled={busy === j.id} className={`${button} border-slate-300 text-slate-600`}
                      onClick={() => act(j.id, async () => setTrace({ id: j.id, text: (await jobStacktrace(j.id)).stacktrace }))}>
                      Stack trace
                    </button>
                    <button type="button" disabled={busy === j.id} className={`${button} border-sky-300 text-[#0066b2]`}
                      onClick={() => act(j.id, () => retryJob(j.id))}>Retry</button>
                    <button type="button" disabled={busy === j.id} className={`${button} border-red-300 text-red-700`}
                      onClick={() => confirm('Delete this failed job? The step will not run again.') && act(j.id, () => deleteJob(j.id))}>
                      Delete
                    </button>
                  </>
                )}
                {state === 'timer' && (
                  <button type="button" disabled={busy === j.id} className={`${button} border-amber-300 text-amber-700`}
                    onClick={() => act(j.id, () => fireTimer(j.id))}>Fire now</button>
                )}
              </div>
            </div>
            {trace?.id === j.id && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">{trace.text}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
