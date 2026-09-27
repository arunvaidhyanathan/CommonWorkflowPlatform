package com.waas.workflowruntime.runtimeview;

import java.util.List;

import org.flowable.engine.HistoryService;
import org.flowable.task.api.history.HistoricTaskInstance;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.waas.workflowruntime.common.TenantContext;

/**
 * WorkflowWrapper.html Section 8, row 4 ({@code GET
 * /runtime/history/task-instances}) -- backs Workbench.html Section 7.3's
 * execution visibility and Governance.html Section 11.2's engine
 * audit/history roadmap item. As of Section 9 Phase 7, this queries the
 * real, embedded (BPMN) {@link HistoryService} instead of returning a
 * stub. CMMN human-task history isn't included yet -- see this class's
 * response DTO javadoc.
 */
@RestController
@RequestMapping("/runtime/history/task-instances")
public class TaskInstanceHistoryController {

    private final HistoryService historyService;

    public TaskInstanceHistoryController(HistoryService historyService) {
        this.historyService = historyService;
    }

    @GetMapping
    public List<HistoricTaskInstanceResponse> list() {
        String tenantId = TenantContext.currentTenantId().toString();
        List<HistoricTaskInstance> tasks = historyService.createHistoricTaskInstanceQuery()
                .taskTenantId(tenantId)
                .list();
        return tasks.stream().map(TaskInstanceHistoryController::toResponse).toList();
    }

    private static HistoricTaskInstanceResponse toResponse(HistoricTaskInstance task) {
        return new HistoricTaskInstanceResponse(
                task.getId(),
                task.getName(),
                task.getAssignee(),
                task.getProcessInstanceId(),
                task.getTenantId(),
                task.getStartTime() != null ? task.getStartTime().toInstant() : null,
                task.getEndTime() != null ? task.getEndTime().toInstant() : null,
                task.getDurationInMillis());
    }
}
