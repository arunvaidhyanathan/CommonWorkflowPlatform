package com.waas.flowablewrapper.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Stateless JWT security. identity-service issues the login tokens (RS256);
 * this service verifies them against identity-service's published key set
 * ({@code cwp.identity.jwks-url}), so it holds no signing secret. Claims keep
 * the shape the rest of CWP reads: {@code sub} is the user id, {@code
 * app_metadata.tenant_id} / {@code app_metadata.role} the tenant and role.
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

    @Bean
    public JwtDecoder jwtDecoder(@Value("${cwp.identity.jwks-url}") String jwksUrl) {
        return NimbusJwtDecoder.withJwkSetUri(jwksUrl).build();
    }

    @Bean
    public org.springframework.core.convert.converter.Converter<
                    org.springframework.security.oauth2.jwt.Jwt,
                    org.springframework.security.authentication.AbstractAuthenticationToken>
            jwtAuthenticationConverter() {
        return new SupabaseJwtAuthenticationConverter();
    }
}
