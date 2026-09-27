import { useMemo, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useSession } from './lib/useSession'
import { initialUrlHash } from './lib/supabaseClient'
import { LoginForm } from './components/LoginForm'
import { AppShell } from './components/AppShell'
import { RequireRole } from './components/RequireRole'
import { SetPasswordScreen } from './components/SetPasswordScreen'
import { DesignerPage } from './pages/DesignerPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { WorkbenchPage } from './pages/WorkbenchPage'
import { AdministrationPage } from './pages/AdministrationPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { WorkflowWrapperPage } from './pages/WorkflowWrapperPage'
import { SpendPage } from './pages/SpendPage'

function App() {
  const { session, loading } = useSession()

  // Onboarding.html Section 2.2: an invite (or password-recovery) link signs
  // the person in via a one-time token with no password set yet. Computed
  // once from the hash captured before Supabase's own init could strip it.
  const cameFromInviteLink = useMemo(() => {
    const params = new URLSearchParams(initialUrlHash.replace(/^#/, ''))
    const type = params.get('type')
    return type === 'invite' || type === 'recovery'
  }, [])
  const [passwordJustSet, setPasswordJustSet] = useState(false)

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading...</div>
  }

  if (!session) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-white">
        <LoginForm />
      </div>
    )
  }

  if (cameFromInviteLink && !passwordJustSet) {
    return <SetPasswordScreen onDone={() => setPasswordJustSet(true)} />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/designer" replace />} />
          <Route path="/designer" element={<DesignerPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/workbench" element={<WorkbenchPage />} />
          <Route path="/workflow-wrapper" element={<WorkflowWrapperPage />} />
          {/* The Agentic Designer lives in the Designer (AI Designer panel); keep old links working. */}
          <Route path="/agentic-designer" element={<Navigate to="/designer" replace />} />
          <Route
            path="/admin"
            element={
              <RequireRole allow={['tenant_admin']}>
                <AdministrationPage />
              </RequireRole>
            }
          />
          <Route
            path="/approvals"
            element={
              <RequireRole allow={['tenant_admin', 'approver']}>
                <ApprovalsPage />
              </RequireRole>
            }
          />
          <Route
            path="/spend"
            element={
              // The service scopes what each viewer sees (own tenant vs
              // platform-wide); this guard only hides the page from roles
              // that would get nothing back.
              <RequireRole allow={['tenant_admin']}>
                <SpendPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/designer" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
