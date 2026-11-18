// My Tasks: the runtime task inbox for BPMN and CMMN human tasks. "Mine" is
// what the user holds, "Available" is unclaimed work offered to them or one
// of their groups, "All" (tenant admins) is every open task in the tenant.
// There is no form engine in Flowable OSS, so task data is shown and
// submitted as JSON variables; the task's form key is displayed for reference.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../lib/useSession'
import { useMemberNames } from '../lib/useMemberNames'
import {
  claimTask,
  completeTask,
  getTask,
  listTasks,
  parseVariables,
  unclaimTask,
  type TaskDetail,
  type TaskFilter,
  type TaskSummary,
} from '../data/work'

const FILTERS: { key: TaskFilter; label: string; adminOnly?: boolean }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'available', label: 'Available' },
  { key: 'all', label: 'All (admin)', adminOnly: true },
]

export function TasksPage() {
  const { tenantId, userId, role } = useSession()
  const nameOf = useMemberNames(tenantId)
  const [filter, setFilter] = useState<TaskFilter>('mine')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTasks(await listTasks(filter))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onChanged = async (stillSelected: boolean) => {
    if (!stillSelected) setSelectedId(null)
    await refresh()
  }

  return (
    <div className="flex h-full overflow-hidden">
      <section className="flex w-[420px] shrink-0 flex-col border-r border-sky-200">
        <div className="border-b border-sky-200 p-4">
          <h1 className="text-lg font-bold text-[#003b70]">My Tasks</h1>
          <p className="text-xs text-slate-500">Human tasks from running processes and cases.</p>
          <div className="mt-3 flex gap-1">
            {FILTERS.filter((f) => !f.adminOnly || role === 'tenant_admin').map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilter(f.key)
                  setSelectedId(null)
                }}
                className={`rounded px-3 py-1 text-xs font-semibold ${
                  filter === f.key ? 'bg-[#0066b2] text-white' : 'bg-sky-50 text-slate-600 hover:bg-sky-100'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={refresh}
              className="ml-auto rounded border border-sky-200 px-2 py-1 text-xs text-slate-600 hover:bg-sky-50"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error && <p className="p-4 text-sm text-red-600">{error}</p>}
          {loading && <p className="p-4 text-sm text-slate-500">Loading...</p>}
          {!loading && !error && tasks.length === 0 && (
            <p className="p-4 text-sm text-slate-500">
              {filter === 'mine' ? 'Nothing assigned to you.' : 'No tasks here.'}
            </p>
          )}
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`block w-full border-b border-sky-100 p-3 text-left hover:bg-sky-50 ${
                selectedId === t.id ? 'bg-sky-100' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-800">{t.name || 'Untitled task'}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                  {t.kind}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                {t.assignee ? `Assigned to ${t.assignee === userId ? 'you' : nameOf(t.assignee)}` : 'Unassigned'}
                {t.candidateGroups.length > 0 && <> &middot; groups: {t.candidateGroups.join(', ')}</>}
              </div>
              <div className="text-[10px] text-slate-400">
                {t.createTime && new Date(t.createTime).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="flex-1 overflow-y-auto p-6">
        {selectedId ? (
          <TaskPanel key={selectedId} taskId={selectedId} userId={userId} nameOf={nameOf} onChanged={onChanged} />
        ) : (
          <p className="text-sm text-slate-500">Select a task to see its details.</p>
        )}
      </section>
    </div>
  )
}

function TaskPanel({
  taskId,
  userId,
  nameOf,
  onChanged,
}: {
  taskId: string
  userId: string | null
  nameOf: (id: string | null) => string
  onChanged: (stillSelected: boolean) => Promise<void>
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [variablesText, setVariablesText] = useState('{}')

  const load = useCallback(async () => {
    try {
      setDetail(await getTask(taskId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the task.')
    }
  }, [taskId])

  useEffect(() => {
    load()
  }, [load])

  const parsed = useMemo(() => parseVariables(variablesText), [variablesText])

  const run = async (action: () => Promise<void>, stillSelected: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (stillSelected) await load()
      await onChanged(stillSelected)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!detail) {
    return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-slate-500">Loading...</p>
  }
  const { task } = detail
  const mine = task.assignee !== null && task.assignee === userId

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-bold text-[#003b70]">{task.name || 'Untitled task'}</h2>
      {task.description && <p className="mt-1 text-sm text-slate-600">{task.description}</p>}
      <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-1 text-xs">
        <dt className="font-semibold text-slate-500">Assignee</dt>
        <dd>{mine ? 'You' : nameOf(task.assignee)}</dd>
        <dt className="font-semibold text-slate-500">Candidate groups</dt>
        <dd>{task.candidateGroups.join(', ') || '--'}</dd>
        <dt className="font-semibold text-slate-500">Form key</dt>
        <dd className="font-mono">{task.formKey || '--'}</dd>
        <dt className="font-semibold text-slate-500">{task.kind === 'case' ? 'Case' : 'Process'} instance</dt>
        <dd className="font-mono">{task.instanceId}</dd>
        <dt className="font-semibold text-slate-500">Created</dt>
        <dd>{task.createTime && new Date(task.createTime).toLocaleString()}</dd>
      </dl>

      <h3 className="mt-5 mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Current variables</h3>
      <pre className="max-h-64 overflow-auto rounded border border-sky-200 bg-slate-50 p-3 text-xs">
        {JSON.stringify(detail.variables, null, 2)}
      </pre>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex gap-2">
        {detail.canClaim && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => claimTask(task.id), true)}
            className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm font-semibold text-[#0066b2] hover:bg-sky-50 disabled:opacity-50"
          >
            Claim
          </button>
        )}
        {mine && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => unclaimTask(task.id), true)}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Release
          </button>
        )}
      </div>

      {detail.canComplete && (
        <div className="mt-5 rounded-lg border border-sky-200 p-4">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Complete task</h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Variables to set on completion, as a JSON object
            {task.assignee === null && ' (completing an unclaimed task claims it for you)'}.
          </p>
          <textarea
            value={variablesText}
            onChange={(e) => setVariablesText(e.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full rounded border border-sky-200 p-2 font-mono text-xs outline-none focus:border-sky-500"
          />
          {'error' in parsed && <p className="mt-1 text-xs text-red-600">{parsed.error}</p>}
          <button
            type="button"
            disabled={busy || 'error' in parsed}
            onClick={() => 'variables' in parsed && run(() => completeTask(task.id, parsed.variables), false)}
            className="mt-2 rounded bg-[#0066b2] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
          >
            {busy ? 'Working...' : 'Complete'}
          </button>
        </div>
      )}
    </div>
  )
}
