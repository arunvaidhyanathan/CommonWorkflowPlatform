package com.waas.flowablewrapper.work;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import org.flowable.batch.api.Batch;
import org.flowable.batch.api.BatchPart;
import org.flowable.cmmn.api.CmmnManagementService;
import org.flowable.cmmn.api.CmmnMigrationService;
import org.flowable.cmmn.api.CmmnRepositoryService;
import org.flowable.cmmn.api.CmmnRuntimeService;
import org.flowable.cmmn.api.migration.CaseInstanceMigrationBuilder;
import org.flowable.cmmn.api.migration.PlanItemDefinitionMappingBuilder;
import org.flowable.engine.ManagementService;
import org.flowable.engine.ProcessMigrationService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.migration.ActivityMigrationMapping;
import org.flowable.engine.migration.ProcessInstanceMigrationBuilder;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Moving running instances to another version of their definition
 * (tenant admins only):
 * <ul>
 * <li>{@code GET /runtime/definitions/{kind}/{key}/versions}: versions with running-instance counts</li>
 * <li>{@code POST /runtime/migrations/validate}: what would go wrong, per instance, without changing anything</li>
 * <li>{@code POST /runtime/migrations}: migrate the listed instances now, in one transaction (all or none)</li>
 * <li>{@code POST /runtime/migrations/batch}: migrate every instance of a version asynchronously
 *     via Flowable's batch service; poll {@code GET /runtime/migrations/batches/{kind}/{id}}</li>
 * </ul>
 * Without mappings, elements are matched by id. Process mappings move a
 * token from one activity id to another; case mappings activate or
 * terminate plan item definitions, and {@code autoCreateNewPlanItems} creates
 * instances for plan items that only exist in the target version.
 */
@RestController
@RequestMapping("/runtime")
public class MigrationController {

    public record VersionSummary(String definitionId, int version, long runningInstances) {
    }

    public record ActivityMapping(@NotBlank String from, @NotBlank String to) {
    }

    public record MigrationRequest(
            @NotNull @Pattern(regexp = "process|case") String kind,
            List<String> instanceIds,
            String sourceDefinitionId,
            @NotBlank String targetKey,
            @NotNull @Min(1) Integer targetVersion,
            List<@Valid ActivityMapping> activityMappings,
            List<String> activatePlanItems,
            List<String> terminatePlanItems,
            Boolean autoCreateNewPlanItems) {
    }

    public record InstanceValidation(String instanceId, boolean valid, List<String> messages) {
    }

    public record ValidationReport(boolean valid, List<InstanceValidation> instances) {
    }

    public record BatchStatus(String id, String kind, String status, Instant createTime, Instant completeTime,
            Map<String, Long> partsByStatus) {
    }

    private final WorkAccess access;
    private final RepositoryService repository;
    private final RuntimeService runtime;
    private final ProcessMigrationService processMigration;
    private final ManagementService management;
    private final CmmnRepositoryService cmmnRepository;
    private final CmmnRuntimeService cmmnRuntime;
    private final CmmnMigrationService caseMigration;
    private final CmmnManagementService cmmnManagement;

    MigrationController(WorkAccess access, RepositoryService repository, RuntimeService runtime,
            ProcessMigrationService processMigration, ManagementService management,
            CmmnRepositoryService cmmnRepository, CmmnRuntimeService cmmnRuntime,
            CmmnMigrationService caseMigration, CmmnManagementService cmmnManagement) {
        this.access = access;
        this.repository = repository;
        this.runtime = runtime;
        this.processMigration = processMigration;
        this.management = management;
        this.cmmnRepository = cmmnRepository;
        this.cmmnRuntime = cmmnRuntime;
        this.caseMigration = caseMigration;
        this.cmmnManagement = cmmnManagement;
    }

