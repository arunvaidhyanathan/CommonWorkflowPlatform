// Placeholder screen for app areas that have a nav entry and a route today
// but no real implementation yet (currently just Agentic Designer -- Onboarding,
// Workbench, and Workflow Wrapper have all since been built). Keeps
// navigation honest -- the link goes somewhere real -- without pretending
// the feature exists.
interface StubPageProps {
  title: string
  description: string
}

export function StubPage({ title, description }: StubPageProps) {
  return (
    <div className="mx-auto max-w-lg p-10 text-center">
      <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-dashed border-sky-300" />
      <h1 className="mb-2 text-lg font-bold text-[#003b70]">{title}</h1>
      <p className="text-sm text-slate-500">{description}</p>
      <p className="mt-4 text-xs text-slate-400">Not built yet -- this is a placeholder route.</p>
    </div>
  )
}
