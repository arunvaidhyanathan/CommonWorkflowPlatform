package com.waas.workflowruntime.work;

import java.util.ArrayList;
import java.util.List;

import org.flowable.engine.RuntimeService;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.eventsubscription.api.EventSubscription;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Case-worker actions on a running BPMN process that the engine is waiting
 * on (#10):
 * <ul>
 * <li>{@code adhoc/{activityId}}: start an activity of an ad-hoc sub-process</li>
 * <li>{@code signal/{name}} / {@code message/{name}}: deliver a signal or
 *     message the instance subscribes to (e.g. an event sub-process start)</li>
 * </ul>
 * {@link #waitingOn} lists what applies, for the instance detail. Signals are
 * delivered to this instance only, never broadcast across tenants.
 */
@RestController
@RequestMapping("/runtime/instances/process/{id}")
public class ProcessEventController {

    public record Waiting(String kind, String name, String executionId, String activityId) {
    }

    private final WorkAccess access;
    private final RuntimeService runtime;

    ProcessEventController(WorkAccess access, RuntimeService runtime) {
        this.access = access;
        this.runtime = runtime;
    }

    /** Ad-hoc activities that can be started, and signals/messages the instance waits for. */
    static List<Waiting> waitingOn(RuntimeService runtime, String processInstanceId) {
        List<Waiting> waiting = new ArrayList<>();
        for (Execution e : runtime.createExecutionQuery().processInstanceId(processInstanceId).list()) {
            if (e.getActivityId() == null || e.getParentId() == null) {
                continue;
            }
            try {
                runtime.getEnabledActivitiesFromAdhocSubProcess(e.getId()).forEach(a ->
                        waiting.add(new Waiting("adhoc", a.getName() != null ? a.getName() : a.getId(), e.getId(), a.getId())));
            } catch (org.flowable.common.engine.api.FlowableException notAdhoc) {
                // not an ad-hoc sub-process execution
            }
        }
        for (EventSubscription s : runtime.createEventSubscriptionQuery().processInstanceId(processInstanceId).list()) {
            if ("signal".equals(s.getEventType()) || "message".equals(s.getEventType())) {
                waiting.add(new Waiting(s.getEventType(), s.getEventName(), s.getExecutionId(), s.getActivityId()));
            }
        }
        return waiting;
    }

    @PostMapping("/adhoc/{activityId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void startAdhoc(@PathVariable String id, @PathVariable String activityId) {
        Waiting item = find(id, "adhoc", activityId, w -> w.activityId());
        runtime.executeActivityInAdhocSubProcess(item.executionId(), activityId);
    }

    @PostMapping("/signal/{name}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void signal(@PathVariable String id, @PathVariable String name) {
        Waiting item = find(id, "signal", name, Waiting::name);
        runtime.signalEventReceived(name, item.executionId());
    }

    @PostMapping("/message/{name}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void message(@PathVariable String id, @PathVariable String name) {
        Waiting item = find(id, "message", name, Waiting::name);
        runtime.messageEventReceived(name, item.executionId());
    }

    private Waiting find(String id, String kind, String key, java.util.function.Function<Waiting, String> keyOf) {
        access.writer(WorkAccess.PARTICIPANTS);
        ProcessInstance instance = runtime.createProcessInstanceQuery().processInstanceId(id)
                .processInstanceTenantId(access.tenantId()).singleResult();
        if (instance == null) {
            throw WorkAccess.notFound("Running process instance");
        }
        return waitingOn(runtime, id).stream().filter(w -> w.kind().equals(kind) && key.equals(keyOf.apply(w)))
                .findFirst().orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(
                        HttpStatus.CONFLICT, "The instance is not waiting for " + kind + " '" + key + "'."));
    }
}