    @GetMapping("/definitions/{kind}/{key}/versions")
    public List<VersionSummary> versions(@PathVariable String kind, @PathVariable String key) {
        String tenant = access.tenantId();
        if ("process".equals(kind)) {
            return repository.createProcessDefinitionQuery().processDefinitionKey(key).processDefinitionTenantId(tenant)
                    .orderByProcessDefinitionVersion().desc().list().stream()
                    .map(d -> new VersionSummary(d.getId(), d.getVersion(),
                            runtime.createProcessInstanceQuery().processDefinitionId(d.getId()).count()))
                    .toList();
        }
        if ("case".equals(kind)) {
            return cmmnRepository.createCaseDefinitionQuery().caseDefinitionKey(key).caseDefinitionTenantId(tenant)
                    .orderByCaseDefinitionVersion().desc().list().stream()
                    .map(d -> new VersionSummary(d.getId(), d.getVersion(),
                            cmmnRuntime.createCaseInstanceQuery().caseDefinitionId(d.getId()).count()))
                    .toList();
        }
        throw WorkAccess.notFound("Definition kind '" + kind + "'");
    }

    @PostMapping("/migrations/validate")
    public ValidationReport validate(@Valid @RequestBody MigrationRequest request) {
        requireAdmin();
        List<InstanceValidation> results = new ArrayList<>();
        for (String id : instances(request)) {
            List<String> messages = "process".equals(request.kind())
                    ? processBuilder(request).validateMigration(id).getValidationMessages()
                    : caseBuilder(request).validateMigration(id).getValidationMessages();
            results.add(new InstanceValidation(id, messages.isEmpty(), messages));
        }
        return new ValidationReport(results.stream().allMatch(InstanceValidation::valid), results);
    }

