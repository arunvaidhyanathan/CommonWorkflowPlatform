package com.waas.flowablewrapper.work;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

import org.flowable.cmmn.api.CmmnHistoryService;
import org.flowable.cmmn.api.CmmnRuntimeService;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.history.HistoricActivityInstance;
import org.flowable.engine.history.HistoricDetail;
import org.flowable.engine.history.HistoricVariableUpdate;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * History and audit for one instance (#11):
 * <ul>
 * <li>{@code timeline}: every step in order -- BPMN activities, or CMMN plan
 *     items with when they became available, started and ended -- plus, at
 *     history level "full", each variable change</li>
 * <li>{@code business-status}: Flowable 8's business status, a short label a
 *     case worker sets ("Awaiting documents") that shows on the instance and
 *     is kept in history</li>
 * </ul>
 */
@RestController
@RequestMapping("/runtime/instances/{kind}/{id}")
public class HistoryController {

    public record TimelineEntry(Instant time, String what, String elementId, String name, String type, String detail,
            String userId) {
    }

    public record BusinessStatusRequest(@Size(max = 255) String status) {
    }

    private final InstanceController instances;
    private final WorkAccess access;
    private final HistoryService history;
    private final RuntimeService runtime;
    private final CmmnHistoryService cmmnHistory;
    private final CmmnRuntimeService cmmnRuntime;

    HistoryController(InstanceController instances, WorkAccess access, HistoryService history, RuntimeService runtime,
            CmmnHistoryService cmmnHistory, CmmnRuntimeService cmmnRuntime) {
        this.instances = instances;
        this.access = access;
        this.history = history;
        this.runtime = runtime;
        this.cmmnHistory = cmmnHistory;
        this.cmmnRuntime = cmmnRuntime;
    }

    private static Instant instant(Date date) {
        return date == null ? null : date.toInstant();
    }

    @GetMapping("/timeline")
    public List<TimelineEntry> timeline(@PathVariable String kind, @PathVariable String id) {
        instances.summary(kind, id); // tenant check
        List<TimelineEntry> entries = new ArrayList<>();
        if ("process".equals(kind)) {
            for (HistoricActivityInstance a : history.createHistoricActivityInstanceQuery().processInstanceId(id).list()) {
                if ("sequenceFlow".equals(a.getActivityType())) {
                    continue;
                }
                entries.add(new TimelineEntry(instant(a.getStartTime()), "started", a.getActivityId(), a.getActivityName(),
                        a.getActivityType(), null, a.getAssignee()));
                if (a.getEndTime() != null) {
                    entries.add(new TimelineEntry(instant(a.getEndTime()), a.getDeleteReason() == null ? "completed" : "cancelled",
                            a.getActivityId(), a.getActivityName(), a.getActivityType(), a.getDeleteReason(), a.getAssignee()));
                }
            }
            for (HistoricDetail d : history.createHistoricDetailQuery().processInstanceId(id).variableUpdates().list()) {
                HistoricVariableUpdate v = (HistoricVariableUpdate) d;
                entries.add(new TimelineEntry(instant(d.getTime()), "variable", null, v.getVariableName(), "variable",
                        String.valueOf(v.getValue()), null));
            }
        } else {
            cmmnHistory.createHistoricPlanItemInstanceQuery().planItemInstanceCaseInstanceId(id).list().forEach(p -> {
                record Step(Date at, String what) {
                }
                for (Step s : List.of(new Step(p.getLastAvailableTime(), "available"), new Step(p.getLastEnabledTime(), "offered"),
                        new Step(p.getLastStartedTime(), "started"), new Step(p.getOccurredTime(), "occurred"),
                        new Step(p.getCompletedTime(), "completed"), new Step(p.getTerminatedTime(), "terminated"),
                        new Step(p.getExitTime(), "exited"))) {
                    if (s.at() != null) {
                        entries.add(new TimelineEntry(instant(s.at()), s.what(), p.getElementId(), p.getName(),
                                p.getPlanItemDefinitionType(), null, null));
                    }
                }
            });
        }
        entries.sort(Comparator.comparing(TimelineEntry::time, Comparator.nullsLast(Comparator.naturalOrder())));
        return entries;
    }

    @PutMapping("/business-status")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void businessStatus(@PathVariable String kind, @PathVariable String id,
            @Valid @RequestBody BusinessStatusRequest request) {
        access.writer(WorkAccess.PARTICIPANTS);
        if (instances.summary(kind, id).endTime() != null) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.CONFLICT, "The instance has already ended.");
        }
        if ("process".equals(kind)) {
            runtime.updateBusinessStatus(id, request.status());
        } else {
            cmmnRuntime.updateBusinessStatus(id, request.status());
        }
    }

    @GetMapping("/business-status")
    public Map<String, String> getBusinessStatus(@PathVariable String kind, @PathVariable String id) {
        String status = "process".equals(kind)
                ? history.createHistoricProcessInstanceQuery().processInstanceId(id)
                        .processInstanceTenantId(access.tenantId()).singleResult().getBusinessStatus()
                : cmmnHistory.createHistoricCaseInstanceQuery().caseInstanceId(id)
                        .caseInstanceTenantId(access.tenantId()).singleResult().getBusinessStatus();
        return java.util.Collections.singletonMap("status", status);
    }
}
