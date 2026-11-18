package com.waas.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Service-to-service lookups (flowable-wrapper's IdentityDirectory, design-service's IdentityClient). Never
 * routed by the gateway; callers present the shared internal token. Fails
 * closed: with no token configured, every call is refused.
 */
@RestController
@RequestMapping("/internal/identity")
public class InternalController {

    /** One tenant member as other services need them: role, status and task groups. */
    public record Member(UUID userId, UUID tenantId, String role, String status, List<String> groups) {
    }

    private final JdbcTemplate jdbc;
    private final byte[] internalToken;

    InternalController(JdbcTemplate jdbc, @Value("${cwp.internal-token:}") String internalToken) {
        this.jdbc = jdbc;
        this.internalToken = internalToken.getBytes(StandardCharsets.UTF_8);
    }

    @GetMapping("/tenants/{tenantId}/members/{userId}")
    public Member member(@RequestHeader(value = "X-Internal-Token", required = false) String token,
            @PathVariable UUID tenantId, @PathVariable UUID userId) {
        requireInternalToken(token);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select role, status from public.profiles where id = ? and tenant_id = ?", userId, tenantId);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Member not found.");
        }
        List<String> groups = jdbc.queryForList(
                "select group_key from public.group_members where user_id = ? and tenant_id = ? order by group_key",
                String.class, userId, tenantId);
        return new Member(userId, tenantId, (String) rows.get(0).get("role"), (String) rows.get(0).get("status"),
                groups);
    }

    private void requireInternalToken(String presented) {
        if (internalToken.length == 0 || presented == null
                || !MessageDigest.isEqual(internalToken, presented.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal token required.");
        }
    }
}
