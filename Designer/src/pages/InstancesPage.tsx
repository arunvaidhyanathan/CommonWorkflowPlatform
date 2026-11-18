// Running Work: start a process or case from any deployed definition, browse
// the tenant's instances, and inspect one: variables, CMMN plan items (stages,
// tasks, milestones, event listeners and their states), active BPMN
// activities and open tasks. Designers and tenant admins can edit variables;
// tenant admins can terminate. Viewers can look but not start.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../lib/useSession'
import { useMemberNames } from '../lib/useMemberNames'
import { AdHocWorkPanel, MigrationPanel } from '../components/InstanceChangePanels'
import { BusinessStatusField, TimelinePanel } from '../components/InstanceHistoryPanels'
import {
  getInstance,
  listDefinitions,
  listInstances,
  parseVariables,
  planItemAction,
  setInstanceVariables,
  startInstance,
  terminateInstance,
  type Definition,
  type InstanceDetail,
  type InstanceKind,
  type InstanceSummary,
  type PlanItemAction,
} from '../data/work'

const ACTION_LABEL: Record<PlanItemAction, string> = {
  start: 'Start',
  disable: 'Disable',
  enable: 'Enable',
  trigger: 'Trigger',
}

const STATE_STYLE: Record<string, string> = {
  active: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  terminated: 'bg-slate-200 text-slate-600',
  available: 'bg-slate-100 text-slate-500',
  enabled: 'bg-amber-100 text-amber-700',
}

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATE_STYLE[state] ?? 'bg-slate-100 text-slate-600'}`}>
      {state}
    </span>
  )
}

export function InstancesPage() {
  const { tenantId, role } = useSession()
  const nameOf = useMemberNames(tenantId)
  const [stateFilter, setStateFilter] = useState<'active' | 'all'>('active')
  const [instances, setInstances] = useState<InstanceSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ kind: InstanceKind; id: string } | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setInstances(await listInstances(stateFilter))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load instances.')
    }
  }, [stateFilter])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex h-full overflow-hidden">
      <section className="flex w-[440px] shrink-0 flex-col border-r border-sky-200">
        <div className="border-b border-sky-200 p-4">
          <h1 className="text-lg font-bold text-[#003b70]">Running Work</h1>
          <p className="text-xs text-slate-500">Process and case instances in your tenant.</p>
          {role !== 'viewer' && <StartForm onStarted={(s) => { refresh(); setSelected({ kind: s.kind, id: s.id }) }} />}
          <div className="mt-3 flex gap-1">
            {(['active', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStateFilter(s)}
                className={`rounded px-3 py-1 text-xs font-semibold ${
                  stateFilter === s ? 'bg-[#0066b2] text-white' : 'bg-sky-50 text-slate-600 hover:bg-sky-100'
                }`}
              >
                {s === 'active' ? 'Active' : 'All'}
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
          {!error && instances.length === 0 && <p className="p-4 text-sm text-slate-500">No instances.</p>}
          {instances.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => setSelected({ kind: i.kind, id: i.id })}
              className={`block w-full border-b border-sky-100 p-3 text-left hover:bg-sky-50 ${
                selected?.id === i.id ? 'bg-sky-100' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-800">
                  {i.definitionName || i.definitionKey}
                </span>
                <StateBadge state={i.state} />
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {i.kind} &middot; {i.businessKey || i.id.slice(0, 8)} &middot; started by {nameOf(i.startUserId)}
              </div>
              <div className="text-[10px] text-slate-400">{i.startTime && new Date(i.startTime).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </section>
      <section className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <InstancePanel
            key={selected.id}
            kind={selected.kind}
            id={selected.id}
            role={role}
            nameOf={nameOf}
            onChanged={refresh}
          />
        ) : (
          <p className="text-sm text-slate-500">Select an instance, or start a new one.</p>
        )}
      </section>
    </div>
  )
}

