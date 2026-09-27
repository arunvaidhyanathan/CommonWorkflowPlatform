package com.waas.workflowruntime.runtimeview;

import java.time.Instant;

/**
 * WorkflowWrapper.html Section 8, row 4 ({@code GET
 * /runtime/history/task-instances}), mirroring Flowable's {@code
 * /history/historic-task-instances}. Backed by the real, embedded
 * (BPMN) {@code HistoryService} as of Section 9 Phase 7.
 *
 * <p>Covers BPMN historic tasks only -- CMMN human tasks have their own
 * history query surface via {@code CmmnHistoryService} that isn't wired in
 * here yet. Noted as a gap rather than silently only covering half the
 * picture.
 */
public record HistoricTaskInstanceResponse(
        String id,
        String name,
        String assignee,
        String processInstanceId,
        String tenantId,
        Instant startTime,
        Instant endTime,
        Long durationInMillis) {
}
