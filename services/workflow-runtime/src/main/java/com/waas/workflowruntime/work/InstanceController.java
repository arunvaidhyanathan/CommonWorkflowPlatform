package com.waas.workflowruntime.work;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import org.flowable.cmmn.api.CmmnHistoryService;
import org.flowable.cmmn.api.CmmnRepositoryService;
import org.flowable.cmmn.api.CmmnRuntimeService;
import org.flowable.cmmn.api.history.HistoricCaseInstance;
import org.flowable.cmmn.api.runtime.PlanItemInstance;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.history.HistoricProcessInstance;
import org.flowable.task.api.Task;
import org.flowable.engine.TaskService;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Running work: deployed definitions, and starting, listing, inspecting,
 * updating and terminating BPMN process instances and CMMN case instances.
 * {@code kind} in paths is {@code process} or {@code case}.
 */
@RestController
@RequestMapping("/runtime")
public class InstanceController {

    public record Definition(String id, String kind, String key, String name, int version, String deploymentId) {
    }

    public record StartRequest(@NotNull @Pattern(regexp = "process|case") String kind,
            @NotBlank String definitionKey, String businessKey, Map<String, Object> variables) {
    }

    public record InstanceSummary(String id, String kind, String definitionId, String definitionKey, String definitionName,
            String businessKey, String state, String startUserId, Instant startTime, Instant endTime, String businessStatus) {
    }

    /** {@code actions}: what a case worker can do now (see PlanItemController). */
    public record PlanItem(String id, String elementId, String name, String type, String state, String stageInstanceId,
            List<String> actions) {
    }

    public record OpenTask(String id, String name, String assignee) {
    }

    /** {@code waitingOn}: ad-hoc activities to start and signals/messages a process waits for (ProcessEventController). */
    public record InstanceDetail(InstanceSummary instance, Map<String, Object> variables, List<PlanItem> planItems,
            List<String> activeActivityIds, List<OpenTask> openTasks, List<ProcessEventController.Waiting> waitingOn) {
    }

    private final WorkAccess access;
    private final RepositoryService repository;
    private final RuntimeService runtime;
    private final HistoryService history;
    private final TaskService tasks;
    private final CmmnRepositoryService cmmnRepository;
    private final CmmnRuntimeService cmmnRuntime;
    private final CmmnHistoryService cmmnHistory;

    InstanceController(WorkAccess access, RepositoryService repository, RuntimeService runtime,
            HistoryService history, TaskService tasks, CmmnRepositoryService cmmnRepository,
            CmmnRuntimeService cmmnRuntime, CmmnHistoryService cmmnHistory) {
        this.access = access;
        this.repository = repository;
        this.runtime = runtime;
        this.history = history;
        this.tasks = tasks;
        this.cmmnRepository = cmmnRepository;
        this.cmmnRuntime = cmmnRuntime;
        this.cmmnHistory = cmmnHistory;
    }

    private static Instant instant(Date date) {
        return date == null ? null : date.toInstant();
    }

    @GetMapping("/definitions")
    public List<Definition> definitions() {
        String tenant = access.tenantId();
        Stream<Definition> processes = repository.createProcessDefinitionQuery().processDefinitionTenantId(tenant)
                .latestVersion().active().list().stream()
                .map(d -> new Definition(d.getId(), "process", d.getKey(), d.getName(), d.getVersion(), d.getDeploymentId()));
        Stream<Definition> cases = cmmnRepository.createCaseDefinitionQuery().caseDefinitionTenantId(tenant)
                .latestVersion().list().stream()
                .map(d -> new Definition(d.getId(), "case", d.getKey(), d.getName(), d.getVersion(), d.getDeploymentId()));
        return Stream.concat(processes, cases).sorted(Comparator.comparing(Definition::name,
                Comparator.nullsLast(String::compareToIgnoreCase))).toList();
    }

    @PostMapping("/instances")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public InstanceSummary start(@Valid @RequestBody StartRequest request) {
        var actor = access.writer(WorkAccess.PARTICIPANTS);
        String tenant = actor.tenantId().toString();
        Map<String, Object> variables = request.variables() == null ? Map.of() : request.variables();
        String id = "process".equals(request.kind())
                ? runtime.createProcessInstanceBuilder().processDefinitionKey(request.definitionKey())
                        .tenantId(tenant).businessKey(request.businessKey()).variables(variables).start().getId()
                : cmmnRuntime.createCaseInstanceBuilder().caseDefinitionKey(request.definitionKey())
                        .tenantId(tenant).businessKey(request.businessKey()).variables(variables).start().getId();
        return summary(request.kind(), id);
    }

    @GetMapping("/instances")
    public List<InstanceSummary> list(@RequestParam(defaultValue = "all") String state) {
        String tenant = access.tenantId();
        var processQuery = history.createHistoricProcessInstanceQuery().processInstanceTenantId(tenant);
        var caseQuery = cmmnHistory.createHistoricCaseInstanceQuery().caseInstanceTenantId(tenant);
        if ("active".equals(state)) {
            processQuery.unfinished();
            caseQuery.unfinished();
        }
        List<InstanceSummary> all = new ArrayList<>();
        processQuery.orderByProcessInstanceStartTime().desc().listPage(0, 200)
                .forEach(p -> all.add(toSummary(p)));
        caseQuery.orderByStartTime().desc().listPage(0, 200).forEach(c -> all.add(toSummary(c)));
        all.sort(Comparator.comparing(InstanceSummary::startTime, Comparator.nullsLast(Comparator.reverseOrder())));
        return all;
    }

