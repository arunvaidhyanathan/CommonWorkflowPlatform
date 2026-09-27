package com.waas.workflowruntime.config;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.nimbusds.jwt.JWT;
import com.nimbusds.jwt.JWTParser;

import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.MappedJwtClaimSetConverter;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Verifies HS256 Supabase tokens by asking Supabase Auth ({@code GET /auth/v1/user}),
 * which checks the signature and that the session still exists. Used when the
 * project's legacy secret isn't configured: Supabase no longer reveals it once a
 * project has migrated to signing keys. Claims are read locally with expiry still
 * enforced; a confirmation is reused for {@link #CONFIRM_TTL}. Mirrors
 * agentic-designer's and spend-tracker's {@code JwtVerifier}.
 */
public class SupabaseAuthTokenDecoder implements JwtDecoder {

    static final Duration CONFIRM_TTL = Duration.ofSeconds(60);

    private final RestClient http;
    private final String anonKey;
    private final Clock clock;
    private final Map<String, Instant> confirmed = new ConcurrentHashMap<>();

    public SupabaseAuthTokenDecoder(RestClient.Builder http, String supabaseUrl, String anonKey, Clock clock) {
        this.http = http.baseUrl(supabaseUrl.replaceAll("/+$", "")).build();
        this.anonKey = anonKey;
        this.clock = clock;
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        Jwt jwt = parse(token);
        var result = JwtValidators.createDefault().validate(jwt); // expiry, not-before
        if (result.hasErrors()) {
            throw new JwtValidationException("Token is not valid", result.getErrors());
        }
        String key = sha256(token);
        Instant now = clock.instant();
        Instant last = confirmed.get(key);
        if (last == null || now.isAfter(last.plus(CONFIRM_TTL))) {
            confirm(token, jwt.getSubject());
            confirmed.values().removeIf(t -> now.isAfter(t.plus(CONFIRM_TTL)));
            confirmed.put(key, now);
        }
        return jwt;
    }

    private void confirm(String token, String subject) {
        Map<?, ?> user;
        try {
            user = http.get().uri("/auth/v1/user")
                    .header("apikey", anonKey)
                    .header("Authorization", "Bearer " + token)
                    .retrieve().body(Map.class);
        } catch (RestClientResponseException e) {
            throw new BadJwtException("Supabase Auth rejected the token (HTTP " + e.getStatusCode().value() + ")");
        } catch (RestClientException e) {
            throw new BadJwtException("Could not reach Supabase Auth to check the token: " + e.getMessage(), e);
        }
        if (user == null || subject == null || !subject.equals(user.get("id"))) {
            throw new BadJwtException("Supabase Auth returned a different user than the token names");
        }
    }

    private static Jwt parse(String token) {
        try {
            JWT parsed = JWTParser.parse(token);
            Map<String, Object> claims = MappedJwtClaimSetConverter.withDefaults(Map.of())
                    .convert(parsed.getJWTClaimsSet().getClaims());
            return Jwt.withTokenValue(token)
                    .headers(h -> h.putAll(parsed.getHeader().toJSONObject()))
                    .claims(c -> c.putAll(claims))
                    .build();
        } catch (ParseException | IllegalArgumentException e) {
            throw new BadJwtException("Malformed token", e);
        }
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
