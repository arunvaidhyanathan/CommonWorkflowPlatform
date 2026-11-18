package com.waas.design;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

/**
 * The caller's role and status, from identity-service
 * ({@code GET /internal/identity/tenants/{t}/members/{u}}) rather than the
 * token. Each answer is reused for {@code cwp.identity.cache-ttl} (default
 * 30s): the most a role change or deactivation can lag behind for design
 * writes. Same rules as flowable-wrapper's HttpIdentityDirectory; if
 * identity-service is unreachable, writes fail with 503.
 */
@Component
class IdentityClient {

    record Member(String role, String status, List<String> groups) {
    }

    record Actor(UUID userId, UUID tenantId, String role) {
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
    IdentityClient(@Value("${cwp.identity.url}") String baseUrl,
            @Value("${cwp.internal-token:}") String internalToken,
            @Value("${cwp.identity.cache-ttl:PT30S}") Duration ttl) {
        this(httpLookup(RestClient.builder().baseUrl(baseUrl).defaultHeader("X-Internal-Token", internalToken)
                .build()), ttl, Clock.systemUTC());
    }

    IdentityClient(Lookup lookup, Duration ttl, Clock clock) {
        this.lookup = lookup;
        this.ttl = ttl;
        this.clock = clock;
    }

    /** Fails with 403 unless the caller is an active member of their tenant with one of {@code roles}. */
    Actor requireActive(String... roles) {
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
