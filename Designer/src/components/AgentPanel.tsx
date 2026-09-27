// Agentic Designer side panel, Generate mode (AgenticDesigner.html Section 1).
// A description goes to /api/agent/generate; the validated graph replaces the
// canvas as unsaved changes. Undo (zundo) restores the previous canvas.
import { useRef, useState } from 'react'
import { useWorkbenchStore } from '../store/useWorkbenchStore'
import { applyAutoLayout, needsAutoLayout } from '../adapters/autoLayout'
import { generateWorkflow, type AgentIssue, type GenerateEvent } from '../data/agent'
import { ApiError, ApiNotConfiguredError } from '../lib/apiClient'

const MAX_CHARS = 4000

type Status = 'idle' | 'running' | 'done' | 'failed'

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState<string[]>([])
  const [issues, setIssues] = useState<AgentIssue[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const onEvent = async (event: GenerateEvent) => {
    switch (event.type) {
      case 'attempt':
        setLog((l) => [...l, event.attempt === 1 ? 'Drafting the workflow...' : `Fixing problems (attempt ${event.attempt})...`])
        break
      case 'invalid':
        setLog((l) => [...l, `Draft rejected: ${event.issues.map((i) => i.code).join(', ')}`])
        break
      case 'result': {
        const { nodes, edges } = event.graph
        const laidOut = needsAutoLayout(nodes) ? await applyAutoLayout(nodes, edges) : nodes
        useWorkbenchStore.setState({ nodes: laidOut, edges, selectedNodeId: null, isDirty: true })
        setIssues(event.issues)
        setLog((l) => [...l, 'Workflow placed on the canvas. Review it, then Save Version.'])
        setStatus('done')
        break
      }
      case 'failed':
        setIssues(event.issues)
        setError('The model could not produce a valid workflow. Try describing the steps and decisions more concretely.')
        setStatus('failed')
        break
      case 'error':
        setError(event.message)
        setStatus('failed')
        break
    }
  }

  const onGenerate = async () => {
    const { nodes } = useWorkbenchStore.getState()
    if (nodes.length > 0 && !window.confirm('Replace the current canvas with a generated workflow? Undo restores it.')) {
      return
    }
    setStatus('running')
    setLog([])
    setIssues([])
    setError(null)
    abortRef.current = new AbortController()
    try {
      await generateWorkflow(description.trim(), (e) => void onEvent(e), abortRef.current.signal)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle')
        return
      }
      setStatus('failed')
      if (err instanceof ApiNotConfiguredError) setError('The CWP API is not configured (VITE_API_BASE_URL).')
      else if (err instanceof ApiError) setError(err.message)
      else setError(err instanceof Error ? err.message : 'Generation failed.')
    }
  }

  const trimmedLength = description.trim().length

  return (
    <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-sky-200 bg-sky-50 p-4">
      <div className="flex items-center justify-between border-b border-sky-200 pb-2">
        <h3 className="text-sm font-bold text-sky-900">Generate with AI</h3>
        <button type="button" onClick={onClose} className="text-xs text-sky-700 hover:underline">
          Close
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Describe the process: its steps, who does each one, and the decisions along the way. The result
        replaces the canvas as a draft; nothing is saved until you click Save Version.
      </p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, MAX_CHARS))}
        rows={8}
        disabled={status === 'running'}
        placeholder="Loan application: an underwriter reviews it; amounts over 10,000 need manager approval; then the system disburses the funds."
        className="w-full rounded border border-sky-200 bg-white p-2 text-sm text-slate-800"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">
          {trimmedLength}/{MAX_CHARS}
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
            onClick={onGenerate}
            disabled={trimmedLength < 10}
            className="rounded bg-[#0066b2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b70] disabled:opacity-50"
          >
            Generate
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
      {issues.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-bold text-slate-700">
            {status === 'failed' ? 'Problems' : 'Worth checking'}
          </h4>
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
