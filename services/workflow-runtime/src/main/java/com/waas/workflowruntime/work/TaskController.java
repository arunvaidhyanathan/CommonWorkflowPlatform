package com.waas.workflowruntime.work;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.flowable.cmmn.api.CmmnTaskService;
import org.flowable.engine.TaskService;
import org.flowable.identitylink.api.IdentityLink;
import org.flowable.task.api.Task;
import org.flowable.task.api.TaskQuery;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The task inbox for BPMN and CMMN human tasks. Members see tasks assigned
 * to them ({@code mine}) and unassigned tasks offered to them or their
 * groups ({@code available}); tenant admins can also list {@code all}.
 * CMMN tasks are completed through the CMMN task service so sentries fire.
 */
@RestController
@RequestMapping("/runtime/tasks")
public class TaskController {

    public record TaskSummary(String id, String name, String description, String assignee, List<String> candidateGroups,
            String formKey, int priority, Instant createTime, Instant dueDate, String kind, String instanceId) {
    }

    public record TaskDetail(TaskSummary task, Map<String, Object> variables, boolean canClaim, boolean canComplete) {
    }

    private final WorkAccess access;
    private final TaskService tasks;
    private final CmmnTaskService cmmnTasks;

    TaskController(WorkAccess access, TaskService tasks, CmmnTaskService cmmnTasks) {
        this.access = access;
        this.tasks = tasks;
        this.cmmnTasks = cmmnTasks;
    }

    @GetMapping
    public List<TaskSummary> list(@RequestParam(defaultValue = "mine") String filter) {
        TaskQuery query = tasks.createTaskQuery().taskTenantId(access.tenantId());
        switch (filter) {
            case "mine" -> query.taskAssignee(access.userId());
            // Groups come from CWP (group_members + role), not Flowable IDM, so match them explicitly.
            case "available" -> query.taskUnassigned().or().taskCandidateUser(access.userId())
                    .taskCandidateGroupIn(access.groups()).endOr();
            case "all" -> {
                if (!access.isTenantAdmin()) {
                    throw WorkAccess.forbidden("Only tenant admins can list all tasks.");
                }
            }
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "filter must be mine, available or all.");
        }
        return query.orderByTaskCreateTime().desc().listPage(0, 200).stream().map(this::toSummary).toList();
    }

    @GetMapping("/{id}")
    public TaskDetail detail(@PathVariable String id) {
        Task task = find(id);
        List<IdentityLink> links = tasks.getIdentityLinksForTask(id);
        boolean involved = access.isTenantAdmin() || access.isCandidateOrAssignee(task.getAssignee(), links);
        if (!involved) {
            throw WorkAccess.notFound("Task");
        }
        Map<String, Object> variables = isCase(task) ? cmmnTasks.getVariables(id) : tasks.getVariables(id);
        boolean mine = access.userId().equals(task.getAssignee());
        return new TaskDetail(toSummary(task), variables, task.getAssignee() == null, mine || task.getAssignee() == null);
    }

    @PostMapping("/{id}/claim")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void claim(@PathVariable String id) {
        var actor = access.writer(WorkAccess.PARTICIPANTS);
        Task task = actionable(id);
        if (task.getAssignee() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The task is already claimed.");
        }
        tasks.claim(id, actor.userId().toString());
    }

    @PostMapping("/{id}/unclaim")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void unclaim(@PathVariable String id) {
        var actor = access.writer(WorkAccess.PARTICIPANTS);
        Task task = actionable(id);
        if (!actor.userId().toString().equals(task.getAssignee()) && !"tenant_admin".equals(actor.role())) {
            throw WorkAccess.forbidden("Only the assignee or a tenant admin can release a task.");
        }
        tasks.unclaim(id);
    }

    /** Completes a task the caller holds; an unassigned task they could claim is claimed first. */
    @PostMapping("/{id}/complete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void complete(@PathVariable String id, @RequestBody(required = false) Map<String, Object> variables) {
        var actor = access.writer(WorkAccess.PARTICIPANTS);
        String me = actor.userId().toString();
        Task task = actionable(id);
        if (task.getAssignee() == null) {
            tasks.claim(id, me);
        } else if (!me.equals(task.getAssignee())) {
            throw WorkAccess.forbidden("This task is claimed by someone else.");
        }
        Map<String, Object> vars = variables == null ? Map.of() : variables;
        if (isCase(task)) {
            cmmnTasks.complete(id, vars);
        } else {
            tasks.complete(id, vars);
        }
    }

    // -------------------------------------------------------------- helpers

    private Task find(String id) {
        Task task = tasks.createTaskQuery().taskId(id).taskTenantId(access.tenantId()).singleResult();
        if (task == null) {
            throw WorkAccess.notFound("Task");
        }
        return task;
    }

    /** A task the caller may act on: offered to them, held by them, or any task for a tenant admin. */
    private Task actionable(String id) {
        Task task = find(id);
        if (!access.isTenantAdmin()
                && !access.isCandidateOrAssignee(task.getAssignee(), tasks.getIdentityLinksForTask(id))) {
            throw WorkAccess.notFound("Task");
        }
        return task;
    }

    private static boolean isCase(Task task) {
        return "cmmn".equals(task.getScopeType());
    }

    private TaskSummary toSummary(Task task) {
        List<String> groups = tasks.getIdentityLinksForTask(task.getId()).stream()
                .filter(l -> "candidate".equals(l.getType()) && l.getGroupId() != null)
                .map(IdentityLink::getGroupId).toList();
        boolean cmmn = isCase(task);
        return new TaskSummary(task.getId(), task.getName(), task.getDescription(), task.getAssignee(), groups,
                task.getFormKey(), task.getPriority(),
                task.getCreateTime() == null ? null : task.getCreateTime().toInstant(),
                task.getDueDate() == null ? null : task.getDueDate().toInstant(),
                cmmn ? "case" : "process", cmmn ? task.getScopeId() : task.getProcessInstanceId());
    }
}
