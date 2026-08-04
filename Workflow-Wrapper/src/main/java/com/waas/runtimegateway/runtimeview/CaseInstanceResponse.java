package com.waas.runtimegateway.runtimeview;

import java.time.Instant;

/**
 * WorkflowWrapper.html Section 8, row 3 ({@code GET /runtime/case-instances}),
 * mirroring Flowable's {@code /cmmn-runtime/case-instances}. Backed by the
 * real, embedded {@code CmmnRuntimeService} as of Section 9 Phase 7.
 */
public record CaseInstanceResponse(
        String id,
        String caseDefinitionId,
        String businessKey,
        String name,
        String state,
        String tenantId,
        Instant startTime) {
}
