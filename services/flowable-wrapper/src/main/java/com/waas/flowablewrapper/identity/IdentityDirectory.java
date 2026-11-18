package com.waas.flowablewrapper.identity;

import java.util.List;
import java.util.UUID;

/**
 * Everything the Flowable side needs to know about users: the only seam
 * between the engine code (work, deployment, runtimeview) and identity data.
 * Today {@link JdbcIdentityDirectory} reads the identity tables directly;
 * once identity-service is extracted this becomes an internal HTTP call with
 * a short cache, and no Flowable code changes.
 */
public interface IdentityDirectory {

    record Actor(UUID userId, UUID tenantId, String role) {
    }

    /**
     * The caller, re-read from identity data rather than trusted from the
     * token, so a demotion or deactivation applies without waiting for the
     * token to expire. Fails with 403 unless the caller is an active member
     * of their tenant with one of {@code roles}.
     */
    Actor requireActive(String... roles);

    /** Group keys the user belongs to in the tenant (not including their role). */
    List<String> groupKeys(UUID userId, UUID tenantId);

    /** Whether {@code userId} is an active member of the tenant. */
    boolean isActiveMember(String userId, UUID tenantId);
}
