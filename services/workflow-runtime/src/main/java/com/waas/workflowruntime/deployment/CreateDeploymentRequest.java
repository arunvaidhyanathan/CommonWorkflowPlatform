package com.waas.workflowruntime.deployment;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code POST /runtime/deployments}. Extended in
 * WorkflowWrapper.html Section 9 Phase 2 to carry the actual packaged
 * artifact(s) ({@code manifest}) alongside deploy metadata -- Designer.html
 * Section 23.1's ".bar-shaped packaging" and 23.3's one-click Publish both
 * need a real payload here, not just a name/description.
 */
public record CreateDeploymentRequest(

        @NotBlank(message = "name is required")
        @Size(max = 255, message = "name must be at most 255 characters")
        String name,

        @Size(max = 100, message = "specType must be at most 100 characters")
        String specType,

        @Size(max = 2000, message = "description must be at most 2000 characters")
        String description,

        @NotEmpty(message = "manifest must contain at least one artifact")
        List<@Valid ManifestArtifact> manifest) {
}
