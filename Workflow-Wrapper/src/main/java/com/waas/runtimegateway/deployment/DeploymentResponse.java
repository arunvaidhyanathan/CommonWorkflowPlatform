package com.waas.runtimegateway.deployment;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Response shape for {@code /runtime/deployments} endpoints. {@code
 * manifest} is deserialized from {@link Deployment#getManifestJson()} by
 * {@link DeploymentService} (not here), since that's the one place in this
 * service allowed to know about Jackson/JSON (de)serialization of the
 * stored column -- see WorkflowWrapper.html Section 9 Phase 2.
 */
public record DeploymentResponse(
        UUID id,
        UUID tenantId,
        String name,
        String specType,
        String description,
        String status,
        UUID createdBy,
        OffsetDateTime createdAt,
        List<ManifestArtifact> manifest,
        List<EngineDeploymentRef> engineDeployments) {

    public static DeploymentResponse from(
            Deployment deployment, List<ManifestArtifact> manifest, List<EngineDeploymentRef> engineDeployments) {
        return new DeploymentResponse(
                deployment.getId(),
                deployment.getTenantId(),
                deployment.getName(),
                deployment.getSpecType(),
                deployment.getDescription(),
                deployment.getStatus(),
                deployment.getCreatedBy(),
                deployment.getCreatedAt(),
                manifest,
                engineDeployments);
    }
}
