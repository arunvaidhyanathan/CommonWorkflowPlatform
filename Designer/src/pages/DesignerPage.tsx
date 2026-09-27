// Designer (Developer Workspace) page (Designer.html Section 5): assembles
// the workflow browser, origination paths (new/import/open), palette,
// canvas, and properties panel into the full editor experience across all
// three specs (BPMN process, CMMN case, DMN decision).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '../lib/useSession'
import { useWorkbenchStore, type SpecType } from '../store/useWorkbenchStore'
import { Palette } from '../components/Palette'
import { Canvas } from '../components/Canvas'
import { PropertiesPanel } from '../components/PropertiesPanel'
import { AgentPanel } from '../components/AgentPanel'
import { DmnEditor } from '../components/DmnEditor'
import { GettingStartedPanel } from '../components/GettingStartedPanel'
import {
  WorkflowIdentityDialog,
  type IdentityResult,
} from '../components/WorkflowIdentityDialog'
import {
  listWorkflows,
  createWorkflowFromImport,
  saveDraftVersion,
  loadWorkflowVersion,
  type WorkflowSummary,
  type GraphSnapshot,
} from '../data/workflows'
import { getMyProfile } from '../data/profile'
import { parseBpmnXml, serializeToBpmnXml } from '../adapters/bpmnAdapter'
import { parseCmmnXml, serializeToCmmnXml } from '../adapters/cmmnAdapter'
import { parseDmnXml, serializeDmnXml, createEmptyDecision } from '../adapters/dmnAdapter'
import { detectSpecType } from '../adapters/detectSpecType'
import { applyAutoLayout, needsAutoLayout } from '../adapters/autoLayout'
import { downloadTextFile, exportFileName } from '../lib/download'
import { submitForApproval } from '../data/approvals'
import { createDeployment } from '../data/deployments'
import { ApiNotConfiguredError, ApiError, isApiConfigured } from '../lib/apiClient'

type ViewMode = 'list' | 'editor'

const IMPORT_ACCEPT = '.bpmn,.xml,.bpmn20.xml,.dmn,.cmmn,.cmmn11'

// Onboarding.html Section 2.4: the two sample files already sitting in
// Designer/samples/ (copied into public/samples/ so they're fetchable at
// runtime), offered as one-click starter imports from empty states.
const SAMPLE_FILES = [
  {
    path: '/samples/investigation-case.cmmn',
    label: 'Ethics Investigation Case (CMMN)',
  },
  {
    path: '/samples/investigation-decisions.dmn',
    label: 'Investigation Decisions (DMN)',
  },
] as const

