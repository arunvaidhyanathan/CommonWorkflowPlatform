package com.waas.design;

import java.util.Map;
import java.util.UUID;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Shared access checks for the design-time API (schema design). Every query
 * filters by the caller's tenant, and every write goes through
 * {@link #writer}, which checks the caller's role and active status with
 * identity-service (not the token, so a role change or deactivation applies
 * within the identity cache TTL).
 */
@Component
public class DesignDb {

    public record Actor(UUID userId, UUID tenantId, String role) {
    }

    final JdbcTemplate jdbc;
    final ObjectMapper json;
    private final IdentityClient identity;

    DesignDb(JdbcTemplate jdbc, ObjectMapper json, IdentityClient identity) {
        this.jdbc = jdbc;
        this.json = json;
        this.identity = identity;
    }

    public UUID tenantId() {
        return TenantContext.currentTenantId();
    }

    /**
     * For writes; call inside a transaction. Fails with 403 unless the caller
     * is an active member of their tenant with one of {@code roles}. Then sets
     * {@code request.jwt.claims} for the transaction so the audit and status
     * triggers (database/03-design.sql) record who acted.
     */
    public Actor writer(String... roles) {
        IdentityClient.Actor actor = identity.requireActive(roles);
        Map<String, Object> claims = Map.of(
                "sub", actor.userId().toString(),
                "app_metadata", Map.of("tenant_id", actor.tenantId().toString(), "role", actor.role()));
        jdbc.queryForObject("select set_config('request.jwt.claims', ?, true)", String.class, toJson(claims));
        return new Actor(actor.userId(), actor.tenantId(), actor.role());
    }

    String toJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JacksonException e) {
            throw new IllegalArgumentException("Could not serialize JSON", e);
        }
    }

    JsonNode parseJson(String value) {
        try {
            return value == null ? null : json.readTree(value);
        } catch (JacksonException e) {
            throw new IllegalArgumentException("Stored JSON is invalid", e);
        }
    }

    static ResponseStatusException forbidden(String message) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }

    static ResponseStatusException notFound(String what) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, what + " not found.");
    }
}
