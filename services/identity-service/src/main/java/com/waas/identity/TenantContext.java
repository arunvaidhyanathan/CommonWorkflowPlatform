package com.waas.identity;

import java.util.Map;
import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * The caller's user id, tenant and role, read from the login token. There is
 * no RLS backstop: every query must filter by {@link #currentTenantId()}.
 */
public final class TenantContext {

    private TenantContext() {
    }

    private static Jwt currentJwt() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtAuth)) {
            throw new IllegalStateException("No authenticated JWT in the current security context.");
        }
        return jwtAuth.getToken();
    }

    public static UUID currentTenantId() {
        Object tenantId = appMetadata().get("tenant_id");
        if (tenantId == null) {
            throw new IllegalStateException("JWT has no app_metadata.tenant_id claim.");
        }
        return UUID.fromString(tenantId.toString());
    }

    public static String currentRole() {
        Object role = appMetadata().get("role");
        return role == null ? null : role.toString();
    }

    public static UUID currentUserId() {
        return UUID.fromString(currentJwt().getSubject());
    }

    private static Map<String, Object> appMetadata() {
        Map<String, Object> appMetadata = currentJwt().getClaimAsMap("app_metadata");
        return appMetadata == null ? Map.of() : appMetadata;
    }
}
