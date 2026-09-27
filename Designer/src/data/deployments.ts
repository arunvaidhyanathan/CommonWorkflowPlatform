// Runtime-layer data (WorkflowWrapper.html): calls the Java Runtime
// Gateway, not Supabase -- the "second backend" described in CWP.html
// Section 2. Modeled after data/workflows.ts and data/approvals.ts for
// consistency, but every function here goes through
// lib/apiClient.ts instead of the Supabase client.
import { apiFetch } from '../lib/apiClient'

export interface ManifestArtifact {
  definitionKey: string
  name: string
  specType: string
  xml: string
}

export interface EngineDeploymentRef {
  specType: string
  engineDeploymentId: string
}

export interface Deployment {
  id: string
  tenantId: string
  name: string
  specType: string | null
  description: string | null
  status: string
  createdBy: string | null
  createdAt: string
  manifest: ManifestArtifact[]
  /**
   * WorkflowWrapper.html Section 9 Phase 7: the real Flowable engine
   * deployment(s) this record produced (one per manifest artifact,
   * tagged by which engine -- BPMN/CMMN/DMN -- deployed it). Added when
   * the Runtime Gateway started embedding a real engine instead of just
   * bookkeeping a synthetic deployment.
   */
  engineDeployments: EngineDeploymentRef[]
}

/**
 * WorkflowWrapper.html Section 9 Phase 2 / Designer.html Section 23.3:
 * one-click Publish. Packages the given artifact(s) into a single
 * deployment's manifest and calls POST /runtime/deployments. Gated by
 * deploy authority (tenant_admin only, Governance.html Section 11.3
 * provisional rule) -- enforced server-side by the gateway; the caller
 * (DesignerPage.tsx) should also hide/disable the button for other roles
 * so the restriction is visible before someone hits a 403.
 */
export async function createDeployment(params: {
  name: string
  specType: string
  description?: string
  manifest: ManifestArtifact[]
}): Promise<Deployment> {
  return apiFetch<Deployment>('/runtime/deployments', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      specType: params.specType,
      description: params.description ?? null,
      manifest: params.manifest,
    }),
  })
}

export async function listDeployments(): Promise<Deployment[]> {
  return apiFetch<Deployment[]>('/runtime/deployments')
}

export async function getDeployment(id: string): Promise<Deployment> {
  return apiFetch<Deployment>(`/runtime/deployments/${id}`)
}
