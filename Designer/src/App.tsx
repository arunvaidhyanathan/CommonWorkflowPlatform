import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useSession } from './lib/useSession'
import { LoginForm } from './components/LoginForm'
import { AppShell } from './components/AppShell'
import { RequireRole } from './components/RequireRole'
import { DesignerPage } from './pages/DesignerPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { WorkbenchPage } from './pages/WorkbenchPage'
import { AdministrationPage } from './pages/AdministrationPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { WorkflowWrapperPage } from './pages/WorkflowWrapperPage'
import { SpendPage } from './pages/SpendPage'
import { TasksPage } from './pages/TasksPage'
import { InstancesPage } from './pages/InstancesPage'
import { DecisionsPage } from './pages/DecisionsPage'

function App() {
  const { session, loading } = useSession()

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

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/designer" replace />} />
          <Route path="/designer" element={<DesignerPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/workbench" element={<WorkbenchPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/instances" element={<InstancesPage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
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
