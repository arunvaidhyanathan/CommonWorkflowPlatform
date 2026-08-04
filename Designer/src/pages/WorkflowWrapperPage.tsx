// Workflow Wrapper: the Runtime Gateway's operator-facing surface
// (WorkflowWrapper.html; Workbench.html Section 7.1's Case Instance View
// lives here rather than inside WorkbenchPage.tsx -- this route already
// existed as the reserved home for "the Flowable runtime wrapper's
// operator-facing surface", so the case-instance/deployment visibility
// Workbench.html scoped went here instead of adding a second place to
// look). Read-only: deploy authority (tenant_admin, Governance.html
// Section 11.3) is enforced by Designer's Publish button and the Runtime
// Gateway itself, not here.
//
// Three real, tenant-scoped views as of WorkflowWrapper.html Section 9
// Phase 7/8: Deployments (what's been published), Case Instances (CMMN
// runtime state), and Task History (BPMN historic tasks). Execution
// diagram overlays (Workbench.html Section 7.3) and dynamic form
// rendering (7.2) are NOT here -- 7.3 needs a diagram-state endpoint that
// doesn't exist yet, and 7.2 is blocked on a Flowable Form Engine redesign
// (WorkflowWrapper.html Section 4/10). Both are flagged, not silently
// skipped.
import { useEffect, useState } from 'react'
import { listDeployments, type Deployment } from '../data/deployments'
import { listCaseInstances, type CaseInstance } from '../data/caseInstances'
import { listHistoricTaskInstances, type HistoricTaskInstance } from '../data/historicTasks'
import { RuntimeGatewayNotConfiguredError, RuntimeGatewayError } from '../lib/runtimeGatewayClient'

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'not-configured' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T[] }

function useRuntimeGatewayList<T>(loader: () => Promise<T[]>): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    loader()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof RuntimeGatewayNotConfiguredError) {
          setState({ status: 'not-configured' })
        } else if (err instanceof RuntimeGatewayError) {
          setState({ status: 'error', message: err.message })
        } else {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Load failed.' })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}

function formatDate(iso: string | null): string {
  if (!iso) return '--'
  return new Date(iso).toLocaleString()
}

function SectionShell({
  title,
  subtitle,
  state,
  empty,
  children,
}: {
  title: string
  subtitle: string
  state: LoadState<unknown>
  empty: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-sky-200 bg-white p-4">
      <h2 className="text-sm font-bold text-[#003b70]">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">{subtitle}</p>
      {state.status === 'loading' && <p className="text-sm text-slate-500">Loading...</p>}
      {state.status === 'not-configured' && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-700">
          The Runtime Gateway isn&apos;t configured yet (<code>VITE_RUNTIME_GATEWAY_URL</code> unset). See
          <code className="ml-1">WaaS/Workflow-Wrapper/README.md</code>.
        </p>
      )}
      {state.status === 'error' && <p className="text-xs text-red-600">{state.message}</p>}
      {state.status === 'ready' && (state as { data: unknown[] }).data.length === 0 && (
        <p className="text-xs text-slate-400">{empty}</p>
      )}
      {state.status === 'ready' && (state as { data: unknown[] }).data.length > 0 && children}
    </div>
  )
}

function DeploymentsSection() {
  const state = useRuntimeGatewayList<Deployment>(listDeployments)
  return (
    <SectionShell
      title="Deployments"
      subtitle="Everything published via Designer's Publish button (POST /runtime/deployments)."
      state={state}
      empty="No deployments yet."
    >
      <div className="divide-y divide-sky-100">
        {state.status === 'ready' &&
          state.data.map((d) => (
            <div key={d.id} className="py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{d.name}</span>
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700">
                  {d.status}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {formatDate(d.createdAt)} -- {d.manifest.length} artifact
                {d.manifest.length === 1 ? '' : 's'}
              </div>
              {d.engineDeployments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.engineDeployments.map((ref) => (
                    <span
                      key={ref.engineDeploymentId}
                      className="rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700"
                      title={ref.engineDeploymentId}
                    >
                      {ref.specType}: {ref.engineDeploymentId.slice(0, 8)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </SectionShell>
  )
}

function CaseInstancesSection() {
  const state = useRuntimeGatewayList<CaseInstance>(listCaseInstances)
  return (
    <SectionShell
      title="Case Instances"
      subtitle="Live CMMN runtime state, read directly from the embedded engine (Workbench.html Section 7.1)."
      state={state}
      empty="No case instances running. CMMN cases need to be deployed and started before anything appears here."
    >
      <div className="divide-y divide-sky-100">
        {state.status === 'ready' &&
          state.data.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-semibold text-slate-800">
                  {c.name ?? c.businessKey ?? c.id}
                </div>
                <div className="font-mono text-[11px] text-slate-400">{c.caseDefinitionId}</div>
              </div>
              <div className="text-right">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                  {c.state}
                </span>
                <div className="text-[11px] text-slate-400">{formatDate(c.startTime)}</div>
              </div>
            </div>
          ))}
      </div>
    </SectionShell>
  )
}

function TaskHistorySection() {
  const state = useRuntimeGatewayList<HistoricTaskInstance>(listHistoricTaskInstances)
  return (
    <SectionShell
      title="Task History"
      subtitle="Historic BPMN task instances from the embedded engine (Governance.html Section 11.2). CMMN task history isn't included yet."
      state={state}
      empty="No historic tasks yet."
    >
      <div className="divide-y divide-sky-100">
        {state.status === 'ready' &&
          state.data.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-semibold text-slate-800">{t.name ?? t.id}</div>
                <div className="text-[11px] text-slate-400">
                  {t.assignee ? `Assigned to ${t.assignee}` : 'Unassigned'}
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-400">
                <div>{formatDate(t.startTime)}</div>
                {t.endTime && <div>ended {formatDate(t.endTime)}</div>}
              </div>
            </div>
          ))}
      </div>
    </SectionShell>
  )
}

export function WorkflowWrapperPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-[#003b70]">Workflow Wrapper</h1>
        <p className="text-sm text-slate-500">
          The Runtime Gateway&apos;s operator-facing surface -- deployments, live case instances, and
          task history from the embedded Flowable engine.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <DeploymentsSection />
        <CaseInstancesSection />
        <TaskHistorySection />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Dynamic form rendering and execution diagram overlays (Workbench.html Section 7.2/7.3) aren&apos;t
        built yet -- see WorkflowWrapper.html Section 10 for why.
      </p>
    </div>
  )
}
