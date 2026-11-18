package com.waas.identity;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Access checks for identity writes. Role and active status are read from
 * {@code profiles}, not the token, so a role change or deactivation applies
 * at once.
 */
@Component
public class IdentityDb {

    public record Actor(UUID userId, UUID tenantId, String role) {
    }

    final JdbcTemplate jdbc;
    private final ObjectMapper json;

    IdentityDb(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * For writes; call inside a transaction. Fails with 403 unless the caller
     * is an active member of their tenant with one of {@code roles}. Then sets
     * {@code request.jwt.claims} for the transaction so the audit trigger on
     * profiles (policies.sql) records who acted.
     */
    Actor writer(String... roles) {
        UUID userId = TenantContext.currentUserId();
        UUID tenantId = TenantContext.currentTenantId();
        Map<String, Object> profile;
        try {
            profile = jdbc.queryForMap(
                    "select role, status from public.profiles where id = ? and tenant_id = ?", userId, tenantId);
        } catch (EmptyResultDataAccessException e) {
            throw forbidden("You are not a member of this tenant.");
        }
        if (!"active".equals(profile.get("status"))) {
            throw forbidden("Your account is deactivated.");
        }
        String role = (String) profile.get("role");
        if (!List.of(roles).contains(role)) {
            throw forbidden("This action needs one of these roles: " + String.join(", ", roles) + ".");
        }
        Map<String, Object> claims = Map.of(
                "sub", userId.toString(),
                "app_metadata", Map.of("tenant_id", tenantId.toString(), "role", role));
        jdbc.queryForObject("select set_config('request.jwt.claims', ?, true)", String.class, toJson(claims));
        return new Actor(userId, tenantId, role);
    }

    String toJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JacksonException e) {
            throw new IllegalArgumentException("Could not serialize JSON", e);
        }
    }

    static ResponseStatusException forbidden(String message) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }

    static ResponseStatusException notFound(String what) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, what + " not found.");
    }
}
