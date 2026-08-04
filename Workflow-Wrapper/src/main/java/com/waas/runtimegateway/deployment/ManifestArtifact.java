package com.waas.runtimegateway.deployment;

import jakarta.validation.constraints.NotBlank;

/**
 * One packaged artifact within a deployment's manifest -- WorkflowWrapper.html
 * Section 9 Phase 2 / Designer.html Section 23.1's ".bar-shaped packaging."
 * A single deployment can carry more than one of these (e.g. a BPMN process
 * plus a DMN decision table it references), though Designer's Phase 2
 * frontend only ever sends one today, since workflows aren't yet modeled
 * with explicit cross-artifact relationships -- this shape exists so that
 * bundling multiple related artifacts into one deployment later is a
 * frontend change, not another API version.
 */
public record ManifestArtifact(

        @NotBlank(message = "manifest artifact definitionKey is required")
        String definitionKey,

        @NotBlank(message = "manifest artifact name is required")
        String name,

        @NotBlank(message = "manifest artifact specType is required")
        String specType,

        @NotBlank(message = "manifest artifact xml is required")
        String xml) {
}
