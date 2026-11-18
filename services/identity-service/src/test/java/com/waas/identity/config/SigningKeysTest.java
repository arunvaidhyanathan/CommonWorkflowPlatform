package com.waas.identity.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.KeyPairGenerator;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * Every other CWP service (flowable-wrapper, agentic-designer, spend-tracker)
 * trusts a login token only if it verifies against the key published at
 * /.well-known/jwks.json. If signing and publishing drift apart, nobody can
 * use the platform.
 */
class SigningKeysTest {

    private final SecurityConfig config = new SecurityConfig();

    @Test
    void tokenVerifiesWithOnlyThePublishedJwks() throws Exception {
        RSAKey key = config.signingKey("");
        String token = sign(key, "user-1");

        // What a consumer sees: the JWKS JSON, parsed back -- no private material.
        JWKSet published = JWKSet.parse(new JwksController(key).jwks());
        assertThat(published.getKeys()).singleElement().satisfies(k -> assertThat(k.isPrivate()).isFalse());

        Jwt jwt = NimbusJwtDecoder.withPublicKey(((RSAKey) published.getKeys().get(0)).toRSAPublicKey())
                .build().decode(token);
        assertThat(jwt.getSubject()).isEqualTo("user-1");
        assertThat(jwt.getHeaders()).containsEntry("kid", key.getKeyID());
        assertThat(jwt.getClaimAsMap("app_metadata")).containsEntry("role", "designer");
    }

    @Test
    void configuredKeyIsStableAcrossRestartsSoTokensSurvive() throws Exception {
        var generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        String pem = "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder().encodeToString(generator.generateKeyPair().getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----\n";

        RSAKey first = config.signingKey(pem);
        RSAKey afterRestart = config.signingKey(pem);
        String token = sign(first, "user-2");

        assertThat(afterRestart.getKeyID()).isEqualTo(first.getKeyID());
        assertThat(config.jwtDecoder(afterRestart).decode(token).getSubject()).isEqualTo("user-2");
    }

    @Test
    void malformedKeyFailsStartupInsteadOfSilentlyGeneratingOne() {
        assertThatThrownBy(() -> config.signingKey("-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("CWP_JWT_PRIVATE_KEY");
    }

    private String sign(RSAKey key, String subject) {
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(subject)
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60))
                .claim("app_metadata", Map.of("tenant_id", "t-1", "role", "designer"))
                .build();
        return config.jwtEncoder(key)
                .encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims))
                .getTokenValue();
    }
}
