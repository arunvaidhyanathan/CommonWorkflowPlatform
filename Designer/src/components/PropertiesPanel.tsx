// Dynamic Node Properties Panel (Designer.html Section 11), extended with
// the fields relevant to each element type.
import { useWorkbenchStore } from '../store/useWorkbenchStore'

const TASK_TYPES = new Set(['userTask', 'serviceTask', 'businessRuleTask', 'callActivity'])

export function PropertiesPanel() {
  const { selectedNodeId, nodes, updateNodeData } = useWorkbenchStore()
  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  if (!selectedNode) {
    return (
      <div className="w-80 shrink-0 border-l border-sky-200 bg-sky-50 p-4 text-xs text-slate-500">
        Select an element on the canvas to configure properties.
      </div>
    )
  }

  const isTask = TASK_TYPES.has(selectedNode.type ?? '')
  const isUserTask = selectedNode.type === 'userTask'
  const isServiceTask = selectedNode.type === 'serviceTask'
  const isGateway = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway'].includes(
    selectedNode.type ?? '',
  )
  const isCmmnHumanTask = selectedNode.type === 'cmmnHumanTask'
  const isCmmnStage = selectedNode.type === 'cmmnStage'
  const isCmmnSentry = selectedNode.type === 'cmmnSentry'

  return (
    <div className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-sky-200 bg-sky-50 p-4">
      <h3 className="border-b border-sky-200 pb-2 text-sm font-bold text-sky-900">
        Element Properties
      </h3>

      <Field label="Element ID">
        <input
          disabled
          value={selectedNode.id}
          className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-500"
        />
      </Field>

      <Field label="Type">
        <input
          disabled
          value={selectedNode.type ?? ''}
          className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-500"
        />
      </Field>

      <Field label="Documentation">
        <textarea
          value={selectedNode.data.documentation ?? ''}
          onChange={(e) =>
            updateNodeData(selectedNode.id, { documentation: e.target.value })
          }
          rows={3}
          className="w-full rounded border border-sky-200 bg-white p-1.5 text-xs text-slate-800 outline-none focus:border-sky-500"
        />
      </Field>

      {isUserTask && (
        <>
          <Field label="Assignee Expression">
            <input
              type="text"
              value={selectedNode.data.assignee ?? ''}
              placeholder="${initiator}"
              onChange={(e) => updateNodeData(selectedNode.id, { assignee: e.target.value })}
              className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
            />
          </Field>
          <Field label="Candidate Groups (comma-separated)">
            <input
              type="text"
              value={selectedNode.data.candidateGroups?.join(', ') ?? ''}
              placeholder="approvers, finance"
              onChange={(e) =>
                updateNodeData(selectedNode.id, {
                  candidateGroups: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
            />
          </Field>
          <Field label="Form Key">
            <input
              type="text"
              value={selectedNode.data.formKey ?? ''}
              placeholder="approval_form_v1"
              onChange={(e) => updateNodeData(selectedNode.id, { formKey: e.target.value })}
              className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
            />
          </Field>
        </>
      )}

      {isServiceTask && (
        <Field label="Delegate Expression">
          <input
            type="text"
            value={selectedNode.data.delegateExpression ?? ''}
            placeholder="${mySpringBean}"
            onChange={(e) =>
              updateNodeData(selectedNode.id, { delegateExpression: e.target.value })
            }
            className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
          />
        </Field>
      )}

      {isTask && !isUserTask && !isServiceTask && (
        <p className="text-[11px] text-slate-500">
          No spec-specific fields for this activity type yet.
        </p>
      )}

      {isGateway && (
        <p className="text-[11px] text-slate-500">
          Set flow conditions on outgoing sequence flows by selecting the edge.
        </p>
      )}

      {isCmmnHumanTask && (
        <>
          <Field label="Performer Ref">
            <input
              type="text"
              value={(selectedNode.data.performerRef as string) ?? ''}
              placeholder="case_analyst_role"
              onChange={(e) => updateNodeData(selectedNode.id, { performerRef: e.target.value })}
              className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
            />
          </Field>
          <Field label="Blocking">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(selectedNode.data.isBlocking ?? true)}
                onChange={(e) => updateNodeData(selectedNode.id, { isBlocking: e.target.checked })}
              />
              Stage waits for this task to complete
            </label>
          </Field>
        </>
      )}

      {isCmmnStage && (
        <p className="text-[11px] text-slate-500">
          Stages are opaque in v1 — contents are not individually editable yet.
        </p>
      )}

      {isCmmnSentry && (
        <Field label="If-Part Condition (FEEL/expression)">
          <input
            type="text"
            value={selectedNode.data.conditionExpression ?? ''}
            placeholder="${outcome == 'approved'}"
            onChange={(e) =>
              updateNodeData(selectedNode.id, { conditionExpression: e.target.value })
            }
            className="w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
          />
        </Field>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase text-slate-500">{label}</label>
      {children}
    </div>
  )
}
