// Agentic Designer side panel (AgenticDesigner.html Sections 1, 4a, 4b).
// Generate: a description becomes a new canvas (unsaved; Undo restores).
// Edit: an instruction becomes proposed changes to the current canvas,
// previewed with highlights; Accept keeps them (unsaved), Reject restores
// the canvas exactly as it was. Review: read-only findings (code checks and
// AI judgement); clicking one selects its nodes. Nothing here saves.
import { useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { useWorkbenchStore, type NodeData } from '../store/useWorkbenchStore'
import { applyAutoLayout, needsAutoLayout } from '../adapters/autoLayout'
import {
  editWorkflow,
  generateWorkflow,
  reviewWorkflow,
  type AgentIssue,
  type EditEvent,
  type GenerateEvent,
  type ReviewEvent,
  type ReviewFinding,
} from '../data/agent'
import { ADDED_COLOR, CHANGED_COLOR, describeChanges, mergeProposal, stripHighlights } from '../lib/editPreview'
import { ApiError, ApiNotConfiguredError } from '../lib/apiClient'

const MAX_DESCRIPTION = 4000
const MAX_INSTRUCTION = 2000
const MAX_FOCUS = 500

type Mode = 'generate' | 'edit' | 'review'
type Status = 'idle' | 'running' | 'preview' | 'done' | 'failed'
type Canvas = { nodes: Node<NodeData>[]; edges: Edge[] }

interface Preview {
  before: Canvas & { isDirty: boolean }
  shown: Canvas
  changes: { kind: 'added' | 'changed' | 'removed'; text: string }[]
  preexisting: AgentIssue[]
}

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const canvasHasNodes = useWorkbenchStore((s) => s.nodes.length > 0)
  const [mode, setMode] = useState<Mode>(canvasHasNodes ? 'edit' : 'generate')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState<string[]>([])
  const [issues, setIssues] = useState<AgentIssue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [findings, setFindings] = useState<ReviewFinding[] | null>(null)
  const [aiAvailable, setAiAvailable] = useState(true)
  const [activeFinding, setActiveFinding] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const busy = status === 'running' || status === 'preview'
  const max = mode === 'generate' ? MAX_DESCRIPTION : mode === 'edit' ? MAX_INSTRUCTION : MAX_FOCUS
  const minLength = mode === 'generate' ? 10 : mode === 'edit' ? 5 : 0

  const progress = (e: { type: string; attempt?: number; issues?: AgentIssue[] }) => {
    if (e.type === 'attempt') {
      const first =
        mode === 'generate' ? 'Drafting the workflow...' : mode === 'edit' ? 'Working out the changes...' : 'Reviewing the workflow...'
      setLog((l) => [...l, e.attempt === 1 ? first : `Trying again (attempt ${e.attempt})...`])
    } else if (e.type === 'invalid') {
      setLog((l) => [...l, `Proposal rejected: ${(e.issues ?? []).map((i) => i.code).join(', ')}`])
    }
  }

  const onGenerateEvent = async (event: GenerateEvent) => {
    progress(event)
    if (event.type === 'result') {
      const { nodes, edges } = event.graph
      const laidOut = needsAutoLayout(nodes) ? await applyAutoLayout(nodes, edges) : nodes
      useWorkbenchStore.setState({ nodes: laidOut, edges, selectedNodeId: null, isDirty: true })
      setIssues(event.issues)
      setLog((l) => [...l, 'Workflow placed on the canvas. Review it, then Save Version.'])
      setStatus('done')
    } else if (event.type === 'failed') {
      setIssues(event.issues)
      setError('The model could not produce a valid workflow. Try describing the steps and decisions more concretely.')
      setStatus('failed')
    } else if (event.type === 'error') {
      setError(event.message)
      setStatus('failed')
    }
  }

  const onEditEvent = (event: EditEvent, before: Preview['before']) => {
    progress(event)
    if (event.type === 'result') {
      const shown = mergeProposal(before, event.graph, event.diff)
      useWorkbenchStore.setState({ ...shown, selectedNodeId: null, isDirty: true })
      setPreview({ before, shown, changes: describeChanges(before, event.graph, event.diff), preexisting: event.preexisting })
      setIssues(event.issues)
      setLog((l) => [...l, 'Proposed changes are highlighted on the canvas.'])
      setStatus('preview')
    } else if (event.type === 'failed') {
      setIssues(event.issues)
      setError('The model could not make that change without breaking the workflow. Try a more specific instruction.')
      setStatus('failed')
    } else if (event.type === 'error') {
      setError(event.message)
      setStatus('failed')
    }
  }

  const onReviewEvent = (event: ReviewEvent) => {
    progress(event)
    if (event.type === 'checks') {
      setFindings(event.findings)
      setLog((l) => [...l, `Automated checks: ${event.findings.length} finding(s).`])
    } else if (event.type === 'result') {
      setFindings(event.findings)
      setAiAvailable(event.aiAvailable)
      setLog((l) => [...l, event.aiAvailable ? 'Review complete.' : 'AI review unavailable right now; showing automated checks only.'])
      setStatus('done')
    } else if (event.type === 'error') {
      setError(event.message)
      setStatus('failed')
    }
  }

  /** Select a finding's nodes and flows on the canvas (selection only; the workflow isn't changed). */
  const onFindingClick = (index: number, f: ReviewFinding) => {
    const next = activeFinding === index ? null : index
    setActiveFinding(next)
    const nodeIds = new Set(next === null ? [] : f.nodeIds)
    const edgeIds = new Set(next === null ? [] : f.edgeIds)
    const { nodes, edges } = useWorkbenchStore.getState()
    useWorkbenchStore.setState({
      nodes: nodes.map((n) => ({ ...n, selected: nodeIds.has(n.id) })),
      edges: edges.map((e) => ({ ...e, selected: edgeIds.has(e.id) })),
    })
  }

  const onRun = async () => {
    const state = useWorkbenchStore.getState()
    if (mode === 'generate' && state.nodes.length > 0 &&
        !window.confirm('Replace the current canvas with a generated workflow? Undo restores it.')) {
      return
    }
    setStatus('running')
    setLog([])
    setIssues([])
    setError(null)
    setFindings(null)
    setAiAvailable(true)
    setActiveFinding(null)
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    try {
      if (mode === 'generate') {
        await generateWorkflow(text.trim(), (e) => void onGenerateEvent(e), signal)
      } else if (mode === 'review') {
        await reviewWorkflow({ nodes: state.nodes, edges: state.edges }, text.trim(), onReviewEvent, signal)
      } else {
        const before = { nodes: state.nodes, edges: state.edges, isDirty: state.isDirty }
        await editWorkflow(text.trim(), before, (e) => onEditEvent(e, before), signal)
      }
      // A stream that ends without a final event (e.g. the connection dropped).
      setStatus((s) => (s === 'running' ? 'failed' : s))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle')
        return
      }
      setStatus('failed')
      if (err instanceof ApiNotConfiguredError) setError('The CWP API is not configured (VITE_API_BASE_URL).')
      else if (err instanceof ApiError) setError(err.message)
      else setError(err instanceof Error ? err.message : 'The request failed.')
    }
  }

  const onAccept = () => {
    if (!preview) return
    const { nodes, edges } = useWorkbenchStore.getState()
    useWorkbenchStore.setState({ ...stripHighlights({ nodes, edges }, preview.before), isDirty: true })
    setPreview(null)
    setLog((l) => [...l, 'Changes applied. Review them, then Save Version.'])
    setText('')
    setStatus('done')
  }

  const onReject = () => {
    if (!preview) return
    const { nodes, edges, isDirty } = preview.before
    useWorkbenchStore.setState({ nodes, edges, isDirty, selectedNodeId: null })
    setPreview(null)
    setLog((l) => [...l, 'Changes discarded; the canvas is as it was.'])
    setStatus('idle')
  }

  const trimmed = text.trim().length

  return (
    <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-sky-200 bg-sky-50 p-4">
      <div className="flex items-center justify-between border-b border-sky-200 pb-2">
        <h3 className="text-sm font-bold text-sky-900">Agentic Designer</h3>
        <button type="button" onClick={onClose} disabled={status === 'preview'} className="text-xs text-sky-700 hover:underline disabled:opacity-40">
          Close
        </button>
      </div>

      <div className="flex gap-1" role="tablist">
        {(['generate', 'edit', 'review'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={busy || (m !== 'generate' && !canvasHasNodes)}
            onClick={() => {
              setMode(m)
              setText('')
              setLog([])
              setIssues([])
              setError(null)
              setFindings(null)
              setStatus('idle')
            }}
            title={m !== 'generate' && !canvasHasNodes ? 'The canvas is empty; use Generate' : undefined}
            className={`flex-1 rounded px-2 py-1 text-xs font-semibold disabled:opacity-40 ${mode === m ? 'bg-[#0066b2] text-white' : 'bg-white text-sky-700 hover:bg-sky-100'}`}
          >
            {m === 'generate' ? 'Generate' : m === 'edit' ? 'Edit' : 'Review'}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        {mode === 'generate'
          ? 'Describe the process: its steps, who does each one, and the decisions along the way. The result replaces the canvas; nothing is saved until you click Save Version.'
          : mode === 'edit'
            ? 'Describe a change to this workflow. The proposal is highlighted on the canvas for you to accept or reject; nothing is saved until you click Save Version.'
            : 'Checks this workflow for problems. Automated checks run first; the AI then looks for things they can\'t catch. Optionally say what to focus on. Nothing is changed.'}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, max))}
        rows={mode === 'generate' ? 8 : mode === 'edit' ? 5 : 3}
        disabled={busy}
        placeholder={
          mode === 'generate'
            ? 'Loan application: an underwriter reviews it; amounts over 10,000 need manager approval; then the system disburses the funds.'
            : mode === 'edit'
              ? 'Loans over 50,000 also need a compliance review after the manager approval.'
              : 'Optional: e.g. Is every approval path complete?'
        }
        className="w-full rounded border border-sky-200 bg-white p-2 text-sm text-slate-800"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">
          {trimmed}/{max}
        </span>
        {status === 'running' ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onRun()}
            disabled={busy || trimmed < minLength}
            className="rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
          >
            {mode === 'generate' ? 'Generate' : mode === 'edit' ? 'Propose changes' : 'Review'}
          </button>
        )}
      </div>

      {log.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-600">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {preview && (
        <div className="rounded border border-sky-200 bg-white p-3">
          <h4 className="mb-2 text-xs font-bold text-slate-700">Proposed changes</h4>
          <ul className="mb-3 space-y-1">
            {preview.changes.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-slate-800">
                <span
                  aria-hidden
                  className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                  style={{
                    backgroundColor: c.kind === 'added' ? ADDED_COLOR : c.kind === 'changed' ? CHANGED_COLOR : '#898781',
                    color: c.kind === 'changed' ? '#0b0b0b' : '#ffffff',
                  }}
                >
                  {c.kind === 'added' ? '+' : c.kind === 'changed' ? '~' : '−'}
                </span>
                {c.text}
              </li>
            ))}
          </ul>
          <p className="mb-2 text-[11px] text-slate-500">Outlined on the canvas: green = added, yellow = changed.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onAccept} className="flex-1 rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70]">
              Accept
            </button>
            <button type="button" onClick={onReject} className="flex-1 rounded border border-sky-300 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50">
              Reject
            </button>
          </div>
          {preview.preexisting.length > 0 && (
            <div className="mt-3">
              <h5 className="mb-1 text-[11px] font-bold text-slate-600">Already in this workflow (not caused by this edit)</h5>
              <ul className="space-y-1">
                {preview.preexisting.map((i, idx) => (
                  <li key={idx} className="rounded bg-slate-50 p-1.5 text-[11px] text-slate-600">
                    <span className="font-mono">{i.code}</span> {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {findings && <Findings findings={findings} aiAvailable={aiAvailable} active={activeFinding} onClick={onFindingClick} />}

      {issues.length > 0 && mode !== 'review' && (
        <div>
          <h4 className="mb-1 text-xs font-bold text-slate-700">{status === 'failed' ? 'Problems' : 'Worth checking'}</h4>
          <ul className="space-y-1">
            {issues.map((i, idx) => (
              <li
                key={idx}
                className={`rounded p-1.5 text-xs ${i.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}
              >
                <span className="font-mono">{i.code}</span> {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const GROUPS: { severity: ReviewFinding['severity']; title: string; tone: string }[] = [
  { severity: 'error', title: 'Problems', tone: 'bg-red-50 text-red-800' },
  { severity: 'warning', title: 'Warnings', tone: 'bg-amber-50 text-amber-900' },
  { severity: 'suggestion', title: 'Suggestions', tone: 'bg-white text-slate-700' },
]

function Findings({
  findings,
  aiAvailable,
  active,
  onClick,
}: {
  findings: ReviewFinding[]
  aiAvailable: boolean
  active: number | null
  onClick: (index: number, f: ReviewFinding) => void
}) {
  if (findings.length === 0) {
    return (
      <p className="rounded bg-white p-2 text-xs text-slate-600">
        {aiAvailable ? 'No problems found.' : 'The automated checks found no problems.'}
      </p>
    )
  }
  const indexed = findings.map((f, i) => ({ f, i }))
  return (
    <div className="space-y-3">
      {GROUPS.map((g) => {
        const items = indexed.filter(({ f }) => f.severity === g.severity)
        if (items.length === 0) return null
        return (
          <div key={g.severity}>
            <h4 className="mb-1 text-xs font-bold text-slate-700">
              {g.title} ({items.length})
            </h4>
            <ul className="space-y-1">
              {items.map(({ f, i }) => {
                const pointsAtSomething = f.nodeIds.length + f.edgeIds.length > 0
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => onClick(i, f)}
                      disabled={!pointsAtSomething}
                      title={pointsAtSomething ? 'Select on the canvas' : undefined}
                      className={`w-full rounded border p-1.5 text-left text-xs ${g.tone} ${active === i ? 'border-[#0066b2]' : 'border-transparent'} ${pointsAtSomething ? 'hover:border-sky-300' : 'cursor-default'}`}
                    >
                      <span className="mr-1 rounded bg-slate-200 px-1 text-[10px] font-bold uppercase text-slate-700">
                        {f.source === 'check' ? 'Check' : 'AI'}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">{f.code}</span> {f.message}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
