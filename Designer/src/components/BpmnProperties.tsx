// BPMN fields beyond the basics (#6, #10): sub-process membership, event
// definitions, boundary attachment, script / mail / case service tasks, call
// activity and business rule references, multi-instance with Flowable
// variable aggregation, compensation, event and ad-hoc sub-processes, and a
// gateway's default flow. Everything here round-trips through bpmnAdapter.ts.
import type { Edge, Node } from '@xyflow/react'
import { useWorkbenchStore, type NodeData } from '../store/useWorkbenchStore'
import type { BpmnEventDefinition, BpmnNodeData, EventKind, FieldMapping, IoMapping, MultiInstance } from '../adapters/bpmnAdapter'

const input = 'w-full rounded border border-sky-200 bg-white p-1.5 font-mono text-xs text-slate-800 outline-none focus:border-sky-500'
const ACTIVITIES = new Set(['userTask', 'serviceTask', 'scriptTask', 'businessRuleTask', 'callActivity', 'subProcess', 'adHocSubProcess', 'genericNode'])
const CONTAINERS = new Set(['subProcess', 'adHocSubProcess'])
const EVENTS = new Set(['startEvent', 'endEvent', 'intermediateEvent', 'boundaryEvent'])

// Which event definitions make sense where (Flowable OSS 8).
const EVENT_KINDS: Record<string, EventKind[]> = {
  startEvent: ['timer', 'message', 'signal', 'error', 'escalation', 'conditional'],
  endEvent: ['error', 'escalation', 'signal', 'message', 'compensate', 'terminate'],
  intermediateCatch: ['timer', 'message', 'signal', 'conditional', 'variableListener'],
  intermediateThrow: ['signal', 'escalation', 'compensate'],
  boundaryEvent: ['timer', 'message', 'signal', 'error', 'escalation', 'conditional', 'compensate'],
}
const KIND_LABEL: Record<EventKind, string> = {
  timer: 'Timer', message: 'Message', signal: 'Signal', error: 'Error', escalation: 'Escalation',
  conditional: 'Conditional', compensate: 'Compensation', terminate: 'Terminate', variableListener: 'Variable listener',
}

/** "source->target" lines <-> mappings (an "=expr" source becomes sourceExpression). */
const ioToText = (list: IoMapping[] | undefined) =>
  (list ?? []).map((m) => `${m.sourceExpression ? `=${m.sourceExpression}` : m.source}->${m.target}`).join('\n')
const textToIo = (text: string): IoMapping[] =>
  text.split('\n').map((l) => l.split('->').map((p) => p.trim())).filter(([s, t]) => s && t)
    .map(([s, t]) => (s.startsWith('=') ? { sourceExpression: s.slice(1), target: t } : { source: s, target: t }))