    @GetMapping("/instances/{kind}/{id}")
    public InstanceDetail detail(@PathVariable String kind, @PathVariable String id) {
        InstanceSummary summary = summary(kind, id);
        boolean running = summary.endTime() == null;
        List<OpenTask> open = (running ? ("process".equals(kind)
                ? tasks.createTaskQuery().processInstanceId(id)
                : tasks.createTaskQuery().caseInstanceId(id)).list() : List.<Task>of())
                .stream().map(t -> new OpenTask(t.getId(), t.getName(), t.getAssignee())).toList();
        if ("process".equals(kind)) {
            Map<String, Object> vars = running ? runtime.getVariables(id) : historicProcessVariables(id);
            return new InstanceDetail(summary, vars, List.of(),
                    running ? runtime.getActiveActivityIds(id) : List.of(), open,
                    running ? ProcessEventController.waitingOn(runtime, id) : List.of());
        }
        Map<String, Object> vars = running ? cmmnRuntime.getVariables(id) : historicCaseVariables(id);
        List<PlanItem> planItems = running
                ? cmmnRuntime.createPlanItemInstanceQuery().caseInstanceId(id).includeEnded().list().stream()
                        .map(InstanceController::toPlanItem).toList()
                : cmmnHistory.createHistoricPlanItemInstanceQuery().planItemInstanceCaseInstanceId(id).list().stream()
                        .map(p -> new PlanItem(p.getId(), p.getElementId(), p.getName(), p.getPlanItemDefinitionType(), p.getState(),
                                p.getStageInstanceId(), List.of()))
                        .toList();
        return new InstanceDetail(summary, vars, planItems, List.of(), open, List.of());
    }

    @PutMapping("/instances/{kind}/{id}/variables")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void setVariables(@PathVariable String kind, @PathVariable String id,
            @RequestBody Map<String, Object> variables) {
        access.writer("designer", "tenant_admin");
        requireRunning(kind, id);
        if ("process".equals(kind)) {
            runtime.setVariables(id, variables);
            // Conditional catch/boundary events wait on variables; re-check them after a change --
            // unless the change already ended the instance (e.g. a variable listener event fired),
            // where evaluating would fail and roll the whole update back.
            if (runtime.createProcessInstanceQuery().processInstanceId(id).count() > 0) {
                runtime.evaluateConditionalEvents(id);
            }
        } else {
            cmmnRuntime.setVariables(id, variables);
        }
    }

    @DeleteMapping("/instances/{kind}/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void terminate(@PathVariable String kind, @PathVariable String id,
            @RequestParam(defaultValue = "Terminated by tenant admin") String reason) {
        access.writer("tenant_admin");
        requireRunning(kind, id);
        if ("process".equals(kind)) {
            runtime.deleteProcessInstance(id, reason);
        } else {
            cmmnRuntime.terminateCaseInstance(id);
        }
    }

    // -------------------------------------------------------------- helpers

    /** Tenant-checked lookup; a different tenant's instance is reported as not found. */
    InstanceSummary summary(String kind, String id) {
        String tenant = access.tenantId();
        if ("process".equals(kind)) {
            HistoricProcessInstance p = history.createHistoricProcessInstanceQuery().processInstanceId(id)
                    .processInstanceTenantId(tenant).singleResult();
            if (p == null) {
                throw WorkAccess.notFound("Process instance");
            }
            return toSummary(p);
        }
        if ("case".equals(kind)) {
            HistoricCaseInstance c = cmmnHistory.createHistoricCaseInstanceQuery().caseInstanceId(id)
                    .caseInstanceTenantId(tenant).singleResult();
            if (c == null) {
                throw WorkAccess.notFound("Case instance");
            }
            return toSummary(c);
        }
        throw WorkAccess.notFound("Instance kind '" + kind + "'");
    }

    private void requireRunning(String kind, String id) {
        if (summary(kind, id).endTime() != null) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.CONFLICT,
                    "The instance has already ended.");
        }
    }

    private Map<String, Object> historicProcessVariables(String id) {
        Map<String, Object> vars = new java.util.TreeMap<>();
        history.createHistoricVariableInstanceQuery().processInstanceId(id).list()
                .forEach(v -> vars.put(v.getVariableName(), v.getValue()));
        return vars;
    }

    private Map<String, Object> historicCaseVariables(String id) {
        Map<String, Object> vars = new java.util.TreeMap<>();
        cmmnHistory.createHistoricVariableInstanceQuery().caseInstanceId(id).list()
                .forEach(v -> vars.put(v.getVariableName(), v.getValue()));
        return vars;
    }

    private static PlanItem toPlanItem(PlanItemInstance p) {
        return new PlanItem(p.getId(), p.getElementId(), p.getName(), p.getPlanItemDefinitionType(), p.getState(), p.getStageInstanceId(),
                PlanItemController.actionsFor(p.getPlanItemDefinitionType(), p.getState()));
    }

    private InstanceSummary toSummary(HistoricProcessInstance p) {
        String state = p.getEndTime() == null ? "active" : (p.getDeleteReason() == null ? "completed" : "terminated");
        return new InstanceSummary(p.getId(), "process", p.getProcessDefinitionId(), p.getProcessDefinitionKey(),
                p.getProcessDefinitionName(),
                p.getBusinessKey(), state, p.getStartUserId(), instant(p.getStartTime()), instant(p.getEndTime()),
                p.getBusinessStatus());
    }

    private InstanceSummary toSummary(HistoricCaseInstance c) {
        return new InstanceSummary(c.getId(), "case", c.getCaseDefinitionId(), c.getCaseDefinitionKey(),
                c.getCaseDefinitionName(),
                c.getBusinessKey(), c.getState(), c.getStartUserId(), instant(c.getStartTime()), instant(c.getEndTime()),
                c.getBusinessStatus());
    }
}