export function DesignerPage() {
  const { userId, tenantId, role, loading: sessionLoading } = useSession()

  const [view, setView] = useState<ViewMode>('list')
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'import'>('create')
  const [pendingImport, setPendingImport] = useState<{
    graph: GraphSnapshot
    xml: string
    identity: Partial<IdentityResult>
  } | null>(null)

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [exportingRowId, setExportingRowId] = useState<string | null>(null)
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [publishStatus, setPublishStatus] = useState<'idle' | 'publishing' | 'published' | 'error'>(
    'idle',
  )
  const [publishError, setPublishError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // Onboarding.html Section 3.2: null while unknown, an ISO timestamp once
  // dismissed, so the Getting Started panel doesn't flash on then off.
  const [onboardingDismissedAt, setOnboardingDismissedAt] = useState<string | null | undefined>(
    undefined,
  )

  const store = useWorkbenchStore
  const {
    nodes,
    edges,
    workflowId,
    definitionKey,
    workflowName,
    activeSpec,
    isDirty,
    draftVersionId,
    dmnModel,
    activeDecisionId,
    resetWorkspace,
    setGraph,
    setWorkflowIdentity,
    setActiveSpec,
    setDmnModel,
    selectDecision,
    updateDecision,
    addDecision,
    removeDecision,
  } = useWorkbenchStore()

  // Governance.html Section 3.2: role values are now designer / tenant_admin
  // / approver / viewer -- tenant_admin renamed from the old flat 'admin'.
  const canWrite = role === 'designer' || role === 'tenant_admin'

  // Governance.html Section 11.3 (provisional, built as of WorkflowWrapper.html
  // Section 9 Phase 4): deploy authority is folded into tenant_admin -- a
  // coarse role gate, not yet "the author of this version can't also
  // deploy it." Mirrored client-side purely so the button doesn't invite a
  // 403; the Runtime Gateway enforces this for real.
  const canDeploy = role === 'tenant_admin'
  // Agentic Designer Generate and Edit modes (AgenticDesigner.html): BPMN only until A4.
  const [showAgent, setShowAgent] = useState(false)

  const refreshList = useCallback(async () => {
    if (!tenantId) return
    setListLoading(true)
    setListError(null)
    try {
      setWorkflows(await listWorkflows(tenantId))
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load workflows.')
    } finally {
      setListLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (view === 'list' && tenantId) {
      refreshList()
    }
  }, [view, tenantId, refreshList])

  // Onboarding.html Section 3.2: fetch the Getting Started dismissal flag
  // once we know who's signed in.
  useEffect(() => {
    if (!userId) return
    getMyProfile(userId)
      .then((profile) => setOnboardingDismissedAt(profile?.onboardingDismissedAt ?? null))
      .catch(() => setOnboardingDismissedAt(null))
  }, [userId])

  const openNewDialog = () => {
    setDialogMode('create')
    setPendingImport(null)
    setDialogOpen(true)
  }

  /** Shared by file-picker import and one-click sample import (Onboarding.html 2.4). */
  const handleImportedXml = async (xml: string, sourceName: string) => {
    const specType = detectSpecType(sourceName, xml)

    if (specType === 'DMN') {
      const model = await parseDmnXml(xml)
      setPendingImport({
        graph: { nodes: [], edges: [], dmnModel: model },
        xml,
        identity: {
          definitionKey: model.definitionsId,
          name: model.definitionsName || sourceName,
          specType: 'DMN',
        },
      })
    } else if (specType === 'CMMN') {
      const parsed = await parseCmmnXml(xml)
      const laidOutNodes = needsAutoLayout(parsed.nodes)
        ? await applyAutoLayout(parsed.nodes, parsed.edges)
        : parsed.nodes
      setPendingImport({
        graph: { nodes: laidOutNodes, edges: parsed.edges },
        xml,
        identity: {
          definitionKey: parsed.caseId,
          name: parsed.caseName || sourceName,
          specType: 'CMMN',
        },
      })
    } else {
      const parsed = await parseBpmnXml(xml)
      const laidOutNodes = needsAutoLayout(parsed.nodes)
        ? await applyAutoLayout(parsed.nodes, parsed.edges)
        : parsed.nodes
      setPendingImport({
        graph: { nodes: laidOutNodes, edges: parsed.edges },
        xml,
        identity: {
          definitionKey: parsed.processId,
          name: parsed.processName || sourceName,
          specType: 'BPMN',
        },
      })
    }

    setDialogMode('import')
    setDialogOpen(true)
  }

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    try {
      const xml = await file.text()
      await handleImportedXml(xml, file.name)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not parse the imported file.')
    }
  }

  const onImportSample = async (path: string, label: string) => {
    try {
      const res = await fetch(path)
      if (!res.ok) throw new Error(`Could not load sample file (${res.status}).`)
      const xml = await res.text()
      await handleImportedXml(xml, label)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load the sample file.')
    }
  }

  // Workbench.html Section 2.5: quick actions deep-link here via ?action=.
  useEffect(() => {
    const action = searchParams.get('action')
    if (!action || view !== 'list' || !canWrite) return

    if (action === 'new') {
      openNewDialog()
    } else if (action === 'import') {
      fileInputRef.current?.click()
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('action')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, view, canWrite])

  const onIdentityConfirmed = async (identity: IdentityResult) => {
    if (!tenantId || !userId) return
    setDialogOpen(false)

    try {
      let graph: GraphSnapshot
      let xmlContent: string

      if (dialogMode === 'create') {
        if (identity.specType === 'DMN') {
          const model = {
            definitionsId: identity.definitionKey,
            definitionsName: identity.name,
            namespace: 'http://waas.citi.com/dmn',
            decisions: [createEmptyDecision(identity.name || 'Decision 1')],
          }
          xmlContent = await serializeDmnXml(model)
          graph = { nodes: [], edges: [], dmnModel: model }
        } else {
          graph = { nodes: [], edges: [] }
          xmlContent = ''
        }
      } else if (pendingImport) {
        graph = pendingImport.graph
        xmlContent = pendingImport.xml
      } else {
        return
      }

      const { workflowId: newId, versionId } = await createWorkflowFromImport({
        tenantId,
        definitionKey: identity.definitionKey,
        name: identity.name,
        description: identity.description,
        specType: identity.specType,
        graph,
        xmlContent,
        createdBy: userId,
      })

      resetWorkspace()
      setActiveSpec(identity.specType)
      setWorkflowIdentity({
        workflowId: newId,
        definitionKey: identity.definitionKey,
        workflowName: identity.name,
        workflowDescription: identity.description,
        tenantId,
      })

      if (identity.specType === 'DMN') {
        setDmnModel(graph.dmnModel ?? null)
      } else {
        setGraph(graph.nodes, graph.edges)
      }

      store.setState({ draftVersionId: versionId })
      setWorkflowStatus('draft')
      setView('editor')
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not create the workflow.')
    }
  }

  const openWorkflow = async (workflow: WorkflowSummary) => {
    if (!workflow.currentVersionId || !tenantId) return
    try {
      const version = await loadWorkflowVersion(workflow.currentVersionId)
      const specType = (workflow.specType as SpecType) || 'BPMN'

      resetWorkspace()
      setActiveSpec(specType)
      setWorkflowIdentity({
        workflowId: workflow.id,
        definitionKey: workflow.definitionKey,
        workflowName: workflow.name,
        workflowDescription: workflow.description ?? '',
        tenantId,
      })

      if (specType === 'DMN') {
        setDmnModel(version.graph.dmnModel ?? null)
      } else {
        setGraph(version.graph.nodes, version.graph.edges)
      }

      store.setState({ draftVersionId: workflow.currentVersionId })
      setWorkflowStatus(workflow.status)
      setView('editor')
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not open the workflow.')
    }
  }

  const onSubmitForApproval = async () => {
    if (!workflowId || !userId || !tenantId || !draftVersionId) return
    setSubmitStatus('submitting')
    setSaveError(null)
    try {
      await submitForApproval({
        tenantId,
        workflowId,
        versionId: draftVersionId,
        requestedBy: userId,
      })
      setWorkflowStatus('pending_approval')
      setSubmitStatus('idle')
    } catch (err) {
      setSubmitStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Could not submit for approval.')
    }
  }

  /**
   * WorkflowWrapper.html Section 9 Phase 2 / Designer.html Section 23.3:
   * one-click Publish. Packages the workflow's last-saved artifact into a
   * single-artifact manifest (Section 23.1's ".bar-shaped packaging" --
   * today a lone artifact, since workflows don't yet model cross-artifact
   * relationships; the manifest shape supports bundling more later without
   * an API change) and calls the Runtime Gateway. Only available once a
   * version has been approved (Section 4's design-time approval gate) and
   * only to accounts with deploy authority (canDeploy).
   */
  const onPublish = async () => {
    if (!workflowId || !draftVersionId) return
    setPublishStatus('publishing')
    setPublishError(null)
    try {
      const { xml } = await serializeCurrent()
      const deployment = await createDeployment({
        name: workflowName || definitionKey,
        specType: activeSpec,
        description: `Published from Designer -- ${definitionKey} v(current)`,
        manifest: [
          {
            definitionKey,
            name: workflowName || definitionKey,
            specType: activeSpec,
            xml,
          },
        ],
      })
      setPublishStatus('published')
      setTimeout(() => setPublishStatus('idle'), 3000)
      // eslint-disable-next-line no-console
      console.info('Workflow runtime deployment created:', deployment.id)
    } catch (err) {
      setPublishStatus('error')
      if (err instanceof ApiNotConfiguredError) {
        setPublishError(
          'Publish is not available -- the CWP API is not configured (VITE_API_BASE_URL unset). Run `docker compose up` at the repo root; see README.md.',
        )
      } else if (err instanceof ApiError) {
        setPublishError(err.message)
      } else {
        setPublishError(err instanceof Error ? err.message : 'Publish failed.')
      }
    }
  }

  /** Shared with onSaveVersion: serializes the in-memory model for the active spec. */
  const serializeCurrent = async (): Promise<{ xml: string; graph: GraphSnapshot }> => {
    if (activeSpec === 'DMN') {
      if (!dmnModel) throw new Error('No decision model to export.')
      return { xml: await serializeDmnXml(dmnModel), graph: { nodes: [], edges: [], dmnModel } }
    }
    if (activeSpec === 'CMMN') {
      return {
        xml: await serializeToCmmnXml(nodes, edges, definitionKey, workflowName),
        graph: { nodes, edges },
      }
    }
    return {
      xml: await serializeToBpmnXml(nodes, edges, definitionKey, workflowName),
      graph: { nodes, edges },
    }
  }

  /** Export path (Section 5.2): download the current in-memory model without saving a version. */
  const onExportCurrent = async () => {
    try {
      const { xml } = await serializeCurrent()
      downloadTextFile(exportFileName(definitionKey, activeSpec), xml)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  /** Export path from the workflow list: download the last saved version without opening the editor. */
  const onExportRow = async (wf: WorkflowSummary, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!wf.currentVersionId) return
    setExportingRowId(wf.id)
    try {
      const version = await loadWorkflowVersion(wf.currentVersionId)
      downloadTextFile(
        exportFileName(wf.definitionKey, wf.specType as SpecType),
        version.xmlContent,
      )
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not export the workflow.')
    } finally {
      setExportingRowId(null)
    }
  }

  const onTidyUp = async () => {
    if (activeSpec === 'DMN') return
    const laidOut = await applyAutoLayout(nodes, edges)
    store.setState({ nodes: laidOut, isDirty: true })
  }

  const onSaveVersion = async () => {
    if (!workflowId || !userId) return
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const { xml, graph } = await serializeCurrent()

      const { versionId } = await saveDraftVersion({
        workflowId,
        graph,
        xmlContent: xml,
        createdBy: userId,
      })
      store.getState().markSaved(versionId)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    }
  }

  if (sessionLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading session...</div>
  }

  if (!tenantId || !role) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-slate-600">
        <h1 className="mb-2 text-base font-bold text-[#003b70]">Workspace Not Provisioned</h1>
        <p>
          Your account is signed in but has no tenant/role assigned yet
          (<code className="rounded bg-sky-50 px-1">app_metadata.tenant_id</code> /{' '}
          <code className="rounded bg-sky-50 px-1">app_metadata.role</code>). Ask a tenant
          administrator to provision your workspace.
        </p>
      </div>
    )
  }

  if (view === 'list') {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-[#003b70]">Workflows</h1>
          {canWrite && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50"
              >
                Import (BPMN / CMMN / DMN)
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMPORT_ACCEPT}
                className="hidden"
                onChange={onFileSelected}
              />
              <button
                type="button"
                onClick={openNewDialog}
                className="rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70]"
              >
                New Workflow
              </button>
            </div>
          )}
        </div>

        {userId && onboardingDismissedAt === null && (
          <GettingStartedPanel
            userId={userId}
            role={role}
            hasWorkflows={workflows.length > 0}
            onDismissed={() => setOnboardingDismissedAt(new Date().toISOString())}
            onImportSample={() => onImportSample(SAMPLE_FILES[0].path, SAMPLE_FILES[0].label)}
          />
        )}

        {listError && <p className="mb-3 text-sm text-red-600">{listError}</p>}
        {listLoading && <p className="text-sm text-slate-500">Loading...</p>}

        <div className="divide-y divide-sky-100 rounded-lg border border-sky-200 bg-white">
          {workflows.length === 0 && !listLoading && (
            <div className="p-4">
              <p className="mb-3 text-sm text-slate-500">
                No workflows yet. Create one or import an existing BPMN, CMMN, or DMN file.
              </p>
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs text-slate-400">
                    Don&apos;t know where to start? Import a sample:
                  </span>
                  {SAMPLE_FILES.map((sample) => (
                    <button
                      key={sample.path}
                      type="button"
                      onClick={() => onImportSample(sample.path, sample.label)}
                      className="rounded border border-sky-300 bg-white px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                    >
                      {sample.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {workflows.map((wf) => (
            <div
              key={wf.id}
              role="button"
              tabIndex={0}
              onClick={() => openWorkflow(wf)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openWorkflow(wf)
              }}
              className="flex w-full cursor-pointer items-center justify-between p-3 text-left hover:bg-sky-50"
            >
              <div>
                <div className="text-sm font-semibold text-slate-800">{wf.name}</div>
                <div className="font-mono text-xs text-slate-500">{wf.definitionKey}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                  {wf.specType}
                </span>
                <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700">
                  {wf.status}
                </span>
                <button
                  type="button"
                  onClick={(e) => onExportRow(wf, e)}
                  disabled={!wf.currentVersionId || exportingRowId === wf.id}
                  title="Download this workflow's saved XML"
                  className="rounded border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                >
                  {exportingRowId === wf.id ? '...' : 'Export'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <WorkflowIdentityDialog
          open={dialogOpen}
          tenantId={tenantId}
          mode={dialogMode}
          initial={pendingImport?.identity}
          onCancel={() => setDialogOpen(false)}
          onConfirm={onIdentityConfirmed}
        />
      </div>
    )
  }

  const activeDecision = dmnModel?.decisions.find((d) => d.id === activeDecisionId) ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-sky-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView('list')}
            className="text-sm text-sky-700 hover:underline"
          >
            &larr; Workflows
          </button>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
            {activeSpec}
          </span>
          {workflowStatus && (
            <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700">
              {workflowStatus.replace('_', ' ')}
            </span>
          )}
          <div>
            <div className="text-sm font-semibold text-slate-800">{workflowName}</div>
            <div className="font-mono text-[11px] text-slate-500">{definitionKey}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          {saveStatus === 'saved' && <span className="text-xs text-emerald-600">Saved</span>}
          {saveError && <span className="text-xs text-red-600">{saveError}</span>}
          {activeSpec === 'BPMN' && canWrite && isApiConfigured() && (
            <button
              type="button"
              onClick={() => setShowAgent((v) => !v)}
              title="Generate a workflow from a description, or change this one by describing the change (Agentic Designer)"
              className="rounded border border-indigo-300 bg-white px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50"
            >
              AI Designer
            </button>
          )}
          {activeSpec !== 'DMN' && (
            <button
              type="button"
              onClick={onTidyUp}
              title="Re-layout the canvas with elkjs"
              className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50"
            >
              Tidy Up
            </button>
          )}
          <button
            type="button"
            onClick={onExportCurrent}
            title="Download the current model as .bpmn / .cmmn / .dmn for version control"
            className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50"
          >
            Export
          </button>
          <button
            type="button"
            onClick={onSaveVersion}
            disabled={!canWrite || saveStatus === 'saving'}
            className="rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save Version'}
          </button>
          {workflowStatus === 'draft' && (
            <button
              type="button"
              onClick={onSubmitForApproval}
              disabled={!canWrite || !draftVersionId || submitStatus === 'submitting'}
              title="Send the last saved version to an approver for design-time approval"
              className="rounded border border-emerald-400 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              {submitStatus === 'submitting' ? 'Submitting...' : 'Submit for Approval'}
            </button>
          )}
          {workflowStatus === 'approved' && canDeploy && (
            <button
              type="button"
              onClick={onPublish}
              disabled={!draftVersionId || publishStatus === 'publishing'}
              title="Package this approved version and deploy it via the Runtime Gateway (WorkflowWrapper.html)"
              className="rounded bg-[#003b70] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#00294f] disabled:opacity-50"
            >
              {publishStatus === 'publishing' ? 'Publishing...' : 'Publish'}
            </button>
          )}
          {workflowStatus === 'approved' && !canDeploy && (
            <span
              className="text-xs text-slate-400"
              title="Publishing requires deploy authority (tenant_admin), Governance.html Section 11.3"
            >
              Approved -- awaiting publish by a tenant admin
            </span>
          )}
        </div>
      </div>
      {publishStatus === 'published' && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700">
          Deployment created via the Runtime Gateway.
        </div>
      )}
      {publishStatus === 'error' && publishError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-700">
          {publishError}
        </div>
      )}

      {activeSpec === 'DMN' ? (
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-56 shrink-0 overflow-y-auto border-r border-sky-200 bg-sky-50 p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-sky-900">
                Decisions
              </h2>
              <button
                type="button"
                onClick={() => addDecision(`Decision ${(dmnModel?.decisions.length ?? 0) + 1}`)}
                className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-sky-700"
              >
                + Add
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {dmnModel?.decisions.map((d) => (
                <div key={d.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => selectDecision(d.id)}
                    className={`flex-1 truncate rounded border px-2 py-1.5 text-left text-xs ${
                      d.id === activeDecisionId
                        ? 'border-sky-500 bg-sky-100 font-semibold text-sky-900'
                        : 'border-sky-200 bg-white text-slate-700 hover:bg-sky-50'
                    }`}
                  >
                    {d.name || d.id}
                  </button>
                  {(dmnModel?.decisions.length ?? 0) > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDecision(d.id)}
                      className="text-[10px] text-red-500 hover:underline"
                      title="Remove decision"
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>
          {activeDecision ? (
            <DmnEditor
              decision={activeDecision}
              onChange={(updated) => updateDecision(updated.id, updated)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              No decision selected.
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <Palette
            onPlace={(type) => {
              useWorkbenchStore.getState().addNode({
                id: `${type}_${Date.now()}`,
                type,
                position: { x: 240, y: 240 },
                data: { label: type },
              })
            }}
          />
          <Canvas />
          {showAgent && activeSpec === 'BPMN' ? (
            <AgentPanel onClose={() => setShowAgent(false)} />
          ) : (
            <PropertiesPanel />
          )}
        </div>
      )}
    </div>
  )
}
