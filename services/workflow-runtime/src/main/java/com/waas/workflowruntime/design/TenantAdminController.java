package com.waas.workflowruntime.design;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import tools.jackson.databind.JsonNode;
import com.waas.workflowruntime.common.TenantContext;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Tenant members, user creation, invites history, the audit log, and the
 * caller's own profile. Replaces the Supabase invite-user / admin-set-role
 * edge functions: a tenant admin creates a user with a username, password
 * and role directly.
 */
@RestController
@RequestMapping("/runtime/design")
public class TenantAdminController {

    private static final String ROLE_PATTERN = "designer|tenant_admin|approver|viewer";

    public record TenantMember(UUID id, String role, String displayName, String email, String status,
            OffsetDateTime createdAt, List<String> groups) {
    }

    public record GroupsRequest(@NotNull List<@Pattern(regexp = "^[A-Za-z][A-Za-z0-9_-]{0,63}$") String> groups) {
    }

    public record CreateUserRequest(@NotBlank @Size(max = 100) String username,
            @NotBlank @Size(min = 8, message = "must be at least 8 characters") String password,
            @NotBlank @Pattern(regexp = ROLE_PATTERN) String role) {
    }

    public record RoleRequest(@NotBlank @Pattern(regexp = ROLE_PATTERN) String role) {
    }

    public record StatusRequest(@NotBlank @Pattern(regexp = "active|deactivated") String status) {
    }

    public record Invite(UUID id, String email, String role, String status, UUID invitedBy,
            OffsetDateTime createdAt, OffsetDateTime acceptedAt) {
    }

    public record AuditLogEntry(UUID id, UUID actorId, String actorEmail, String action, String entityType,
            UUID entityId, JsonNode before, JsonNode after, OffsetDateTime occurredAt) {
    }

    public record MyProfile(UUID id, String displayName, OffsetDateTime onboardingDismissedAt) {
    }

    private final DesignDb db;
    private final PasswordEncoder passwords;

    TenantAdminController(DesignDb db, PasswordEncoder passwords) {
        this.db = db;
        this.passwords = passwords;
    }

    @GetMapping("/members")
    public List<TenantMember> members() {
        return db.jdbc.query("""
                select p.id, p.role, p.display_name, p.email, p.status, p.created_at,
                       coalesce(array_agg(g.group_key order by g.group_key) filter (where g.group_key is not null),
                                '{}') as groups
                from public.profiles p left join public.group_members g on g.user_id = p.id
                where p.tenant_id = ? group by p.id order by p.created_at""",
                (rs, i) -> new TenantMember(rs.getObject("id", UUID.class), rs.getString("role"),
                        rs.getString("display_name"), rs.getString("email"), rs.getString("status"),
                        rs.getObject("created_at", OffsetDateTime.class),
                        List.of((String[]) rs.getArray("groups").getArray())),
                db.tenantId());
    }

    /** Creates the login, the tenant profile, and an accepted invite row so the Invites tab keeps a history. */
    @PostMapping("/members")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, UUID> createUser(@Valid @RequestBody CreateUserRequest request) {
        DesignDb.Actor actor = db.writer("tenant_admin");
        String username = request.username().trim();
        UUID userId = db.jdbc.queryForObject(
                "insert into app_auth.users (email, username, password_hash) values (?, ?, ?) returning id",
                UUID.class, username, username, passwords.encode(request.password()));
        db.jdbc.update("""
                insert into public.profiles (id, tenant_id, role, display_name, email) values (?, ?, ?, ?, ?)""",
                userId, actor.tenantId(), request.role(), username, username);
        db.jdbc.update("""
                insert into public.invites (tenant_id, email, role, invited_by, status, accepted_at)
                values (?, ?, ?, ?, 'accepted', now())""",
                actor.tenantId(), username, request.role(), actor.userId());
        return Map.of("id", userId);
    }

