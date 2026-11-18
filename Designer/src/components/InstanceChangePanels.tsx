// Changes to a running instance, shown in Running Work's instance panel:
//  - MigrationPanel (tenant admins): move this instance, or every running
//    instance of its version (as an asynchronous batch), to another version.
//    Validate first; the server refuses a migration that doesn't validate.
//  - AdHocWorkPanel (designers, tenant admins): add a one-off user task to a
//    process, or another instance of an existing plan item to a case.
import { useEffect, useState } from 'react'
import { useSession } from '../lib/useSession'
import { listTenantMembers, type TenantMember } from '../data/admin'
import {
  getBatch,
  injectPlanItem,
  injectTask,
  listVersions,
  migrateInstances,
  startBatchMigration,
  validateMigration,
  type BatchStatus,
  type InstanceDetail,
  type MigrationRequest,
  type ValidationReport,
  type VersionSummary,
} from '../data/work'

const box = 'mt-5 rounded-lg border border-sky-200 p-4'
const heading = 'mb-2 text-xs font-bold uppercase tracking-wide text-slate-500'
const button =
  'rounded border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-[#0066b2] hover:bg-sky-50 disabled:opacity-50'

/** "from=to" lines -> activity mappings; blank lines ignored. */
function parseMappings(text: string) {
  return text
    .split('\n')
    .map((line) => line.split('=').map((p) => p.trim()))
    .filter(([from, to]) => from && to)
    .map(([from, to]) => ({ from, to }))
}