    /** Validates every instance first and migrates only if all are valid; one transaction, so all or none. */
    @PostMapping("/migrations")
    @Transactional
    public Map<String, Object> migrate(@Valid @RequestBody MigrationRequest request) {
        access.writer("tenant_admin");
        ValidationReport report = validate(request);
        if (!report.valid()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Migration is not valid: "
                    + report.instances().stream().filter(i -> !i.valid())
                            .map(i -> i.instanceId() + ": " + String.join("; ", i.messages()))
                            .collect(Collectors.joining(" | ")));
        }
        for (InstanceValidation instance : report.instances()) {
            if ("process".equals(request.kind())) {
                processBuilder(request).migrate(instance.instanceId());
            } else {
                caseBuilder(request).migrate(instance.instanceId());
            }
        }
        return Map.of("migrated", report.instances().size());
    }

    @PostMapping("/migrations/batch")
    @Transactional
    public BatchStatus batch(@Valid @RequestBody MigrationRequest request) {
        access.writer("tenant_admin");
        String source = requireSource(request);
        Batch batch = "process".equals(request.kind())
                ? processBuilder(request).batchMigrateProcessInstances(source)
                : caseBuilder(request).batchMigrateCaseInstances(source);
        return status(request.kind(), batch.getId());
    }

    @GetMapping("/migrations/batches/{kind}/{id}")
    public BatchStatus batchStatus(@PathVariable String kind, @PathVariable String id) {
        requireAdmin();
        return status(kind, id);
    }

    // -------------------------------------------------------------- helpers

    private BatchStatus status(String kind, String id) {
        boolean process = "process".equals(kind);
        Batch batch = process ? management.createBatchQuery().batchId(id).singleResult()
                : cmmnManagement.createBatchQuery().batchId(id).singleResult();
        if (batch == null || !access.tenantId().equals(batch.getTenantId())) {
            throw WorkAccess.notFound("Batch");
        }
        List<BatchPart> parts = process ? management.createBatchPartQuery().batchId(id).list()
                : cmmnManagement.createBatchPartQuery().batchId(id).list();
        Map<String, Long> byStatus = parts.stream().collect(Collectors.groupingBy(
                p -> p.getStatus() == null ? "waiting" : p.getStatus(), LinkedHashMap::new, Collectors.counting()));
        // Flowable marks the batch itself complete from a periodic status job (about once a
        // minute); report it complete as soon as every part has finished instead.
        boolean partsDone = !parts.isEmpty() && parts.stream().allMatch(p -> p.getCompleteTime() != null);
        Instant completeTime = batch.getCompleteTime() != null ? instant(batch.getCompleteTime())
                : partsDone ? parts.stream().map(p -> p.getCompleteTime().toInstant()).max(Comparator.naturalOrder()).orElse(null)
                : null;
        String status = batch.getCompleteTime() == null && partsDone ? "completed" : batch.getStatus();
        return new BatchStatus(batch.getId(), kind, status, instant(batch.getCreateTime()), completeTime, byStatus);
    }

    private static Instant instant(java.util.Date date) {
        return date == null ? null : date.toInstant();
    }

    private void requireAdmin() {
        if (!access.isTenantAdmin()) {
            throw WorkAccess.forbidden("Only tenant admins can migrate instances.");
        }
    }

    /** The instances to act on: the listed ones, or every running instance of the source definition. */
    private List<String> instances(MigrationRequest request) {
        String tenant = access.tenantId();
        boolean process = "process".equals(request.kind());
        if (request.instanceIds() != null && !request.instanceIds().isEmpty()) {
            Function<String, Boolean> inTenant = process
                    ? id -> runtime.createProcessInstanceQuery().processInstanceId(id).processInstanceTenantId(tenant).count() == 1
                    : id -> cmmnRuntime.createCaseInstanceQuery().caseInstanceId(id).caseInstanceTenantId(tenant).count() == 1;
            for (String id : request.instanceIds()) {
                if (!inTenant.apply(id)) {
                    throw WorkAccess.notFound("Running instance " + id);
                }
            }
            return request.instanceIds();
        }
        String source = requireSource(request);
        return process
                ? runtime.createProcessInstanceQuery().processDefinitionId(source).processInstanceTenantId(tenant).list()
                        .stream().map(p -> p.getId()).sorted(Comparator.naturalOrder()).toList()
                : cmmnRuntime.createCaseInstanceQuery().caseDefinitionId(source).caseInstanceTenantId(tenant).list()
                        .stream().map(c -> c.getId()).sorted(Comparator.naturalOrder()).toList();
    }

    /** The source definition must belong to the caller's tenant. */
    private String requireSource(MigrationRequest request) {
        String source = request.sourceDefinitionId();
        if (source == null || source.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Give instanceIds or a sourceDefinitionId.");
        }
        String tenant = access.tenantId();
        long found = "process".equals(request.kind())
                ? repository.createProcessDefinitionQuery().processDefinitionId(source).processDefinitionTenantId(tenant).count()
                : cmmnRepository.createCaseDefinitionQuery().caseDefinitionId(source).caseDefinitionTenantId(tenant).count();
        if (found == 0) {
            throw WorkAccess.notFound("Source definition");
        }
        return source;
    }

    private ProcessInstanceMigrationBuilder processBuilder(MigrationRequest request) {
        ProcessInstanceMigrationBuilder builder = processMigration.createProcessInstanceMigrationBuilder()
                .migrateToProcessDefinition(request.targetKey(), request.targetVersion(), access.tenantId());
        if (request.activityMappings() != null) {
            request.activityMappings().forEach(m ->
                    builder.addActivityMigrationMapping(ActivityMigrationMapping.createMappingFor(m.from(), m.to())));
        }
        return builder;
    }

    private CaseInstanceMigrationBuilder caseBuilder(MigrationRequest request) {
        CaseInstanceMigrationBuilder builder = caseMigration.createCaseInstanceMigrationBuilder()
                .migrateToCaseDefinition(request.targetKey(), request.targetVersion(), access.tenantId());
        if (request.activatePlanItems() != null) {
            request.activatePlanItems().forEach(id -> builder.addActivatePlanItemDefinitionMapping(
                    PlanItemDefinitionMappingBuilder.createActivatePlanItemDefinitionMappingFor(id)));
        }
        if (request.terminatePlanItems() != null) {
            request.terminatePlanItems().forEach(id -> builder.addTerminatePlanItemDefinitionMapping(
                    PlanItemDefinitionMappingBuilder.createTerminatePlanItemDefinitionMappingFor(id)));
        }
        if (Boolean.TRUE.equals(request.autoCreateNewPlanItems())) {
            builder.enableAutomaticPlanItemInstanceCreation();
        }
        return builder;
    }
}