function StartForm({ onStarted }: { onStarted: (s: InstanceSummary) => void }) {
  const [open, setOpen] = useState(false)
  const [definitions, setDefinitions] = useState<Definition[]>([])
  const [definitionId, setDefinitionId] = useState('')
  const [businessKey, setBusinessKey] = useState('')
  const [variablesText, setVariablesText] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    listDefinitions()
      .then((defs) => {
        setDefinitions(defs)
        setDefinitionId((current) => current || defs[0]?.id || '')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load definitions.'))
  }, [open])

  const parsed = useMemo(() => parseVariables(variablesText), [variablesText])
  const definition = definitions.find((d) => d.id === definitionId)

  const onStart = async () => {
    if (!definition || 'error' in parsed) return
    setBusy(true)
    setError(null)
    try {
      const started = await startInstance({
        kind: definition.kind,
        definitionKey: definition.key,
        businessKey: businessKey.trim() || undefined,
        variables: parsed.variables,
      })
      setOpen(false)
      setBusinessKey('')
      setVariablesText('{}')
      onStarted(started)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the instance.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded bg-[#0066b2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#003b70]"
      >
        Start New...
      </button>
    )
  }
  return (
    <div className="mt-3 space-y-2 rounded border border-sky-200 bg-sky-50 p-3">
      <select
        value={definitionId}
        onChange={(e) => setDefinitionId(e.target.value)}
        className="w-full rounded border border-sky-200 bg-white px-2 py-1 text-sm"
      >
        {definitions.length === 0 && <option value="">No deployed definitions</option>}
        {definitions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name || d.key} ({d.kind}, v{d.version}){d.appName ? ` -- app: ${d.appName}` : ''}
          </option>
        ))}
      </select>
      <input
        value={businessKey}
        onChange={(e) => setBusinessKey(e.target.value)}
        placeholder="Business key (optional)"
        className="w-full rounded border border-sky-200 bg-white px-2 py-1 text-sm"
      />
      <textarea
        value={variablesText}
        onChange={(e) => setVariablesText(e.target.value)}
        rows={5}
        spellCheck={false}
        className="w-full rounded border border-sky-200 bg-white p-2 font-mono text-xs"
      />
      {'error' in parsed && <p className="text-xs text-red-600">{parsed.error}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !definition || 'error' in parsed}
          onClick={onStart}
          className="rounded bg-[#0066b2] px-3 py-1 text-xs font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
        >
          {busy ? 'Starting...' : 'Start'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  )
}

