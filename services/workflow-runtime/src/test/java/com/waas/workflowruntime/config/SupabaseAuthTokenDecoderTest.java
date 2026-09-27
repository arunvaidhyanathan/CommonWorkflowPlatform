package com.waas.workflowruntime.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * The project no longer reveals its legacy HS256 secret, so Supabase Auth is
 * the only judge of those tokens: anything it doesn't confirm must be refused,
 * or any self-signed HS256 token would get into the runtime.
 */
class SupabaseAuthTokenDecoderTest {

    private static final String USER = "22222222-2222-2222-2222-222222222222";
    private static final String USER_URL = "https://proj.supabase.co/auth/v1/user";

    private MockRestServiceServer supabase;
    private RestClient.Builder builder;
    private MutableClock clock;

    @BeforeEach
    void setUp() {
        builder = RestClient.builder();
        supabase = MockRestServiceServer.bindTo(builder).build();
        clock = new MutableClock(Instant.now());
    }

    private SupabaseAuthTokenDecoder decoder() {
        return new SupabaseAuthTokenDecoder(builder, "https://proj.supabase.co/", "anon", clock);
    }

    private static String token(String sub, Instant exp) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder().subject(sub).expirationTime(Date.from(exp))
                .claim("app_metadata", java.util.Map.of("tenant_id", "t1", "role", "designer")).build();
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jwt.sign(new MACSigner("a-key-this-service-does-not-know-0123456789"));
        return jwt.serialize();
    }

    @Test
    void acceptsTokenSupabaseAuthConfirmsAndReusesTheAnswerBriefly() throws Exception {
        String token = token(USER, Instant.now().plusSeconds(300));
        supabase.expect(ExpectedCount.times(2), requestTo(USER_URL))
                .andExpect(header("apikey", "anon"))
                .andExpect(header("Authorization", "Bearer " + token))
                .andRespond(withSuccess("{\"id\":\"" + USER + "\"}", MediaType.APPLICATION_JSON));
        SupabaseAuthTokenDecoder decoder = decoder();

        assertThat(decoder.decode(token).getSubject()).isEqualTo(USER);
        decoder.decode(token); // within the TTL: no second call
        clock.advance(SupabaseAuthTokenDecoder.CONFIRM_TTL.plusSeconds(1));
        decoder.decode(token); // re-checked, so a signed-out session stops working

        supabase.verify();
    }

    @Test
    void refusesTokenSupabaseAuthRejects() throws Exception {
        supabase.expect(requestTo(USER_URL)).andRespond(withStatus(HttpStatus.FORBIDDEN));
        String token = token(USER, Instant.now().plusSeconds(300));
        assertThatThrownBy(() -> decoder().decode(token)).isInstanceOf(JwtException.class).hasMessageContaining("HTTP 403");
    }

    @Test
    void refusesTokenWhoseUserDiffersFromSupabaseAuthsAnswer() throws Exception {
        supabase.expect(requestTo(USER_URL))
                .andRespond(withSuccess("{\"id\":\"someone-else\"}", MediaType.APPLICATION_JSON));
        String token = token(USER, Instant.now().plusSeconds(300));
        assertThatThrownBy(() -> decoder().decode(token)).isInstanceOf(JwtException.class).hasMessageContaining("different user");
    }

    @Test
    void refusesExpiredTokenWithoutAskingSupabase() throws Exception {
        String token = token(USER, Instant.now().minusSeconds(600));
        assertThatThrownBy(() -> decoder().decode(token)).isInstanceOf(JwtException.class);
        supabase.verify(); // no request expected
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }
}
