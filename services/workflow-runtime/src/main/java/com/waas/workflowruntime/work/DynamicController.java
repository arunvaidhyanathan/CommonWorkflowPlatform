package com.waas.workflowruntime.work;

import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.flowable.cmmn.api.CmmnRuntimeService;
import org.flowable.cmmn.api.DynamicCmmnService;
import org.flowable.cmmn.api.runtime.CaseInstance;
import org.flowable.cmmn.api.runtime.PlanItemInstance;
import org.flowable.engine.DynamicBpmnService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.impl.dynamic.DynamicUserTaskBuilder;
import org.flowable.engine.runtime.ProcessInstance;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Ad-hoc changes to one running instance, without redeploying:
 * <ul>
 * <li>process: inject a new user task, assigned to a tenant member, that
 *     runs alongside the current work (Flowable derives a per-instance copy
 *     of the definition for this)</li>
 * <li>case: create another instance of a plan item the case definition
 *     already has (e.g. one more review), in the case or inside a stage. The
 *     new instance keeps that plan item's entry criteria: one gated by a
 *     sentry waits (available) like the original would</li>
 * </ul>
 * Designers and tenant admins only.
 */
@RestController
@RequestMapping("/runtime/instances")
public class DynamicController {

    public record InjectTaskRequest(@NotBlank String name, @NotBlank String assignee) {
    }

    public record InjectPlanItemRequest(@NotBlank String elementId, String name, String stageInstanceId) {
    }

    private final WorkAccess access;
    private final JdbcTemplate jdbc;
    private final RuntimeService runtime;
    private final DynamicBpmnService dynamicBpmn;
    private final CmmnRuntimeService cmmnRuntime;
    private final DynamicCmmnService dynamicCmmn;

    DynamicController(WorkAccess access, JdbcTemplate jdbc, RuntimeService runtime, DynamicBpmnService dynamicBpmn,
            CmmnRuntimeService cmmnRuntime, DynamicCmmnService dynamicCmmn) {
        this.access = access;
        this.jdbc = jdbc;
        this.runtime = runtime;
        this.dynamicBpmn = dynamicBpmn;
        this.cmmnRuntime = cmmnRuntime;
        this.dynamicCmmn = dynamicCmmn;
    }

    @PostMapping("/process/{id}/inject-task")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, String> injectTask(@PathVariable String id, @Valid @RequestBody InjectTaskRequest request) {
        var actor = access.writer("designer", "tenant_admin");
        ProcessInstance instance = runtime.createProcessInstanceQuery().processInstanceId(id)
                .processInstanceTenantId(actor.tenantId().toString()).singleResult();
        if (instance == null) {
            throw WorkAccess.notFound("Running process instance");
        }
        // The assignee must be an active member of this tenant, or nobody could ever see the task.
        Boolean member = jdbc.queryForObject(
                "select exists (select 1 from public.profiles where id::text = ? and tenant_id = ? and status = 'active')",
                Boolean.class, request.assignee(), actor.tenantId());
        if (!Boolean.TRUE.equals(member)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The assignee must be an active member of your tenant.");
        }
        dynamicBpmn.injectUserTaskInProcessInstance(id,
                new DynamicUserTaskBuilder().name(request.name()).assignee(request.assignee()));
        return Map.of("processInstanceId", id);
    }

    @PostMapping("/case/{id}/inject-plan-item")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, String> injectPlanItem(@PathVariable String id, @Valid @RequestBody InjectPlanItemRequest request) {
        var actor = access.writer("designer", "tenant_admin");
        CaseInstance instance = cmmnRuntime.createCaseInstanceQuery().caseInstanceId(id)
                .caseInstanceTenantId(actor.tenantId().toString()).singleResult();
        if (instance == null) {
            throw WorkAccess.notFound("Running case instance");
        }
        var builder = dynamicCmmn.createInjectedPlanItemInstanceBuilder()
                .caseDefinitionId(instance.getCaseDefinitionId())
                .elementId(request.elementId())
                .name(request.name() == null || request.name().isBlank() ? null : request.name());
        PlanItemInstance created;
        if (request.stageInstanceId() != null && !request.stageInstanceId().isBlank()) {
            PlanItemInstance stage = cmmnRuntime.createPlanItemInstanceQuery().planItemInstanceId(request.stageInstanceId())
                    .caseInstanceId(id).singleResult();
            if (stage == null) {
                throw WorkAccess.notFound("Stage in this case");
            }
            created = builder.createInStage(stage.getId());
        } else {
            created = builder.createInCase(id);
        }
        return Map.of("planItemInstanceId", created.getId());
    }
}
