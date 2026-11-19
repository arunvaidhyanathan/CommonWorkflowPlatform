// CMMN-specific fields for the selected plan item, sentry or case plan:
// stage membership, item controls (required / manual activation / repetition),
// Flowable task attributes, listener and task references, and case settings.
// Everything here round-trips through cmmnAdapter.ts.
import type { Node } from '@xyflow/react'
import { useWorkbenchStore, type NodeData } from '../store/useWorkbenchStore'
import type { CaseRole } from '../adapters/cmmnAdapter'

const PLAN_ITEM_TYPES = new Set([
  'cmmnHumanTask', 'cmmnTask', 'cmmnMilestone', 'cmmnStage', 'cmmnDecisionTask',
  'cmmnProcessTask', 'cmmnCaseTask', 'cmmnTimerListener', 'cmmnUserListener',
])
// Event listeners and milestones can't be required/manual/repeated in Flowable the way tasks can.
const CONTROLLABLE = new Set(['cmmnHumanTask', 'cmmnTask', 'cmmnStage', 'cmmnDecisionTask', 'cmmnProcessTask', 'cmmnCaseTask'])

const input = 'w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500'

export function CmmnProperties({ node }: { node: Node<NodeData> }) {
  const { nodes, updateNodeData } = useWorkbenchStore()
  const d = node.data
  const set = (patch: Partial<NodeData>) => updateNodeData(node.id, patch)
  const type = node.type ?? ''

  // A stage can't be placed inside itself or inside one of its own descendants.
  const descendants = new Set<string>()
  const collect = (id: string) =>
    nodes.filter((n) => n.data.parentStage === id).forEach((n) => {
      descendants.add(n.id)
      collect(n.id)
    })
  collect(node.id)
  const stages = nodes.filter((n) => n.type === 'cmmnStage' && n.id !== node.id && !descendants.has(n.id))
  const roles = (nodes.find((n) => n.type === 'cmmnCasePlan')?.data.roles as CaseRole[] | undefined) ?? []

  return (
    <>
      {(PLAN_ITEM_TYPES.has(type) || type === 'cmmnSentry') && (
        <Field label="Inside stage">
          <select
            value={(d.parentStage as string) ?? ''}
            onChange={(e) => set({ parentStage: e.target.value || undefined })}
            className={input}
          >
            <option value="">(case plan)</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.data.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {CONTROLLABLE.has(type) && (
        <Field label="Item control">
          <Check checked={Boolean(d.required)} onChange={(v) => set({ required: v || undefined })}
            text="Required: its stage cannot complete until this is done" />
          <Check checked={Boolean(d.manualActivation)} onChange={(v) => set({ manualActivation: v || undefined })}
            text="Manual activation: offered to a case worker to start" />
          <Check checked={Boolean(d.repetition)} onChange={(v) => set({ repetition: v || undefined })}
            text="Repetition: can run more than once" />
          {Boolean(d.repetition) && (
            <div className="mt-1 space-y-1 pl-5">
              <input value={(d.repetitionCounter as string) ?? ''} placeholder="counter variable (optional)"
                onChange={(e) => set({ repetitionCounter: e.target.value || undefined })} className={input} />
              <input value={(d.repetitionCondition as string) ?? ''} placeholder="repeat while, e.g. ${count < 3}"
                onChange={(e) => set({ repetitionCondition: e.target.value || undefined })} className={input} />
            </div>
          )}
        </Field>
      )}

      {type === 'cmmnHumanTask' && (
        <>
          <Field label="Assignee">
            <input value={d.assignee ?? ''} placeholder="${initiator}" onChange={(e) => set({ assignee: e.target.value || undefined })} className={input} />
          </Field>
          <Field label="Candidate groups (comma-separated)">
            <input
              value={d.candidateGroups?.join(', ') ?? ''}
              placeholder="kycAnalyst, eddTeam"
              onChange={(e) => {
                const groups = e.target.value.split(',').map((g) => g.trim()).filter(Boolean)
                set({ candidateGroups: groups.length ? groups : undefined })
              }}
              className={input}
            />
          </Field>
          <Field label="Form key">
            <input value={d.formKey ?? ''} placeholder="kyc-document-collection" onChange={(e) => set({ formKey: e.target.value || undefined })} className={input} />
          </Field>
          <Field label="Performer role">
            {roles.length ? (
              <select value={(d.performerRef as string) ?? ''} onChange={(e) => set({ performerRef: e.target.value || undefined })} className={input}>
                <option value="">(none)</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-slate-500">Define case roles on the Case Plan node to assign one.</p>
            )}
          </Field>
          <Field label="Blocking">
            <Check checked={Boolean(d.isBlocking ?? true)} onChange={(v) => set({ isBlocking: v })} text="Stage waits for this task to complete" />
          </Field>
        </>
      )}

      {type === 'cmmnDecisionTask' && (
        <Field label="Decision key">
          <input value={(d.decisionKey as string) ?? ''} placeholder="kycAssessmentService" onChange={(e) => set({ decisionKey: e.target.value || undefined })} className={input} />
          <p className="text-[11px] text-slate-500">
            A deployed decision or decision service key. A service's result is stored as one JSON case variable named after the key.
          </p>
        </Field>
      )}
      {type === 'cmmnProcessTask' && (
        <Field label="Process key">
          <input value={(d.processKey as string) ?? ''} placeholder="expenseClaim" onChange={(e) => set({ processKey: e.target.value || undefined })} className={input} />
        </Field>
      )}
      {type === 'cmmnCaseTask' && (
        <Field label="Case key">
          <input value={(d.caseKey as string) ?? ''} placeholder="kycOnboardingCase" onChange={(e) => set({ caseKey: e.target.value || undefined })} className={input} />
        </Field>
      )}
      {type === 'cmmnTimerListener' && (
        <Field label="Timer expression (ISO-8601)">
          <input value={(d.timerExpression as string) ?? ''} placeholder="P5D, PT4H or a date" onChange={(e) => set({ timerExpression: e.target.value || undefined })} className={input} />
          <p className="text-[11px] text-slate-500">Starts counting when the listener becomes available. Connect it to a sentry with the "occur" event.</p>
        </Field>
      )}
      {type === 'cmmnUserListener' && (
        <p className="text-[11px] text-slate-500">
          Fired by a case worker from Running Work. Connect it to a sentry with the &quot;occur&quot; event.
        </p>
      )}

      {(type === 'cmmnStage' || type === 'cmmnCasePlan') && (
        <Field label="Completion">
          <Check checked={Boolean(d.autoComplete)} onChange={(v) => set({ autoComplete: v || undefined })}
            text="Auto-complete once required items are done (optional and offered items don't hold it open)" />
        </Field>
      )}

      {type === 'cmmnCasePlan' && (
        <Field label="Case roles (comma-separated)">
          <input
            key={roles.map((r) => r.name).join(',')}
            defaultValue={roles.map((r) => r.name).join(', ')}
            placeholder="Investigator, Compliance Officer"
            onBlur={(e) => {
              const names = e.target.value.split(',').map((n) => n.trim()).filter(Boolean)
              const next = names.map((name) => roles.find((r) => r.name === name) ?? { id: `Role_${name.replace(/\W+/g, '_')}`, name })
              set({ roles: next.length ? next : undefined })
            }}
            className={input}
          />
          <p className="text-[11px] text-slate-500">To end the whole case, connect a sentry to this node as an exit.</p>
        </Field>
      )}
    </>
  )
}

function Check({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      {text}
    </label>
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
