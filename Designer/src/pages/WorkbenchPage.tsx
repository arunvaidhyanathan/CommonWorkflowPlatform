// Workbench.html: "what's waiting on me" -- drafts, submissions, pending
// approvals (for approvers), recent activity, global search, and quick
// actions. Deliberately not a second Designer (no canvas) or a second
// Administration (no role management) -- Section 1. Standalone landing
// page, not (yet) a replacement for Designer's list view -- Section 3.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../lib/useSession'
import { getMyWork, type MyWork } from '../data/workbench'
import type { WorkflowSummary } from '../data/workflows'

function WorkflowRow({ wf, onOpen }: { wf: WorkflowSummary; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
      className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-sky-50"
    >
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-slate-800">{wf.name}</div>
        <div className="truncate font-mono text-[10px] text-slate-400">{wf.definitionKey}</div>
      </div>
      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-700">
        {wf.status.replace('_', ' ')}
      </span>
    </div>
  )
}

function WorkCard({
  title,
  emptyLabel,
  items,
  onOpen,
}: {
  title: string
  emptyLabel: string
  items: WorkflowSummary[]
  onOpen: (wf: WorkflowSummary) => void
}) {
  return (
    <div className="rounded-lg border border-sky-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">{title}</h3>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
          {items.length}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {items.length === 0 && <p className="p-1.5 text-xs text-slate-400">{emptyLabel}</p>}
        {items.slice(0, 5).map((wf) => (
          <WorkflowRow key={wf.id} wf={wf} onOpen={() => onOpen(wf)} />
        ))}
      </div>
    </div>
  )
}

export function WorkbenchPage() {
  const { userId, tenantId, role } = useSession()
  const navigate = useNavigate()

  const [work, setWork] = useState<MyWork | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    if (!tenantId || !userId) return
    setLoading(true)
    setError(null)
    try {
      setWork(await getMyWork(tenantId, userId, role))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your work.')
    } finally {
      setLoading(false)
    }
  }, [tenantId, userId, role])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Section 2.5: quick actions deep-link into Designer, which reads
  // ?action= on mount to auto-open the right dialog.
  const openInDesigner = (wf?: WorkflowSummary) => {
    if (wf) {
      // Designer's list view opens workflows by click, not by URL param yet
      // -- simplest correct behavior today is to land on the list so the
      // user can open it themselves; avoids inventing a workflow-id route.
      navigate('/designer')
      return
    }
    navigate('/designer')
  }

  const filtered = useMemo(() => {
    if (!work) return []
    const q = query.trim().toLowerCase()
    if (!q) return work.allWorkflows
    return work.allWorkflows.filter(
      (wf) =>
        wf.name.toLowerCase().includes(q) ||
        wf.definitionKey.toLowerCase().includes(q) ||
        wf.specType.toLowerCase().includes(q) ||
        wf.status.toLowerCase().includes(q),
    )
  }, [work, query])

  if (!tenantId) {
    return <div className="p-6 text-sm text-slate-500">Loading...</div>
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#003b70]">Workbench</h1>
          <p className="text-sm text-slate-500">What&apos;s waiting on you, at a glance.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/designer?action=import')}
            className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => navigate('/designer?action=new')}
            className="rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70]"
          >
            New Workflow
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading...</p>}

      {work && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <WorkCard
              title="My Drafts"
              emptyLabel="No drafts in progress."
              items={work.myDrafts}
              onOpen={openInDesigner}
            />
            <WorkCard
              title="My Submissions"
              emptyLabel="Nothing waiting on an approver."
              items={work.mySubmissions}
              onOpen={openInDesigner}
            />
            {role === 'approver' && (
              <WorkCard
                title="Waiting On Me"
                emptyLabel="Nothing pending your decision."
                items={work.waitingOnMe.map((r) => ({
                  id: r.workflowId,
                  definitionKey: r.definitionKey,
                  name: r.workflowName,
                  description: null,
                  specType: r.specType,
                  status: 'pending_approval',
                  currentVersionId: null,
                  updatedAt: r.requestedAt,
                  createdBy: r.requestedBy,
                }))}
                onOpen={() => navigate('/approvals')}
              />
            )}
            <WorkCard
              title="Recently Edited"
              emptyLabel="Nothing edited yet."
              items={work.recentlyEdited}
              onOpen={openInDesigner}
            />
          </div>

          <div>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
              Search All Workflows
            </h2>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, ID, spec type, or status..."
              className="mb-2 w-full max-w-md rounded border border-sky-200 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
            />
            <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
              {filtered.length === 0 && (
                <p className="p-3 text-sm text-slate-500">No workflows match.</p>
              )}
              {filtered.map((wf) => (
                <div key={wf.id} className="p-1">
                  <WorkflowRow wf={wf} onOpen={() => openInDesigner(wf)} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
