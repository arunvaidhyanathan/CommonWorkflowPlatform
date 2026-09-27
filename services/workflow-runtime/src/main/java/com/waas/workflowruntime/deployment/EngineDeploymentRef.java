package com.waas.workflowruntime.deployment;

/**
 * One real Flowable engine deployment resulting from a {@link
 * CreateDeploymentRequest}'s manifest -- WorkflowWrapper.html Section 9
 * Phase 7. Each manifest artifact is deployed to whichever engine matches
 * its {@code specType} (BPMN -&gt; RepositoryService, CMMN -&gt;
 * CmmnRepositoryService, DMN -&gt; DmnRepositoryService), so a single
 * {@code POST /runtime/deployments} call can produce more than one of
 * these -- e.g. a BPMN process plus the DMN table it evaluates.
 */
public record EngineDeploymentRef(String specType, String engineDeploymentId) {
}
