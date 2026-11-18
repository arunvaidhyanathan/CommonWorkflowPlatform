package com.waas.flowablewrapper.work;

import java.util.ArrayList;
import java.util.List;

import com.waas.flowablewrapper.common.TenantContext;
import com.waas.flowablewrapper.identity.IdentityDirectory;

import org.flowable.identitylink.api.IdentityLink;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Who may do what at runtime. Every query is scoped to the caller's tenant
 * (Flowable's tenantId is the CWP tenant id). Writes go through
 * {@link IdentityDirectory#requireActive}, so role and active status come from identity data, not the token.
 * Task candidate groups are the caller's group_members rows plus a group
 * named after their role.
 *
 * <p>Flowable records the acting user (startUserId, history) from Spring
 * Security via flowable-spring-security: the JWT principal's name is the
 * user id. Do not call Flowable's Authentication.setAuthenticatedUserId --
 * with that module it replaces the request's Spring security context.
 */
@Component
public class WorkAccess {

    /** Roles that take part in running work. Viewers only look. */
    static final String[] PARTICIPANTS = {"designer", "approver", "tenant_admin"};

    private final IdentityDirectory identity;

    WorkAccess(IdentityDirectory identity) {
        this.identity = identity;
    }

    String tenantId() {
        return TenantContext.currentTenantId().toString();
    }

    String userId() {
        return TenantContext.currentUserId().toString();
    }

    boolean isTenantAdmin() {
        return "tenant_admin".equals(TenantContext.currentRole());
    }

    IdentityDirectory.Actor writer(String... roles) {
        return identity.requireActive(roles);
    }

    boolean isActiveMember(String userId, java.util.UUID tenantId) {
        return identity.isActiveMember(userId, tenantId);
    }

    List<String> groups() {
        List<String> groups = new ArrayList<>(
                identity.groupKeys(TenantContext.currentUserId(), TenantContext.currentTenantId()));
        String role = TenantContext.currentRole();
        if (role != null) {
            groups.add(role);
        }
        return groups;
    }

    /** The caller is the assignee, a candidate user, or in a candidate group. */
    boolean isCandidateOrAssignee(String assignee, List<IdentityLink> links) {
        String me = userId();
        if (me.equals(assignee)) {
            return true;
        }
        List<String> groups = groups();
        return links.stream().filter(l -> "candidate".equals(l.getType()))
                .anyMatch(l -> me.equals(l.getUserId()) || (l.getGroupId() != null && groups.contains(l.getGroupId())));
    }

    static ResponseStatusException notFound(String what) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, what + " not found.");
    }

    static ResponseStatusException forbidden(String message) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }
}
