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
 * The tenant's audit log. Most entries come from the design-time triggers
 * (policies.sql), so this moves with design-service. Members, invites and
 * the caller's profile moved to identity-service.
 */
@RestController
@RequestMapping("/design")
public class AuditController {

    public record AuditLogEntry(UUID id, UUID actorId, String actorEmail, String action, String entityType,
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
                select a.id, a.actor_id, p.email as actor_email, a.action, a.entity_type, a.entity_id,
                       a.before::text as before, a.after::text as after, a.occurred_at
                from public.audit_logs a left join public.profiles p on p.id = a.actor_id
                where a.tenant_id = ? order by a.occurred_at desc limit ?""",
                (rs, i) -> new AuditLogEntry(rs.getObject("id", UUID.class), rs.getObject("actor_id", UUID.class),
                        rs.getString("actor_email"), rs.getString("action"), rs.getString("entity_type"),
                        rs.getObject("entity_id", UUID.class), db.parseJson(rs.getString("before")),
                        db.parseJson(rs.getString("after")), rs.getObject("occurred_at", OffsetDateTime.class)),
                db.tenantId(), Math.min(Math.max(limit, 1), 500));
    }
}
