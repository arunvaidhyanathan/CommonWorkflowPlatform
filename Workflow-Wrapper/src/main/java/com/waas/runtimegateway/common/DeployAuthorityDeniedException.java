package com.waas.runtimegateway.common;

/**
 * Thrown when an authenticated caller lacks deploy authority under the
 * Governance.html Section 11.3 SoD (Separation of Duties) rule: the person
 * who authored/edited a workflow's definition must not also be the one who
 * promotes it to a deployed state. Phase 4 keeps this simple and
 * provisional -- deploy authority defaults to {@code tenant_admin} only --
 * pending the fuller "who edited vs. who deploys" author-tracking design
 * flagged as an open question in that section.
 */
public class DeployAuthorityDeniedException extends RuntimeException {

    public DeployAuthorityDeniedException(String message) {
        super(message);
    }
}
