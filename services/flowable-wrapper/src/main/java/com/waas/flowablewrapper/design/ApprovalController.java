package com.waas.flowablewrapper.design;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Design-time approvals. Only approval_requests is written here; the
 * sync_workflow_status_from_approval and audit triggers move workflows.status
 * and record the decision, as before.
 */
@RestController
@RequestMapping("/runtime/design/approvals")
public class ApprovalController {

    public record SubmitRequest(@NotNull UUID workflowId, @NotNull UUID versionId) {
    }

    public record DecisionRequest(@NotNull @Pattern(regexp = "approved|rejected") String decision, String comment) {
    }

    public record ApprovalRequest(UUID id, UUID workflowId, UUID versionId, String status, UUID requestedBy,
            OffsetDateTime requestedAt, UUID approverId, OffsetDateTime decidedAt, String comment,
            String workflowName, String definitionKey, String specType, Integer versionNo) {
    }

    private final DesignDb db;

    ApprovalController(DesignDb db) {
        this.db = db;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public void submit(@Valid @RequestBody SubmitRequest request) {
        DesignDb.Actor actor = db.writer("designer", "tenant_admin");
        Boolean valid = db.jdbc.queryForObject("""
                select exists (select 1 from public.workflow_versions v join public.workflows w on w.id = v.workflow_id
                               where v.id = ? and w.id = ? and w.tenant_id = ?)""",
                Boolean.class, request.versionId(), request.workflowId(), actor.tenantId());
        if (!Boolean.TRUE.equals(valid)) {
            throw DesignDb.notFound("Workflow version");
        }
        db.jdbc.update("""
                insert into public.approval_requests (tenant_id, workflow_id, version_id, requested_by)
                values (?, ?, ?, ?)""",
                actor.tenantId(), request.workflowId(), request.versionId(), actor.userId());
    }

    @GetMapping("/pending")
    public List<ApprovalRequest> pending() {
        return db.jdbc.query("""
                select a.id, a.workflow_id, a.version_id, a.status, a.requested_by, a.requested_at, a.approver_id,
                       a.decided_at, a.comment, w.name, w.definition_key, w.spec_type, v.version_no
                from public.approval_requests a
                join public.workflows w on w.id = a.workflow_id
                join public.workflow_versions v on v.id = a.version_id
                where a.tenant_id = ? and a.status = 'pending'
                order by a.requested_at""",
                (rs, i) -> new ApprovalRequest(rs.getObject("id", UUID.class), rs.getObject("workflow_id", UUID.class),
                        rs.getObject("version_id", UUID.class), rs.getString("status"),
                        rs.getObject("requested_by", UUID.class), rs.getObject("requested_at", OffsetDateTime.class),
                        rs.getObject("approver_id", UUID.class), rs.getObject("decided_at", OffsetDateTime.class),
                        rs.getString("comment"), rs.getString("name"), rs.getString("definition_key"),
                        rs.getString("spec_type"), rs.getInt("version_no")),
                db.tenantId());
    }

    /** Segregation of duties: an approver decides, but never on their own submission. */
    @PostMapping("/{id}/decision")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void decide(@PathVariable UUID id, @Valid @RequestBody DecisionRequest request) {
        DesignDb.Actor actor = db.writer("approver");
        List<UUID> requester = db.jdbc.query("""
                select requested_by from public.approval_requests
                where id = ? and tenant_id = ? and status = 'pending' for update""",
                (rs, i) -> rs.getObject("requested_by", UUID.class), id, actor.tenantId());
        if (requester.isEmpty()) {
            throw DesignDb.notFound("Pending approval request");
        }
        if (actor.userId().equals(requester.get(0))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You cannot decide on your own submission.");
        }
        db.jdbc.update("""
                update public.approval_requests
                set status = ?, approver_id = ?, decided_at = now(), comment = ?
                where id = ?""",
                request.decision(), actor.userId(), request.comment(), id);
    }
}