export function MigrationPanel({ detail, onDone }: { detail: InstanceDetail; onDone: () => void }) {
  const { instance } = detail
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [target, setTarget] = useState<number | null>(null)
  const [mappingsText, setMappingsText] = useState('')
  const [autoCreate, setAutoCreate] = useState(false)
  const [report, setReport] = useState<ValidationReport | null>(null)
  const [batch, setBatch] = useState<BatchStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listVersions(instance.kind, instance.definitionKey)
      .then((list) => {
        setVersions(list)
        setTarget(list[0]?.version ?? null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load versions.'))
  }, [instance.kind, instance.definitionKey])

  // Poll a running batch until every part has finished.
  useEffect(() => {
    if (!batch || batch.completeTime) return
    const timer = setTimeout(() => {
      getBatch(batch.kind, batch.id).then(setBatch).catch(() => undefined)
    }, 1500)
    return () => clearTimeout(timer)
  }, [batch])

  const request = (scope: 'this' | 'version'): MigrationRequest | null => {
    if (target === null) return null
    return {
      kind: instance.kind,
      ...(scope === 'this' ? { instanceIds: [instance.id] } : { sourceDefinitionId: instance.definitionId }),
      targetKey: instance.definitionKey,
      targetVersion: target,
      ...(instance.kind === 'process' ? { activityMappings: parseMappings(mappingsText) } : { autoCreateNewPlanItems: autoCreate }),
    }
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action failed.')
    } finally {
      setBusy(false)
    }
  }

  const currentVersion = versions.find((v) => v.definitionId === instance.definitionId)

  return (
    <div className={box}>
      <h3 className={heading}>Migrate to another version</h3>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label>
          Target version{' '}
          <select
            value={target ?? ''}
            onChange={(e) => {
              setTarget(Number(e.target.value))
              setReport(null)
            }}
            className="rounded border border-sky-200 px-1.5 py-0.5"
          >
            {versions.map((v) => (
              <option key={v.definitionId} value={v.version}>
                v{v.version} ({v.runningInstances} running)
              </option>
            ))}
          </select>
        </label>
        {instance.kind === 'case' && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} />
            Create plan items that only exist in the target version
          </label>
        )}
      </div>
      {instance.kind === 'process' && (
        <label className="mt-2 block text-[11px] text-slate-500">
          Activity mappings, one per line as <span className="font-mono">oldActivityId=newActivityId</span> (only for
          renamed or moved activities)
          <textarea
            value={mappingsText}
            onChange={(e) => {
              setMappingsText(e.target.value)
              setReport(null)
            }}
            rows={2}
            spellCheck={false}
            className="mt-1 w-full rounded border border-sky-200 p-1.5 font-mono text-xs"
          />
        </label>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || target === null}
          onClick={() => run(async () => { const r = request('this'); if (r) setReport(await validateMigration(r)) })}>
          Validate
        </button>
        <button type="button" className={button} disabled={busy || !report?.valid}
          onClick={() => run(async () => { const r = request('this'); if (r) { await migrateInstances(r); onDone() } })}>
          Migrate this instance
        </button>
        {currentVersion && currentVersion.runningInstances > 1 && (
          <button type="button" className={button} disabled={busy || target === null}
            title="Moves every running instance of the version this instance is on, in the background"
            onClick={() => run(async () => {
              const r = request('version')
              if (r && confirm('Migrate every running instance of this version in the background?')) setBatch(await startBatchMigration(r))
            })}>
            Migrate all {currentVersion.runningInstances} on v{currentVersion.version} (batch)
          </button>
        )}
      </div>
      {report && (
        <div className={`mt-2 rounded p-2 text-xs ${report.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {report.valid ? 'Valid: ready to migrate.' : report.instances.flatMap((i) => i.messages).map((m) => <div key={m}>{m}</div>)}
        </div>
      )}
      {batch && (
        <p className="mt-2 text-xs text-slate-600">
          Batch {batch.id.slice(0, 8)}: <strong>{batch.status}</strong>{' '}
          {Object.entries(batch.partsByStatus).map(([s, n]) => `${n} ${s}`).join(', ')}
          {batch.completeTime && ' -- refresh the list to see the moved instances.'}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function AdHocWorkPanel({ detail, onDone }: { detail: InstanceDetail; onDone: () => void }) {
  const { instance, planItems } = detail
  const { tenantId } = useSession()
  const [members, setMembers] = useState<TenantMember[]>([])
  const [name, setName] = useState('')
  const [assignee, setAssignee] = useState('')
  const [elementId, setElementId] = useState('')
  const [stageId, setStageId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (instance.kind !== 'process' || !tenantId) return
    listTenantMembers(tenantId)
      .then((list) => setMembers(list.filter((m) => m.status === 'active')))
      .catch(() => setMembers([]))
  }, [instance.kind, tenantId])

  // One entry per definition element (several instances of a repeated item share one).
  const elements = [...new Map(planItems.filter((p) => p.type !== 'stage').map((p) => [p.elementId, p])).values()]
  const activeStages = planItems.filter((p) => p.type === 'stage' && p.state === 'active')

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (instance.kind === 'process') await injectTask(instance.id, name.trim(), assignee)
      else await injectPlanItem(instance.id, elementId, name.trim(), stageId || undefined)
      setName('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the work.')
    } finally {
      setBusy(false)
    }
  }

  const ready = instance.kind === 'process' ? name.trim() && assignee : elementId

  return (
    <div className={box}>
      <h3 className={heading}>Add ad-hoc work</h3>
      <p className="mb-2 text-[11px] text-slate-500">
        {instance.kind === 'process'
          ? 'Adds a one-off user task to this instance only, alongside the current work.'
          : 'Adds another instance of a plan item from this case definition. It keeps its entry criteria, so a gated item waits like the original.'}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={instance.kind === 'process' ? 'Task name' : 'Name (optional)'}
          className="w-48 rounded border border-sky-200 px-1.5 py-1" />
        {instance.kind === 'process' ? (
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded border border-sky-200 px-1.5 py-1">
            <option value="">Assign to...</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.email || m.displayName || m.id}</option>
            ))}
          </select>
        ) : (
          <>
            <select value={elementId} onChange={(e) => setElementId(e.target.value)} className="rounded border border-sky-200 px-1.5 py-1">
              <option value="">Plan item...</option>
              {elements.map((p) => (
                <option key={p.elementId} value={p.elementId}>{p.name || p.elementId} ({p.type})</option>
              ))}
            </select>
            <select value={stageId} onChange={(e) => setStageId(e.target.value)} className="rounded border border-sky-200 px-1.5 py-1">
              <option value="">In the case</option>
              {activeStages.map((s) => (
                <option key={s.id} value={s.id}>In stage: {s.name}</option>
              ))}
            </select>
          </>
        )}
        <button type="button" className={button} disabled={busy || !ready} onClick={submit}>
          {busy ? 'Adding...' : 'Add'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
