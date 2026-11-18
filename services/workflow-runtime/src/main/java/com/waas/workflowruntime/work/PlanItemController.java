package com.waas.workflowruntime.work;

import java.util.List;

import org.flowable.cmmn.api.CmmnRuntimeService;
import org.flowable.cmmn.api.runtime.PlanItemDefinitionType;
import org.flowable.cmmn.api.runtime.PlanItemInstance;
import org.flowable.cmmn.api.runtime.PlanItemInstanceState;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Case-worker actions on CMMN plan items:
 * <ul>
 * <li>{@code start}: start a manually activated item (state enabled)</li>
 * <li>{@code disable} / {@code enable}: set an offered item aside, or offer it again</li>
 * <li>{@code trigger}: fire a user event listener (state available)</li>
 * </ul>
 * {@link #actionsFor} is the single source of which actions apply in which
 * state, used both to validate requests and to tell the UI what to offer.
 */
@RestController
@RequestMapping("/runtime/plan-items")
public class PlanItemController {

    private final WorkAccess access;
    private final CmmnRuntimeService cmmnRuntime;

    PlanItemController(WorkAccess access, CmmnRuntimeService cmmnRuntime) {
        this.access = access;
        this.cmmnRuntime = cmmnRuntime;
    }

    static List<String> actionsFor(String type, String state) {
        if (PlanItemDefinitionType.USER_EVENT_LISTENER.equals(type)) {
            return PlanItemInstanceState.AVAILABLE.equals(state) ? List.of("trigger") : List.of();
        }
        return switch (state) {
            case PlanItemInstanceState.ENABLED -> List.of("start", "disable");
            case PlanItemInstanceState.DISABLED -> List.of("enable");
            default -> List.of();
        };
    }

    @PostMapping("/{id}/{action}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void act(@PathVariable String id, @PathVariable String action) {
        access.writer(WorkAccess.PARTICIPANTS);
        PlanItemInstance item = cmmnRuntime.createPlanItemInstanceQuery().planItemInstanceId(id)
                .planItemInstanceTenantId(access.tenantId()).singleResult();
        if (item == null) {
            throw WorkAccess.notFound("Plan item");
        }
        if (!actionsFor(item.getPlanItemDefinitionType(), item.getState()).contains(action)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Cannot " + action + " '" + item.getName() + "' while it is " + item.getState() + ".");
        }
        switch (action) {
            case "start" -> cmmnRuntime.startPlanItemInstance(id);
            case "disable" -> cmmnRuntime.disablePlanItemInstance(id);
            case "enable" -> cmmnRuntime.enablePlanItemInstance(id);
            case "trigger" -> cmmnRuntime.completeUserEventListenerInstance(id);
            default -> throw new IllegalArgumentException(action);
        }
    }
}
