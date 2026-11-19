// Onboarding.html Section 3.2: a dismissible, persistent checklist -- not a
// blocking modal wizard, which people click through without reading. Each
// item links to the real action. Dismissal persists on profiles so it
// reappears for each new user in a tenant, not just once per tenant.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dismissGettingStarted } from '../data/profile'
import type { Role } from '../lib/useSession'

interface GettingStartedPanelProps {
  userId: string
  role: Role | null
  hasWorkflows: boolean
  onDismissed: () => void
  onImportSample: () => void
}

export function GettingStartedPanel({
  userId,
  role,
  hasWorkflows,
  onDismissed,
  onImportSample,
}: GettingStartedPanelProps) {
  const navigate = useNavigate()
  const [dismissing, setDismissing] = useState(false)
  const [showTips, setShowTips] = useState(false)

  const onDismiss = async () => {
    setDismissing(true)
    try {
      await dismissGettingStarted(userId)
      onDismissed()
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-sky-900">
          Getting Started
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing}
          className="text-[11px] font-semibold text-sky-700 hover:underline disabled:opacity-50"
        >
          Hide this
        </button>
      </div>
      <ul className="space-y-1.5 text-sm text-slate-700">
        <li className="flex items-center gap-2">
          <span>{hasWorkflows ? '☑' : '☐'}</span>
          <span>
            Create your first workflow, or{' '}
            <button type="button" onClick={onImportSample} className="text-sky-700 hover:underline">
              import a sample
            </button>
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span>{'☐'}</span>
          {role === 'tenant_admin' ? (
            <span>
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="text-sky-700 hover:underline"
              >
                Invite a teammate
              </button>
            </span>
          ) : (
            <span className="text-slate-500">
              Invite a teammate -- ask your tenant admin, in Administration
            </span>
          )}
        </li>
        <li className="flex items-center gap-2">
          <span>{'☐'}</span>
          <button
            type="button"
            onClick={() => setShowTips((v) => !v)}
            className="text-sky-700 hover:underline"
          >
            Review the Designer basics
          </button>
        </li>
      </ul>
      {showTips && (
        <div className="mt-3 rounded border border-sky-200 bg-white p-3 text-xs text-slate-600">
          <p className="mb-1">
            <strong>New:</strong> starts a blank BPMN/CMMN/DMN model. <strong>Import:</strong>{' '}
            brings in an existing .bpmn/.cmmn/.dmn file. <strong>Save Version</strong> freezes an
            immutable snapshot; <strong>Submit for Approval</strong> sends the latest saved
            version to whoever holds the approver role.
          </p>
          <p>Use the Palette on the left to drop nodes, and the Properties panel on the right to edit the selected node.</p>
        </div>
      )}
    </div>
  )
}
