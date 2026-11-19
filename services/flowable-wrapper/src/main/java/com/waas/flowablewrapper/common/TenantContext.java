package com.waas.flowablewrapper.common;

import java.util.Map;
import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * Reads tenant_id / role / user id out of the current request's login token
 * (issued by identity-service). There is no database-level backstop: every
 * repository/service method that touches {@code runtime} schema data MUST
 * call {@link #currentTenantId()} and filter by it explicitly.
 */
public final class TenantContext {

    private TenantContext() {
    }

    private static Jwt currentJwt() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtAuth)) {
            throw new IllegalStateException(
                    "No authenticated JWT in the current security context -- this method must only "
                            + "be called from within an authenticated request.");
        }
        return jwtAuth.getToken();
    }

    /** Mirrors Postgres's {@code current_tenant_id()}: reads app_metadata.tenant_id from the JWT. */
    public static UUID currentTenantId() {
        Map<String, Object> appMetadata = appMetadata();
        Object tenantId = appMetadata.get("tenant_id");
        if (tenantId == null) {
            throw new IllegalStateException("JWT has no app_metadata.tenant_id claim.");
        }
        return UUID.fromString(tenantId.toString());
    }

    /** Mirrors Postgres's {@code current_role_claim()}: reads app_metadata.role from the JWT. */
    public static String currentRole() {
        Object role = appMetadata().get("role");
        return role == null ? null : role.toString();
    }

    /** The user id ({@code sub} claim), identity-service's identity.users id. */
    public static UUID currentUserId() {
        String sub = currentJwt().getSubject();
        return UUID.fromString(sub);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> appMetadata() {
        Map<String, Object> appMetadata = currentJwt().getClaimAsMap("app_metadata");
        return appMetadata == null ? Map.of() : appMetadata;
    }
}
