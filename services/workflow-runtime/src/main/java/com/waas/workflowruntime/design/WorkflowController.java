package com.waas.workflowruntime.design;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Workflows and their immutable versions (was direct Supabase CRUD in Designer/src/data/workflows.ts). */
@RestController
@RequestMapping("/runtime/design")
public class WorkflowController {

    private static final String[] AUTHORS = {"designer", "tenant_admin"};

    public record WorkflowSummary(UUID id, String definitionKey, String name, String description, String specType,
            String status, UUID currentVersionId, OffsetDateTime updatedAt, UUID createdBy) {
    }

    public record CreateWorkflowRequest(
            @NotBlank @Pattern(regexp = "^[a-zA-Z_][a-zA-Z0-9_-]*$") String definitionKey,
            @NotBlank String name,
            String description,
            @NotBlank @Pattern(regexp = "BPMN|CMMN|DMN") String specType,
            JsonNode graph,
            String xmlContent) {
    }

    public record SaveVersionRequest(@NotNull JsonNode graph, String xmlContent) {
    }

    public record WorkflowVersion(UUID workflowId, int versionNo, JsonNode graph, String xmlContent) {
    }

    private static final String SUMMARY_COLUMNS =
            "id, definition_key, name, description, spec_type, status, current_version_id, updated_at, created_by";

    private final DesignDb db;

    WorkflowController(DesignDb db) {
        this.db = db;
    }

    private static WorkflowSummary summary(ResultSet rs, int rowNum) throws SQLException {
        return new WorkflowSummary(rs.getObject("id", UUID.class), rs.getString("definition_key"),
                rs.getString("name"), rs.getString("description"), rs.getString("spec_type"),
                rs.getString("status"), rs.getObject("current_version_id", UUID.class),
                rs.getObject("updated_at", OffsetDateTime.class), rs.getObject("created_by", UUID.class));
    }

    @GetMapping("/workflows")
    public List<WorkflowSummary> list() {
        return db.jdbc.query("select " + SUMMARY_COLUMNS
                + " from public.workflows where tenant_id = ? order by updated_at desc",
                WorkflowController::summary, db.tenantId());
    }

    @GetMapping("/workflows/key-taken")
    public Map<String, Boolean> keyTaken(@RequestParam String key) {
        Boolean taken = db.jdbc.queryForObject(
                "select exists (select 1 from public.workflows where tenant_id = ? and definition_key = ?)",
                Boolean.class, db.tenantId(), key);
        return Map.of("taken", Boolean.TRUE.equals(taken));
    }

    @GetMapping("/workflows/{id}")
    public WorkflowSummary get(@PathVariable UUID id) {
        return db.jdbc.query("select " + SUMMARY_COLUMNS + " from public.workflows where id = ? and tenant_id = ?",
                WorkflowController::summary, id, db.tenantId())
                .stream().findFirst().orElseThrow(() -> DesignDb.notFound("Workflow"));
    }

    /** New or Import: the workflow row plus its first version, in one transaction. */
    @PostMapping("/workflows")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, UUID> create(@Valid @RequestBody CreateWorkflowRequest request) {
        DesignDb.Actor actor = db.writer(AUTHORS);
        UUID workflowId = db.jdbc.queryForObject("""
                insert into public.workflows (tenant_id, definition_key, name, description, spec_type, status, created_by)
                values (?, ?, ?, ?, ?, 'draft', ?) returning id""",
                UUID.class, actor.tenantId(), request.definitionKey(), request.name(), request.description(),
                request.specType(), actor.userId());
        JsonNode graph = request.graph() != null ? request.graph() : db.parseJson("{\"nodes\":[],\"edges\":[]}");
        Map<String, Object> version = insertVersion(actor, workflowId, graph, request.xmlContent());
        return Map.of("workflowId", workflowId, "versionId", (UUID) version.get("versionId"));
    }

    /** Save Version: freezes an immutable snapshot and advances current_version_id. */
    @PostMapping("/workflows/{id}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, Object> saveVersion(@PathVariable UUID id, @Valid @RequestBody SaveVersionRequest request) {
        DesignDb.Actor actor = db.writer(AUTHORS);
        Boolean inTenant = db.jdbc.queryForObject(
                "select exists (select 1 from public.workflows where id = ? and tenant_id = ?)",
                Boolean.class, id, actor.tenantId());
        if (!Boolean.TRUE.equals(inTenant)) {
            throw DesignDb.notFound("Workflow");
        }
        return insertVersion(actor, id, request.graph(), request.xmlContent());
    }

    private Map<String, Object> insertVersion(DesignDb.Actor actor, UUID workflowId, JsonNode graph, String xml) {
        // Lock the workflow row so two concurrent saves can't pick the same version_no.
        db.jdbc.queryForObject("select id from public.workflows where id = ? for update", UUID.class, workflowId);
        Integer versionNo = db.jdbc.queryForObject(
                "select coalesce(max(version_no), 0) + 1 from public.workflow_versions where workflow_id = ?",
                Integer.class, workflowId);
        UUID versionId = db.jdbc.queryForObject("""
                insert into public.workflow_versions (workflow_id, version_no, graph_json, xml_content, created_by)
                values (?, ?, ?::jsonb, ?, ?) returning id""",
                UUID.class, workflowId, versionNo, db.toJson(graph), xml == null ? "" : xml, actor.userId());
        db.jdbc.update("update public.workflows set current_version_id = ?, updated_at = now() where id = ?",
                versionId, workflowId);
        return Map.of("versionId", versionId, "versionNo", versionNo);
    }

    @GetMapping("/versions/{id}")
    public WorkflowVersion getVersion(@PathVariable UUID id) {
        return db.jdbc.query("""
                select v.workflow_id, v.version_no, v.graph_json::text as graph, v.xml_content
                from public.workflow_versions v join public.workflows w on w.id = v.workflow_id
                where v.id = ? and w.tenant_id = ?""",
                (rs, i) -> new WorkflowVersion(rs.getObject("workflow_id", UUID.class), rs.getInt("version_no"),
                        db.parseJson(rs.getString("graph")), rs.getString("xml_content")),
                id, db.tenantId())
                .stream().findFirst().orElseThrow(() -> DesignDb.notFound("Workflow version"));
    }

    @PostMapping("/workflows/{id}/archive")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void archive(@PathVariable UUID id) {
        DesignDb.Actor actor = db.writer(AUTHORS);
        int updated = db.jdbc.update(
                "update public.workflows set status = 'archived', updated_at = now() where id = ? and tenant_id = ?",
                id, actor.tenantId());
        if (updated == 0) {
            throw DesignDb.notFound("Workflow");
        }
    }

    @DeleteMapping("/workflows/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable UUID id) {
        DesignDb.Actor actor = db.writer("tenant_admin");
        int deleted = db.jdbc.update("delete from public.workflows where id = ? and tenant_id = ?",
                id, actor.tenantId());
        if (deleted == 0) {
            throw DesignDb.notFound("Workflow");
        }
    }
}
