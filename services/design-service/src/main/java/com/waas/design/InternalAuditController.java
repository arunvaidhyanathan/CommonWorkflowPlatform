package com.waas.design;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import tools.jackson.databind.JsonNode;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Audit entries from other services (identity-service's role and status
 * changes), so the tenant keeps one audit log. Never routed by the gateway;
 * callers present the shared internal token. Fails closed: with no token
 * configured, every call is refused.
 */
@RestController
@RequestMapping("/internal/design")
public class InternalAuditController {

    public record AuditEvent(@NotNull UUID tenantId, @NotNull UUID actorId, @NotBlank String action,
            @NotBlank String entityType, @NotNull UUID entityId, JsonNode before, JsonNode after) {
    }

    private final DesignDb db;
    private final byte[] internalToken;

    InternalAuditController(DesignDb db, @Value("${cwp.internal-token:}") String internalToken) {
        this.db = db;
        this.internalToken = internalToken.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/audit")
    @ResponseStatus(HttpStatus.CREATED)
    public void record(@RequestHeader(value = "X-Internal-Token", required = false) String token,
            @Valid @RequestBody AuditEvent event) {
        if (internalToken.length == 0 || token == null
                || !MessageDigest.isEqual(internalToken, token.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal token required.");
        }
        db.jdbc.update("""
                insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
                values (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)""",
                event.tenantId(), event.actorId(), event.action(), event.entityType(), event.entityId(),
                event.before() == null ? null : event.before().toString(),
                event.after() == null ? null : event.after().toString());
    }
}
