package com.waas.design;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.waas.design.IdentityClient.Member;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.server.ResponseStatusException;

/**
 * Design writes (save version, approve, delete) trust identity-service, not
 * the login token. A demoted approver must stop approving, and a
 * deactivated designer must stop saving, within the cache TTL.
 */
class IdentityClientTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();
    private static final Duration TTL = Duration.ofSeconds(30);

    private Instant now = Instant.parse("2026-11-18T00:00:00Z");
    private Optional<Member> current = Optional.of(new Member("approver", "active", List.of()));
    private IdentityClient client;

    @BeforeEach
    void setUp() {
        Clock clock = new Clock() {
            @Override
            public Instant instant() {
                return now;
            }

            @Override
            public ZoneOffset getZone() {
                return ZoneOffset.UTC;
            }

            @Override
            public Clock withZone(ZoneId zone) {
                return this;
            }
        };
        client = new IdentityClient((tenantId, userId) -> current, TTL, clock);
        // The token claims approver throughout; only identity-service's answer changes.
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "RS256").subject(USER.toString())
                .claim("app_metadata", Map.of("tenant_id", TENANT.toString(), "role", "approver")).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void demotedApproverLosesApprovalRightsOnceTheCacheExpires() {
        assertThat(client.requireActive("approver").role()).isEqualTo("approver");

        current = Optional.of(new Member("viewer", "active", List.of()));
        now = now.plus(TTL.minusSeconds(1));
        assertThat(client.requireActive("approver").role()).as("still cached").isEqualTo("approver");

        now = now.plus(Duration.ofSeconds(2));
        assertThatThrownBy(() -> client.requireActive("approver"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("needs one of these roles");
    }

    @Test
    void deactivatedOrUnknownUsersCannotWrite() {
        current = Optional.of(new Member("approver", "deactivated", List.of()));
        assertThatThrownBy(() -> client.requireActive("approver")).hasMessageContaining("deactivated");

        now = now.plus(TTL);
        current = Optional.empty();
        assertThatThrownBy(() -> client.requireActive("approver")).hasMessageContaining("not a member");
    }
}
