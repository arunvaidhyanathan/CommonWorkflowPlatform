package com.waas.identity;

import java.util.List;
import java.util.Map;
import java.util.UUID;

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

    IdentityDb(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * For writes; call inside a transaction. Fails with 403 unless the caller
     * is an active member of their tenant with one of {@code roles}.
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
        return new Actor(userId, tenantId, role);
    }

    static ResponseStatusException forbidden(String message) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }

    static ResponseStatusException notFound(String what) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, what + " not found.");
    }
}
