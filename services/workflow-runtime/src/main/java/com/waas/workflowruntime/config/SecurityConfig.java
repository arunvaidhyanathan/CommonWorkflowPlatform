package com.waas.workflowruntime.config;

import java.text.ParseException;
import java.time.Clock;

import javax.crypto.spec.SecretKeySpec;

import com.nimbusds.jwt.JWTParser;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.client.RestClient;

/**
 * Security configuration for workflow-runtime (formerly the Runtime Gateway). Stateless, JWT-only --
 * this service issues nothing itself and trusts Supabase Auth entirely as
 * the identity provider (CWP.html Section 2: "Supabase Auth is the single
 * identity provider"), the same as every other component in this platform.
 *
 * <p><b>Both Supabase signing schemes are accepted</b> (see {@link #jwtDecoder}):
 * tokens signed with a key in the project's JWKS (ES256/RS256), and tokens
 * signed with the project's legacy shared key (HS256). HS256 tokens are checked
 * with {@code supabase.jwt.hs256-secret} when set, otherwise by Supabase Auth
 * ({@link SupabaseAuthTokenDecoder}). Project {@code nrhsoabqeskybrznxfyi}
 * issued HS256 login tokens as of September 27, 2026 (their key id is not in
 * the JWKS) and, having migrated to signing keys, no longer reveals the secret.
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
     * Supabase signs login tokens either with an asymmetric key published in
     * the project's JWKS (ES256/RS256) or, for projects still on it, with the
     * legacy shared secret (HS256, whose key id isn't in the JWKS). Accept
     * both: pick the decoder by the token's algorithm. HS256 tokens are
     * checked with {@code supabase.jwt.hs256-secret} when set, else by
     * Supabase Auth when {@code supabase.url} and {@code supabase.anon-key}
     * are set, else refused.
     */
    @Bean
    public JwtDecoder jwtDecoder(
            @Value("${spring.security.oauth2.resourceserver.jwt.jwk-set-uri}") String jwkSetUri,
            @Value("${supabase.jwt.hs256-secret:}") String secret,
            @Value("${supabase.url:}") String supabaseUrl,
            @Value("${supabase.anon-key:}") String anonKey) {
        JwtDecoder jwks = NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
        JwtDecoder hs256 = (secret == null || secret.isBlank())
                ? null
                : NimbusJwtDecoder.withSecretKey(new SecretKeySpec(secret.getBytes(), "HmacSHA256"))
                        .macAlgorithm(MacAlgorithm.HS256).build();
        if (hs256 == null && !supabaseUrl.isBlank() && !anonKey.isBlank()) {
            hs256 = new SupabaseAuthTokenDecoder(RestClient.builder(), supabaseUrl, anonKey, Clock.systemUTC());
        }
        JwtDecoder hs256Decoder = hs256;
        return token -> {
            String alg;
            try {
                alg = JWTParser.parse(token).getHeader().getAlgorithm().getName();
            } catch (ParseException e) {
                throw new BadJwtException("Malformed token", e);
            }
            if ("HS256".equals(alg)) {
                if (hs256Decoder == null) {
                    throw new BadJwtException(
                            "HS256 token, but neither supabase.jwt.hs256-secret nor supabase.url and supabase.anon-key are configured");
                }
                return hs256Decoder.decode(token);
            }
            return jwks.decode(token);
        };
    }

    @Bean
    public org.springframework.core.convert.converter.Converter<
                    org.springframework.security.oauth2.jwt.Jwt,
                    org.springframework.security.authentication.AbstractAuthenticationToken>
            jwtAuthenticationConverter() {
        return new SupabaseJwtAuthenticationConverter();
    }
}
