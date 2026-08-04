package com.waas.runtimegateway.common;

import java.util.Map;
import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * Reads tenant_id / role / user id out of the current request's Supabase
 * JWT. This is the Runtime Gateway's equivalent of Postgres's
 * {@code current_tenant_id()} / {@code current_role_claim()} -- except,
 * critically, there is no RLS backstop here (WorkflowWrapper.html Section
 * 7). Every repository/service method that touches {@code runtime} schema
 * data MUST call {@link #currentTenantId()} and filter by it explicitly;
 * nothing enforces that automatically the way Postgres RLS does for the
 * anon-key-facing side of this platform.
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

    /** The Supabase auth.users id ({@code sub} claim) -- equivalent to {@code auth.uid()} in Postgres. */
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
