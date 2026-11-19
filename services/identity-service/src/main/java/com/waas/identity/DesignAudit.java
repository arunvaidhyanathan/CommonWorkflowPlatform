package com.waas.identity;

import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Records identity changes in the tenant's audit log, which design-service
 * owns ({@code POST /internal/design/audit}). Call it inside the change's
 * transaction: if design-service can't record the entry, this throws 503
 * and the change rolls back, so no role or status change goes unaudited.
 */
@Component
class DesignAudit {

    private final RestClient client;

    DesignAudit(@Value("${cwp.design.url}") String baseUrl, @Value("${cwp.internal-token:}") String internalToken) {
        this.client = RestClient.builder().baseUrl(baseUrl).defaultHeader("X-Internal-Token", internalToken).build();
    }

    void record(IdentityDb.Actor actor, String action, UUID profileId, Map<String, Object> before,
            Map<String, Object> after) {
        try {
            client.post().uri("/internal/design/audit")
                    .body(Map.of("tenantId", actor.tenantId(), "actorId", actor.userId(), "action", action,
                            "entityType", "profile", "entityId", profileId, "before", before, "after", after))
                    .retrieve().toBodilessEntity();
        } catch (RestClientException e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Could not record this change in the audit log. Nothing was changed; try again shortly.", e);
        }
    }
}
