package com.waas.workflowruntime.config;

import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Security configuration for the Runtime Gateway. Stateless, JWT-only --
 * this service issues nothing itself and trusts Supabase Auth entirely as
 * the identity provider (CWP.html Section 2: "Supabase Auth is the single
 * identity provider"), the same as every other component in this platform.
 *
 * <p><b>Two JWT verification modes</b>, selected by {@code supabase.jwt.mode}
 * (application.yml): most Supabase projects today sign with an asymmetric
 * key and expose a JWKS endpoint ({@code jwks}, the default here). Older
 * Supabase projects that haven't migrated off the legacy shared HS256 JWT
 * secret need {@code hs256} instead, verified against that literal shared
 * secret. Confirm which applies to project {@code nrhsoabqeskybrznxfyi} in
 * Supabase's dashboard (Project Settings -> API -> JWT Settings) before
 * relying on this in anything beyond local development.
 */
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable()) // stateless JWT API, no cookies/browser forms involved
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health", "/actuator/health/**", "/actuator/info").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));

        return http.build();
    }

    /**
     * Default, recommended path: verify against Supabase's published JWKS.
     * The converter maps app_metadata.role onto a ROLE_* authority
     * (SupabaseJwtAuthenticationConverter) -- wired via
     * spring.security.oauth2.resourceserver.jwt.jwk-set-uri
     * (application.yml), which Spring Boot's autoconfiguration already
     * turns into a JwtDecoder bean automatically. This explicit bean only
     * exists to attach the custom authentication converter; if Spring
     * Boot's own autoconfigured decoder is sufficient once this is wired up
     * for real, this bean can be simplified away.
     */
    @Bean
    @ConditionalOnProperty(name = "supabase.jwt.mode", havingValue = "jwks", matchIfMissing = true)
    public JwtDecoder jwksJwtDecoder(
            @Value("${spring.security.oauth2.resourceserver.jwt.jwk-set-uri}") String jwkSetUri) {
        return NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
    }

    /**
     * Fallback path for a Supabase project still on the legacy shared HS256
     * JWT secret (Project Settings -> API -> JWT Settings -> "JWT Secret").
     * Set {@code SUPABASE_JWT_MODE=hs256} and {@code
     * SUPABASE_JWT_HS256_SECRET=<that secret>} to use this instead of JWKS.
     */
    @Bean
    @ConditionalOnProperty(name = "supabase.jwt.mode", havingValue = "hs256")
    public JwtDecoder hs256JwtDecoder(@Value("${supabase.jwt.hs256-secret}") String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "supabase.jwt.mode=hs256 requires supabase.jwt.hs256-secret to be set.");
        }
        SecretKeySpec key = new SecretKeySpec(secret.getBytes(), "HmacSHA256");
        return NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }

    @Bean
    public org.springframework.core.convert.converter.Converter<
                    org.springframework.security.oauth2.jwt.Jwt,
                    org.springframework.security.authentication.AbstractAuthenticationToken>
            jwtAuthenticationConverter() {
        return new SupabaseJwtAuthenticationConverter();
    }
}
