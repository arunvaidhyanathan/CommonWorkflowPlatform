package com.waas.workflowruntime.config;

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * Maps a Supabase-issued JWT's {@code app_metadata.role} claim onto a Spring
 * Security authority, mirroring Postgres's {@code current_role_claim()} so
 * the same tenant/role model governs both planes (Designer.html Section 2's
 * "Single Token, Two Planes" pattern, now realized for this component).
 *
 * <p>{@code tenant_admin} becomes {@code ROLE_TENANT_ADMIN}, {@code
 * approver} becomes {@code ROLE_APPROVER}, and so on -- deliberately the
 * same four Governance.html Section 3.2 role values as everywhere else in
 * CWP, not a separate role vocabulary for this service.
 */
public class SupabaseJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        return new JwtAuthenticationToken(jwt, authorities(jwt), jwt.getSubject());
    }

    private Collection<GrantedAuthority> authorities(Jwt jwt) {
        Map<String, Object> appMetadata = jwt.getClaimAsMap("app_metadata");
        if (appMetadata == null || appMetadata.get("role") == null) {
            return List.of();
        }
        String role = appMetadata.get("role").toString().toUpperCase(Locale.ROOT);
        return List.of(new SimpleGrantedAuthority("ROLE_" + role));
    }
}
