package com.waas.flowablewrapper.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.waas.flowablewrapper.identity.HttpIdentityDirectory.Member;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.server.ResponseStatusException;

/**
 * Running work trusts identity-service, not the login token, for role and
 * active status. The agreed trade-off: a demotion or deactivation must take
 * effect within the cache TTL (30s), and identity-service must not be called
 * on every request.
 */
class HttpIdentityDirectoryTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();
    private static final Duration TTL = Duration.ofSeconds(30);

    private final MutableClock clock = new MutableClock();
    private final AtomicInteger calls = new AtomicInteger();
    private Optional<Member> current = Optional.of(new Member("designer", "active", List.of("kyc")));
    private HttpIdentityDirectory directory;

    @BeforeEach
    void setUp() {
        directory = new HttpIdentityDirectory((tenantId, userId) -> {
            calls.incrementAndGet();
            return current;
        }, TTL, clock);
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "RS256").subject(USER.toString())
                .claim("app_metadata", Map.of("tenant_id", TENANT.toString(), "role", "designer")).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void deactivationTakesEffectOnceTheCacheExpires() {
        assertThat(directory.requireActive("designer").role()).isEqualTo("designer");

        current = Optional.of(new Member("designer", "deactivated", List.of("kyc")));
        clock.advance(TTL.minusSeconds(1));
        assertThat(directory.requireActive("designer").userId()).as("still cached").isEqualTo(USER);

        clock.advance(Duration.ofSeconds(2));
        assertThatThrownBy(() -> directory.requireActive("designer"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("deactivated");
    }

    @Test
    void roleFromIdentityServiceWinsOverTheTokenClaim() {
        current = Optional.of(new Member("viewer", "active", List.of()));
        // The token still says designer; identity-service says viewer.
        assertThatThrownBy(() -> directory.requireActive("designer", "tenant_admin"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("needs one of these roles");
    }

    @Test
    void repeatedChecksWithinTheTtlCallIdentityServiceOnce() {
        directory.requireActive("designer");
        directory.groupKeys(USER, TENANT);
        directory.isActiveMember(USER.toString(), TENANT);
        assertThat(calls).hasValue(1);
    }

    @Test
    void nonMembersAreRefusedAndNotTaskCandidates() {
        current = Optional.empty();
        assertThatThrownBy(() -> directory.requireActive("designer"))
                .hasMessageContaining("not a member");
        assertThat(directory.groupKeys(USER, TENANT)).isEmpty();
        assertThat(directory.isActiveMember(USER.toString(), TENANT)).isFalse();
        assertThat(directory.isActiveMember("not-a-uuid", TENANT)).isFalse();
    }

    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-11-18T00:00:00Z");

        void advance(Duration by) {
            now = now.plus(by);
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
