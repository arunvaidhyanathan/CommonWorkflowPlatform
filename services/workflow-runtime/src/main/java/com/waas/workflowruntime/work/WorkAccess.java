package com.waas.workflowruntime.work;

import java.util.ArrayList;
import java.util.List;

import com.waas.workflowruntime.common.TenantContext;
import com.waas.workflowruntime.design.DesignDb;

import org.flowable.identitylink.api.IdentityLink;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Who may do what at runtime. Every query is scoped to the caller's tenant
 * (Flowable's tenantId is the CWP tenant id). Writes go through
 * {@link DesignDb#writer}, so role and active status come from the database.
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

    private final DesignDb db;
    private final JdbcTemplate jdbc;

    WorkAccess(DesignDb db, JdbcTemplate jdbc) {
        this.db = db;
        this.jdbc = jdbc;
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

    DesignDb.Actor writer(String... roles) {
        return db.writer(roles);
    }

    List<String> groups() {
        List<String> groups = new ArrayList<>(jdbc.queryForList(
                "select group_key from public.group_members where user_id = ? and tenant_id = ?",
                String.class, TenantContext.currentUserId(), TenantContext.currentTenantId()));
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
