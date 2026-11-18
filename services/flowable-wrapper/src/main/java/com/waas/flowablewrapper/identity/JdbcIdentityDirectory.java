package com.waas.flowablewrapper.identity;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.waas.flowablewrapper.common.TenantContext;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Reads identity data from the shared database (until identity-service exists). */
@Component
class JdbcIdentityDirectory implements IdentityDirectory {

    private final JdbcTemplate jdbc;

    JdbcIdentityDirectory(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Actor requireActive(String... roles) {
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

    @Override
    public List<String> groupKeys(UUID userId, UUID tenantId) {
        return jdbc.queryForList(
                "select group_key from public.group_members where user_id = ? and tenant_id = ?",
                String.class, userId, tenantId);
    }

    @Override
    public boolean isActiveMember(String userId, UUID tenantId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select exists (select 1 from public.profiles where id::text = ? and tenant_id = ? and status = 'active')",
                Boolean.class, userId, tenantId));
    }

    private static ResponseStatusException forbidden(String message) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }
}