export function BpmnProperties({ node }: { node: Node<NodeData> }) {
  const { nodes, edges, updateNodeData, replaceEdges } = useWorkbenchStore()
  const d = node.data as NodeData & BpmnNodeData
  const set = (patch: Partial<NodeData & BpmnNodeData>) => updateNodeData(node.id, patch as Partial<NodeData>)
  const type = node.type ?? ''

  const descendants = new Set<string>()
  const collect = (id: string) => nodes.filter((n) => (n.data as BpmnNodeData).parentId === id).forEach((n) => { descendants.add(n.id); collect(n.id) })
  collect(node.id)
  const containers = nodes.filter((n) => CONTAINERS.has(n.type ?? '') && n.id !== node.id && !descendants.has(n.id))

  return (
    <>
      <Field label="Inside sub-process">
        <select value={d.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value || undefined })} className={input}>
          <option value="">(process)</option>
          {containers.map((c) => <option key={c.id} value={c.id}>{c.data.label}</option>)}
        </select>
      </Field>

      {EVENTS.has(type) && <EventFields node={node} d={d} set={set} nodes={nodes} edges={edges} replaceEdges={replaceEdges} />}

      {type === 'scriptTask' && (
        <>
          <Field label="Script language">
            <input value={d.scriptFormat ?? 'groovy'} onChange={(e) => set({ scriptFormat: e.target.value })} className={input} />
          </Field>
          <Field label="Script">
            <textarea value={d.script ?? ''} rows={6} spellCheck={false} onChange={(e) => set({ script: e.target.value })} className={input}
              placeholder="execution.setVariable('total', amount * 2)" />
            <p className="text-[11px] text-amber-700">Scripts run inside the shared runtime. Deploying one needs the platform setting cwp.scripts.enabled.</p>
          </Field>
        </>
      )}

      {type === 'serviceTask' && <ServiceFields d={d} set={set} />}

      {type === 'callActivity' && (
        <>
          <Field label="Called process key">
            <input value={d.calledElement ?? ''} onChange={(e) => set({ calledElement: e.target.value || undefined })} className={input} />
          </Field>
          <IoFields d={d} set={set} />
        </>
      )}
      {type === 'businessRuleTask' && (
        <Field label="Decision key">
          <input value={d.decisionRef ?? ''} onChange={(e) => set({ decisionRef: e.target.value || undefined })} className={input} />
        </Field>
      )}

      {type === 'subProcess' && (
        <Field label="Kind">
          <Check checked={Boolean(d.triggeredByEvent)} onChange={(v) => set({ triggeredByEvent: v || undefined })}
            text="Event sub-process: starts when its start event fires, not from a sequence flow" />
        </Field>
      )}
      {type === 'adHocSubProcess' && (
        <>
          <Field label="Ordering">
            <select value={d.ordering ?? 'Parallel'} onChange={(e) => set({ ordering: e.target.value })} className={input}>
              <option value="Parallel">Parallel</option>
              <option value="Sequential">Sequential</option>
            </select>
          </Field>
          <Field label="Completion condition">
            <input value={d.completionCondition ?? ''} placeholder="${vars:getOrDefault('done', false)}"
              onChange={(e) => set({ completionCondition: e.target.value || undefined })} className={input} />
            <p className="text-[11px] text-slate-500">Checked after each activity; read variables with vars:getOrDefault, as they may not exist yet.</p>
          </Field>
        </>
      )}

      {ACTIVITIES.has(type) && (
        <>
          <MultiInstanceFields d={d} set={set} />
          <Field label="Compensation">
            <Check checked={Boolean(d.isForCompensation)} onChange={(v) => set({ isForCompensation: v || undefined })}
              text="Compensation handler: runs only to undo another activity" />
          </Field>
        </>
      )}

      {['exclusiveGateway', 'inclusiveGateway'].includes(type) && (
        <Field label="Default flow">
          <select value={d.defaultFlow ?? ''} onChange={(e) => set({ defaultFlow: e.target.value || undefined })} className={input}>
            <option value="">(none)</option>
            {edges.filter((e) => e.source === node.id && (e.data as { kind?: string })?.kind !== 'association').map((e) => (
              <option key={e.id} value={e.id}>{`to ${nodes.find((n) => n.id === e.target)?.data.label ?? e.target}`}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">Taken when no other outgoing condition is true.</p>
        </Field>
      )}
    </>
  )
}

function EventFields({ node, d, set, nodes, edges, replaceEdges }: {
  node: Node<NodeData>
  d: NodeData & BpmnNodeData
  set: (patch: Partial<NodeData & BpmnNodeData>) => void
  nodes: Node<NodeData>[]
  edges: Edge[]
  replaceEdges: (edges: Edge[]) => void
}) {
  const type = node.type ?? ''
  const slot = type === 'intermediateEvent' ? (d.throwing ? 'intermediateThrow' : 'intermediateCatch') : type
  const kinds = EVENT_KINDS[slot] ?? []
  const def = d.eventDefinition
  const setDef = (patch: Partial<BpmnEventDefinition> | null) =>
    set({ eventDefinition: patch === null ? undefined : ({ ...(def ?? { type: kinds[0] }), ...patch } as BpmnEventDefinition) })
  const handler = edges.find((e) => e.source === node.id && (e.data as { kind?: string })?.kind === 'association')

  return (
    <>
      {type === 'intermediateEvent' && (
        <Field label="Direction">
          <Check checked={Boolean(d.throwing)} onChange={(v) => set({ throwing: v || undefined, eventDefinition: undefined })}
            text="Throwing (sends a signal, escalation or compensation) instead of catching" />
        </Field>
      )}
      <Field label="Event type">
        <select value={def?.type ?? ''} onChange={(e) => setDef(e.target.value ? { type: e.target.value as EventKind } : null)} className={input}>
          <option value="">{type === 'intermediateEvent' ? '(choose)' : '(none)'}</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      {def?.type === 'timer' && (
        <Field label="Timer">
          <div className="flex gap-1">
            <select value={def.timer?.kind ?? 'timeDuration'} onChange={(e) => setDef({ timer: { kind: e.target.value as 'timeDuration', value: def.timer?.value ?? '' } })} className={input}>
              <option value="timeDuration">After (duration)</option>
              <option value="timeDate">At (date)</option>
              <option value="timeCycle">Every (cycle)</option>
            </select>
            <input value={def.timer?.value ?? ''} placeholder="PT1H" onChange={(e) => setDef({ timer: { kind: def.timer?.kind ?? 'timeDuration', value: e.target.value } })} className={input} />
          </div>
        </Field>
      )}
      {def && ['signal', 'message', 'error', 'escalation'].includes(def.type) && (
        <Field label={`${KIND_LABEL[def.type]} ${def.type === 'error' || def.type === 'escalation' ? 'name / code' : 'name'}`}>
          <input value={def.name ?? ''} placeholder="name" onChange={(e) => setDef({ name: e.target.value || undefined })} className={input} />
          {(def.type === 'error' || def.type === 'escalation') && (
            <input value={def.code ?? ''} placeholder="code (what throw and catch match on)" onChange={(e) => setDef({ code: e.target.value || undefined })} className={`${input} mt-1`} />
          )}
          {def.type === 'signal' && (
            <Check checked={def.scope === 'processInstance'} onChange={(v) => setDef({ scope: v ? 'processInstance' : undefined })}
              text="Only this process instance (recommended; otherwise it is broadcast)" />
          )}
        </Field>
      )}
      {def?.type === 'conditional' && (
        <Field label="Condition">
          <input value={def.condition ?? ''} placeholder="${riskReviewed == true}" onChange={(e) => setDef({ condition: e.target.value })} className={input} />
          <p className="text-[11px] text-slate-500">Re-checked when the instance's variables are updated.</p>
        </Field>
      )}
      {def?.type === 'variableListener' && (
        <Field label="Variable">
          <input value={def.variableName ?? ''} placeholder="welcomeCallDone" onChange={(e) => setDef({ variableName: e.target.value })} className={input} />
          <select value={def.changeType ?? 'all'} onChange={(e) => setDef({ changeType: e.target.value })} className={`${input} mt-1`}>
            <option value="all">created or updated</option>
            <option value="create">created</option>
            <option value="update">updated</option>
          </select>
        </Field>
      )}
      {type === 'startEvent' && (
        <Field label="Interrupting">
          <Check checked={d.interrupting !== false} onChange={(v) => set({ interrupting: v ? undefined : false })}
            text="In an event sub-process: cancels the rest of the instance" />
        </Field>
      )}
      {type === 'boundaryEvent' && (
        <>
          <Field label="Attached to">
            <select value={d.attachedTo ?? ''} onChange={(e) => set({ attachedTo: e.target.value || undefined })} className={input}>
              <option value="">(choose an activity)</option>
              {nodes.filter((n) => ACTIVITIES.has(n.type ?? '')).map((n) => <option key={n.id} value={n.id}>{n.data.label}</option>)}
            </select>
          </Field>
          <Field label="Interrupting">
            <Check checked={d.cancelActivity !== false} onChange={(v) => set({ cancelActivity: v ? undefined : false })}
              text="Cancels the activity it is attached to" />
          </Field>
          {def?.type === 'compensate' && (
            <Field label="Compensation handler">
              <select
                value={handler?.target ?? ''}
                onChange={(e) => {
                  const others = edges.filter((x) => x !== handler)
                  replaceEdges(e.target.value
                    ? [...others, { id: `assoc_${node.id}`, source: node.id, target: e.target.value, type: 'straight', data: { kind: 'association' }, style: { strokeDasharray: '4 4' } }]
                    : others)
                }}
                className={input}
              >
                <option value="">(none)</option>
                {nodes.filter((n) => (n.data as BpmnNodeData).isForCompensation).map((n) => <option key={n.id} value={n.id}>{n.data.label}</option>)}
              </select>
              <p className="text-[11px] text-slate-500">Mark the undo activity as a compensation handler first.</p>
            </Field>
          )}
        </>
      )}
    </>
  )
}

function ServiceFields({ d, set }: { d: NodeData & BpmnNodeData; set: (p: Partial<NodeData & BpmnNodeData>) => void }) {
  const kind = d.serviceType ?? ''
  const field = (name: string) => d.fields?.find((f) => f.name === name)
  const setField = (name: string, value: string, fieldKind: FieldMapping['kind']) => {
    const rest = (d.fields ?? []).filter((f) => f.name !== name)
    set({ fields: value ? [...rest, { name, value, kind: fieldKind }] : rest })
  }
  return (
    <>
      <Field label="Implementation">
        <select value={kind} onChange={(e) => set({ serviceType: e.target.value || undefined })} className={input}>
          <option value="">Java delegate expression</option>
          <option value="mail">Send mail</option>
          <option value="case">Start a CMMN case and wait</option>
        </select>
      </Field>
      {kind === '' && (
        <Field label="Delegate expression">
          <input value={d.delegateExpression ?? ''} placeholder="${mySpringBean}" onChange={(e) => set({ delegateExpression: e.target.value || undefined })} className={input} />
        </Field>
      )}
      {kind === 'mail' && (
        <Field label="Mail (expressions allowed)">
          {(['to', 'subject', 'text'] as const).map((name) => (
            <input key={name} value={field(name)?.value ?? ''} placeholder={name === 'to' ? 'to: ${employeeEmail}' : name}
              onChange={(e) => setField(name, e.target.value, e.target.value.includes('${') ? 'expression' : 'string')}
              className={`${input} mb-1`} />
          ))}
        </Field>
      )}
      {kind === 'case' && (
        <>
          <Field label="Case key">
            <input value={d.caseDefinitionKey ?? ''} placeholder="kycOnboardingCase" onChange={(e) => set({ caseDefinitionKey: e.target.value || undefined })} className={input} />
          </Field>
          <IoFields d={d} set={set} />
        </>
      )}
    </>
  )
}

function IoFields({ d, set }: { d: NodeData & BpmnNodeData; set: (p: Partial<NodeData & BpmnNodeData>) => void }) {
  return (
    <Field label="Variables in / out (one 'source->target' per line)">
      <textarea key={`in-${ioToText(d.inputs)}`} defaultValue={ioToText(d.inputs)} rows={3} placeholder="country->country" spellCheck={false}
        onBlur={(e) => set({ inputs: textToIo(e.target.value) })} className={input} />
      <textarea key={`out-${ioToText(d.outputs)}`} defaultValue={ioToText(d.outputs)} rows={2} placeholder="result->kycResult" spellCheck={false}
        onBlur={(e) => set({ outputs: textToIo(e.target.value) })} className={`${input} mt-1`} />
    </Field>
  )
}

function MultiInstanceFields({ d, set }: { d: NodeData & BpmnNodeData; set: (p: Partial<NodeData & BpmnNodeData>) => void }) {
  const mi = d.multiInstance
  const update = (patch: Partial<MultiInstance>) => set({ multiInstance: { ...(mi ?? { sequential: false }), ...patch } })
  const aggText = (mi?.aggregations ?? []).map((a) => `${a.target}: ${a.variables.map((v) => `${v.source}->${v.target}`).join(', ')}`).join('\n')
  return (
    <Field label="Multi-instance">
      <Check checked={Boolean(mi)} onChange={(v) => set({ multiInstance: v ? { sequential: false } : undefined })} text="Run once per item of a collection" />
      {mi && (
        <div className="mt-1 space-y-1 pl-5">
          <Check checked={mi.sequential} onChange={(v) => update({ sequential: v })} text="One after another (otherwise in parallel)" />
          <input value={mi.collection ?? ''} placeholder="collection, e.g. ${reviewers}" onChange={(e) => update({ collection: e.target.value || undefined })} className={input} />
          <input value={mi.elementVariable ?? ''} placeholder="element variable, e.g. reviewer" onChange={(e) => update({ elementVariable: e.target.value || undefined })} className={input} />
          <input value={mi.completionCondition ?? ''} placeholder="finish early when, e.g. ${nrOfCompletedInstances >= 2}" onChange={(e) => update({ completionCondition: e.target.value || undefined })} className={input} />
          <textarea key={aggText} defaultValue={aggText} rows={2} spellCheck={false} placeholder="reviews: vote->vote, reviewer->reviewer"
            onBlur={(e) => update({
              aggregations: e.target.value.split('\n').map((line) => line.split(':')).filter(([t, v]) => t?.trim() && v?.trim())
                .map(([target, vars]) => ({
                  target: target.trim(),
                  variables: vars.split(',').map((p) => p.split('->').map((x) => x.trim())).filter(([s, t]) => s && t).map(([source, t]) => ({ source, target: t })),
                })),
            })}
            className={input} />
          <p className="text-[11px] text-slate-500">Aggregation collects each instance's variables into one list variable, e.g. every reviewer's vote.</p>
        </div>
      )}
    </Field>
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