    @PutMapping("/members/{id}/role")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void setRole(@PathVariable UUID id, @Valid @RequestBody RoleRequest request) {
        DesignDb.Actor actor = db.writer("tenant_admin");
        if (actor.userId().equals(id)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "You cannot change your own role.");
        }
        List<String> previous = db.jdbc.query(
                "select role from public.profiles where id = ? and tenant_id = ? for update",
                (rs, i) -> rs.getString("role"), id, actor.tenantId());
        if (previous.isEmpty()) {
            throw DesignDb.notFound("Member");
        }
        db.jdbc.update("update public.profiles set role = ? where id = ?", request.role(), id);
        // No trigger covers role changes (the edge function wrote this row before).
        db.jdbc.update("""
                insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
                values (?, ?, 'role_changed', 'profile', ?, ?::jsonb, ?::jsonb)""",
                actor.tenantId(), actor.userId(), id,
                db.toJson(Map.of("role", previous.get(0))), db.toJson(Map.of("role", request.role())));
    }

    /** Replaces the member's task candidate groups (their role is always an implicit group). */
    @PutMapping("/members/{id}/groups")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void setGroups(@PathVariable UUID id, @Valid @RequestBody GroupsRequest request) {
        DesignDb.Actor actor = db.writer("tenant_admin");
        Boolean member = db.jdbc.queryForObject(
                "select exists (select 1 from public.profiles where id = ? and tenant_id = ?)",
                Boolean.class, id, actor.tenantId());
        if (!Boolean.TRUE.equals(member)) {
            throw DesignDb.notFound("Member");
        }
        db.jdbc.update("delete from public.group_members where user_id = ?", id);
        for (String group : new java.util.TreeSet<>(request.groups())) {
            db.jdbc.update("insert into public.group_members (tenant_id, user_id, group_key) values (?, ?, ?)",
                    actor.tenantId(), id, group);
        }
    }

    @PutMapping("/members/{id}/status")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void setStatus(@PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        DesignDb.Actor actor = db.writer("tenant_admin");
        if (actor.userId().equals(id) && "deactivated".equals(request.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "You cannot deactivate yourself.");
        }
        int updated = db.jdbc.update("update public.profiles set status = ? where id = ? and tenant_id = ?",
                request.status(), id, actor.tenantId());
        if (updated == 0) {
            throw DesignDb.notFound("Member");
        }
    }

    @GetMapping("/invites")
    public List<Invite> invites() {
        requireTenantAdminToken();
        return db.jdbc.query("""
                select id, email, role, status, invited_by, created_at, accepted_at from public.invites
                where tenant_id = ? order by created_at desc""",
                (rs, i) -> new Invite(rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("role"),
                        rs.getString("status"), rs.getObject("invited_by", UUID.class),
                        rs.getObject("created_at", OffsetDateTime.class),
                        rs.getObject("accepted_at", OffsetDateTime.class)),
                db.tenantId());
    }

    @PostMapping("/invites/{id}/revoke")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void revokeInvite(@PathVariable UUID id) {
        DesignDb.Actor actor = db.writer("tenant_admin");
        int updated = db.jdbc.update("""
                update public.invites set status = 'revoked'
                where id = ? and tenant_id = ? and status = 'invited'""", id, actor.tenantId());
        if (updated == 0) {
            throw DesignDb.notFound("Pending invite");
        }
    }

    @GetMapping("/audit")
    public List<AuditLogEntry> audit(@RequestParam(defaultValue = "100") int limit) {
        requireTenantAdminToken();
        return db.jdbc.query("""
                select a.id, a.actor_id, p.email as actor_email, a.action, a.entity_type, a.entity_id,
                       a.before::text as before, a.after::text as after, a.occurred_at
                from public.audit_logs a left join public.profiles p on p.id = a.actor_id
                where a.tenant_id = ? order by a.occurred_at desc limit ?""",
                (rs, i) -> new AuditLogEntry(rs.getObject("id", UUID.class), rs.getObject("actor_id", UUID.class),
                        rs.getString("actor_email"), rs.getString("action"), rs.getString("entity_type"),
                        rs.getObject("entity_id", UUID.class), db.parseJson(rs.getString("before")),
                        db.parseJson(rs.getString("after")), rs.getObject("occurred_at", OffsetDateTime.class)),
                db.tenantId(), Math.min(Math.max(limit, 1), 500));
    }

    @GetMapping("/me")
    public MyProfile me() {
        return db.jdbc.query(
                "select id, display_name, onboarding_dismissed_at from public.profiles where id = ?",
                (rs, i) -> new MyProfile(rs.getObject("id", UUID.class), rs.getString("display_name"),
                        rs.getObject("onboarding_dismissed_at", OffsetDateTime.class)),
                TenantContext.currentUserId())
                .stream().findFirst().orElseThrow(() -> DesignDb.notFound("Profile"));
    }

    @PostMapping("/me/dismiss-getting-started")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismissGettingStarted() {
        db.jdbc.update("update public.profiles set onboarding_dismissed_at = now() where id = ?",
                TenantContext.currentUserId());
    }

    // Reads mirror the old RLS read policies, which checked the token's role claim.
    private static void requireTenantAdminToken() {
        if (!"tenant_admin".equals(TenantContext.currentRole())) {
            throw DesignDb.forbidden("Only tenant admins can see this.");
        }
    }
}
