package com.waas.flowablewrapper.identity;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.waas.flowablewrapper.common.TenantContext;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Asks identity-service ({@code GET /internal/identity/tenants/{t}/members/{u}})
 * and caches each answer briefly, so a role change or deactivation reaches
 * running work within {@code cwp.identity.cache-ttl} (default 30s) without a
 * call per request. Unknown members are cached too. If identity-service is
 * unreachable, writes fail with 503 rather than trusting the token.
 */
@Component
class HttpIdentityDirectory implements IdentityDirectory {

    /** identity-service's answer for one member. */
    record Member(String role, String status, List<String> groups) {
    }

    private record Cached(Optional<Member> member, Instant expiresAt) {
    }

    interface Lookup {
        Optional<Member> find(UUID tenantId, UUID userId);
    }

    private final Lookup lookup;
    private final Duration ttl;
    private final Clock clock;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    @Autowired
    HttpIdentityDirectory(@Value("${cwp.identity.url}") String baseUrl,
            @Value("${cwp.internal-token:}") String internalToken,
            @Value("${cwp.identity.cache-ttl:PT30S}") Duration ttl) {
        this(httpLookup(RestClient.builder().baseUrl(baseUrl).defaultHeader("X-Internal-Token", internalToken)
                .build()), ttl, Clock.systemUTC());
    }

    HttpIdentityDirectory(Lookup lookup, Duration ttl, Clock clock) {
        this.lookup = lookup;
        this.ttl = ttl;
        this.clock = clock;
    }

    @Override
    public Actor requireActive(String... roles) {
        UUID userId = TenantContext.currentUserId();
        UUID tenantId = TenantContext.currentTenantId();
        Member member = member(tenantId, userId)
                .orElseThrow(() -> forbidden("You are not a member of this tenant."));
        if (!"active".equals(member.status())) {
            throw forbidden("Your account is deactivated.");
        }
        if (!List.of(roles).contains(member.role())) {
            throw forbidden("This action needs one of these roles: " + String.join(", ", roles) + ".");
        }
        return new Actor(userId, tenantId, member.role());
    }

    @Override
    public List<String> groupKeys(UUID userId, UUID tenantId) {
        return member(tenantId, userId).map(Member::groups).orElse(List.of());
    }

    @Override
    public boolean isActiveMember(String userId, UUID tenantId) {
        UUID id;
        try {
            id = UUID.fromString(userId);
        } catch (IllegalArgumentException e) {
            return false;
        }
        return member(tenantId, id).map(m -> "active".equals(m.status())).orElse(false);
    }

    private Optional<Member> member(UUID tenantId, UUID userId) {
        String key = tenantId + "/" + userId;
        Instant now = clock.instant();
        Cached cached = cache.get(key);
        if (cached != null && now.isBefore(cached.expiresAt())) {
            return cached.member();
        }
        Optional<Member> member = lookup.find(tenantId, userId);
        cache.put(key, new Cached(member, now.plus(ttl)));
        return member;
    }

    private static Lookup httpLookup(RestClient client) {
        return (tenantId, userId) -> {
            try {
                return Optional.ofNullable(client.get()
                        .uri("/internal/identity/tenants/{t}/members/{u}", tenantId, userId)
                        .retrieve().body(Member.class));
            } catch (HttpClientErrorException.NotFound e) {
                return Optional.empty();
            } catch (RestClientException e) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                        "Could not check your membership with identity-service. Try again shortly.", e);
            }
        };
    }

    private static ResponseStatusException forbidden(String message) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }
}