function InstancePanel({
  kind,
  id,
  role,
  nameOf,
  onChanged,
}: {
  kind: InstanceKind
  id: string
  role: string | null
  nameOf: (id: string | null) => string
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [variablesText, setVariablesText] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await getInstance(kind, id)
      setDetail(d)
      setVariablesText(JSON.stringify(d.variables, null, 2))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the instance.')
    }
  }, [kind, id])

  useEffect(() => {
    load()
  }, [load])

  const parsed = useMemo(() => parseVariables(variablesText), [variablesText])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setEditing(false)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!detail) {
    return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-slate-500">Loading...</p>
  }
  const { instance } = detail
  const running = instance.endTime === null
  const canEdit = running && (role === 'designer' || role === 'tenant_admin')
  // Case workers (not viewers) start manual items and fire user event listeners.
  const canAct = running && role !== 'viewer'

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-[#003b70]">{instance.definitionName || instance.definitionKey}</h2>
        <StateBadge state={instance.state} />
      </div>
      <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-1 text-xs">
        <dt className="font-semibold text-slate-500">Kind</dt>
        <dd>{instance.kind}</dd>
        <dt className="font-semibold text-slate-500">Business key</dt>
        <dd>{instance.businessKey || '--'}</dd>
        <dt className="font-semibold text-slate-500">Started by</dt>
        <dd>{nameOf(instance.startUserId)}</dd>
        <dt className="font-semibold text-slate-500">Started</dt>
        <dd>{instance.startTime && new Date(instance.startTime).toLocaleString()}</dd>
        <dt className="font-semibold text-slate-500">Ended</dt>
        <dd>{instance.endTime ? new Date(instance.endTime).toLocaleString() : '--'}</dd>
        <dt className="font-semibold text-slate-500">Instance id</dt>
        <dd className="font-mono">{instance.id}</dd>
      </dl>

      <BusinessStatusField key={instance.businessStatus ?? ''} detail={detail} canEdit={canAct} onSaved={() => run(async () => undefined)} />

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {detail.openTasks.length > 0 && (
        <>
          <h3 className="mt-5 mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Open tasks</h3>
          <ul className="divide-y divide-sky-100 rounded border border-sky-200 text-sm">
            {detail.openTasks.map((t) => (
              <li key={t.id} className="flex justify-between p-2">
                <span>{t.name}</span>
                <span className="text-xs text-slate-500">{t.assignee ? nameOf(t.assignee) : 'Unassigned'}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {detail.planItems.length > 0 && (
        <>
          <h3 className="mt-5 mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Plan items</h3>
          <table className="w-full rounded border border-sky-200 text-xs">
            <thead className="bg-sky-50 text-left text-slate-500">
              <tr>
                <th className="p-2">Name</th>
                <th className="p-2">Type</th>
                <th className="p-2">State</th>
                {canAct && <th className="p-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100">
              {detail.planItems.map((p) => (
                <tr key={p.id}>
                  <td className={`p-2 ${p.stageInstanceId ? 'pl-6' : ''}`}>{p.name || '--'}</td>
                  <td className="p-2 text-slate-500">{p.type}</td>
                  <td className="p-2">
                    <StateBadge state={p.state} />
                  </td>
                  {canAct && (
                    <td className="space-x-1 p-2 text-right">
                      {p.actions.map((a) => (
                        <button
                          key={a}
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => planItemAction(p.id, a))}
                          className="rounded border border-sky-300 px-2 py-0.5 text-[10px] font-semibold text-[#0066b2] hover:bg-sky-50 disabled:opacity-50"
                        >
                          {ACTION_LABEL[a]}
                        </button>
                      ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {detail.activeActivityIds.length > 0 && (
        <p className="mt-4 text-xs text-slate-600">
          <span className="font-semibold">Active activities:</span>{' '}
          <span className="font-mono">{detail.activeActivityIds.join(', ')}</span>
        </p>
      )}

      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Variables</h3>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-[#0066b2] hover:underline">
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            value={variablesText}
            onChange={(e) => setVariablesText(e.target.value)}
            rows={10}
            spellCheck={false}
            className="mt-1 w-full rounded border border-sky-200 p-2 font-mono text-xs"
          />
          <p className="text-[11px] text-slate-500">Saving sets every key shown here; removing a key does not delete it.</p>
          {'error' in parsed && <p className="text-xs text-red-600">{parsed.error}</p>}
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              disabled={busy || 'error' in parsed}
              onClick={() => 'variables' in parsed && run(() => setInstanceVariables(kind, id, parsed.variables))}
              className="rounded bg-[#0066b2] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:underline">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <pre className="mt-1 max-h-80 overflow-auto rounded border border-sky-200 bg-slate-50 p-3 text-xs">
          {JSON.stringify(detail.variables, null, 2)}
        </pre>
      )}

      <TimelinePanel detail={detail} nameOf={nameOf} />

      {running && canEdit && <AdHocWorkPanel detail={detail} onDone={() => run(async () => undefined)} />}
      {running && role === 'tenant_admin' && <MigrationPanel detail={detail} onDone={() => run(async () => undefined)} />}

      {running && role === 'tenant_admin' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => confirm('Terminate this instance? Open tasks will be cancelled.') && run(() => terminateInstance(kind, id))}
          className="mt-6 rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Terminate
        </button>
      )}
    </div>
  )
}
