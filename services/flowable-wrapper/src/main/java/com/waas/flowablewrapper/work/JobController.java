package com.waas.flowablewrapper.work;

import java.time.Instant;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.flowable.cmmn.api.CmmnManagementService;
import org.flowable.engine.ManagementService;
import org.flowable.job.api.Job;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Background jobs of the caller's tenant (tenant admins only): failed jobs
 * (out of retries), scheduled timers and jobs waiting to run, for both
 * engines. Failed jobs can be retried or deleted; a timer can be fired now.
 */
@RestController
@RequestMapping("/runtime/jobs")
public class JobController {

    public record JobSummary(String id, String state, String kind, String instanceId, String elementId, String elementName,
            String handler, int retries, Instant dueDate, Instant createTime, String exceptionMessage) {
    }

    private static final int RETRIES = 3;

    private final WorkAccess access;
    private final ManagementService management;
    private final CmmnManagementService cmmnManagement;

    JobController(WorkAccess access, ManagementService management, CmmnManagementService cmmnManagement) {
        this.access = access;
        this.management = management;
        this.cmmnManagement = cmmnManagement;
    }

    @GetMapping
    public List<JobSummary> list(@RequestParam(defaultValue = "failed") String state) {
        requireAdmin();
        String tenant = access.tenantId();
        Stream<Job> jobs = switch (state) {
            case "failed" -> Stream.concat(
                    management.createDeadLetterJobQuery().jobTenantId(tenant).list().stream(),
                    cmmnManagement.createDeadLetterJobQuery().jobTenantId(tenant).list().stream());
            case "timer" -> Stream.concat(
                    management.createTimerJobQuery().jobTenantId(tenant).list().stream(),
                    cmmnManagement.createTimerJobQuery().jobTenantId(tenant).list().stream());
            case "waiting" -> Stream.concat(
                    management.createJobQuery().jobTenantId(tenant).list().stream(),
                    cmmnManagement.createJobQuery().jobTenantId(tenant).list().stream());
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "state must be failed, timer or waiting.");
        };
        // Both engines read the same job tables, so a job can appear twice: keep one.
        Map<String, JobSummary> byId = new LinkedHashMap<>();
        jobs.forEach(j -> byId.putIfAbsent(j.getId(), toSummary(j, state)));
        return byId.values().stream()
                .sorted(Comparator.comparing(JobSummary::createTime, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    @GetMapping("/{id}/stacktrace")
    public Map<String, String> stacktrace(@PathVariable String id) {
        String trace = isCase(failedJob(id)) ? cmmnManagement.getDeadLetterJobExceptionStacktrace(id)
                : management.getDeadLetterJobExceptionStacktrace(id);
        return Map.of("stacktrace", String.valueOf(trace));
    }

    @PostMapping("/{id}/retry")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void retry(@PathVariable String id) {
        access.writer("tenant_admin");
        // Each engine runs its own jobs: act through the engine the job belongs to.
        if (isCase(failedJob(id))) {
            cmmnManagement.moveDeadLetterJobToExecutableJob(id, RETRIES);
        } else {
            management.moveDeadLetterJobToExecutableJob(id, RETRIES);
        }
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String id) {
        access.writer("tenant_admin");
        if (isCase(failedJob(id))) {
            cmmnManagement.deleteDeadLetterJob(id);
        } else {
            management.deleteDeadLetterJob(id);
        }
    }

    /** Fires a scheduled timer now (e.g. to test an SLA path); the executor runs it shortly. */
    @PostMapping("/{id}/fire")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void fireTimer(@PathVariable String id) {
        access.writer("tenant_admin");
        Job timer = management.createTimerJobQuery().jobId(id).jobTenantId(access.tenantId()).singleResult();
        if (timer == null) {
            timer = cmmnManagement.createTimerJobQuery().jobId(id).jobTenantId(access.tenantId()).singleResult();
        }
        if (timer == null) {
            throw WorkAccess.notFound("Timer");
        }
        if (isCase(timer)) {
            cmmnManagement.moveTimerToExecutableJob(id);
        } else {
            management.moveTimerToExecutableJob(id);
        }
    }

    // -------------------------------------------------------------- helpers

    private void requireAdmin() {
        if (!access.isTenantAdmin()) {
            throw WorkAccess.forbidden("Only tenant admins can see background jobs.");
        }
    }

    private Job failedJob(String id) {
        requireAdmin();
        Job job = management.createDeadLetterJobQuery().jobId(id).jobTenantId(access.tenantId()).singleResult();
        if (job == null) {
            job = cmmnManagement.createDeadLetterJobQuery().jobId(id).jobTenantId(access.tenantId()).singleResult();
        }
        if (job == null) {
            throw WorkAccess.notFound("Failed job");
        }
        return job;
    }

    private static boolean isCase(Job job) {
        return "cmmn".equals(job.getScopeType());
    }

    private static Instant instant(Date date) {
        return date == null ? null : date.toInstant();
    }

    private static JobSummary toSummary(Job job, String state) {
        boolean cmmn = "cmmn".equals(job.getScopeType());
        return new JobSummary(job.getId(), state, cmmn ? "case" : "process",
                cmmn ? job.getScopeId() : job.getProcessInstanceId(), job.getElementId(), job.getElementName(),
                job.getJobHandlerType(), job.getRetries(), instant(job.getDuedate()), instant(job.getCreateTime()),
                job.getExceptionMessage());
    }
}
