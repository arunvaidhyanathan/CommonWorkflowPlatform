package com.waas.design;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The tenant's audit log. Design-time entries come from the triggers in
* database/03-design.sql; identity-service's (role and status changes) arrive through
 * InternalAuditController. Actors are ids only: user details are
 * identity-service's.
 */
@RestController
@RequestMapping("/design")
public class AuditController {

    public record AuditLogEntry(UUID id, UUID actorId, String action, String entityType,
            UUID entityId, JsonNode before, JsonNode after, OffsetDateTime occurredAt) {
    }

    private final DesignDb db;

    AuditController(DesignDb db) {
        this.db = db;
    }

    @GetMapping("/audit")
    public List<AuditLogEntry> audit(@RequestParam(defaultValue = "100") int limit) {
        // Mirrors the old RLS read policy, which checked the token's role claim.
        if (!"tenant_admin".equals(TenantContext.currentRole())) {
            throw DesignDb.forbidden("Only tenant admins can see this.");
        }
        return db.jdbc.query("""
                select id, actor_id, action, entity_type, entity_id,
                       before::text as before, after::text as after, occurred_at
                from design.audit_logs
                where tenant_id = ? order by occurred_at desc limit ?""",
                (rs, i) -> new AuditLogEntry(rs.getObject("id", UUID.class), rs.getObject("actor_id", UUID.class),
                        rs.getString("action"), rs.getString("entity_type"),
                        rs.getObject("entity_id", UUID.class), db.parseJson(rs.getString("before")),
                        db.parseJson(rs.getString("after")), rs.getObject("occurred_at", OffsetDateTime.class)),
                db.tenantId(), Math.min(Math.max(limit, 1), 500));
    }
}
