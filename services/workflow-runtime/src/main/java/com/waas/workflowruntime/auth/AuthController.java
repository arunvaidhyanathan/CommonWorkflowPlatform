package com.waas.workflowruntime.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Username/password login against {@code app_auth.users}. Returns a JWT the
 * SPA sends as a Bearer token to every CWP service.
 */
@RestController
@RequestMapping("/runtime/auth")
public class AuthController {

    public record LoginRequest(@NotBlank String username, @NotBlank String password) {
    }

    public record SessionUser(UUID id, String username, UUID tenantId, String role) {
    }

    public record LoginResponse(String token, Instant expiresAt, SessionUser user) {
    }

    private record Account(UUID id, String username, String passwordHash, UUID tenantId, String role, String status) {
    }

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final JwtEncoder jwtEncoder;
    private final Duration tokenTtl;

    AuthController(JdbcTemplate jdbc, PasswordEncoder passwords, JwtEncoder jwtEncoder,
            @Value("${cwp.jwt.ttl:PT8H}") Duration tokenTtl) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.jwtEncoder = jwtEncoder;
        this.tokenTtl = tokenTtl;
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        List<Account> found = jdbc.query("""
                select u.id, u.username, u.password_hash, p.tenant_id, p.role, p.status
                from app_auth.users u
                left join public.profiles p on p.id = u.id
                where u.username = ?""",
                (rs, i) -> new Account(rs.getObject("id", UUID.class), rs.getString("username"),
                        rs.getString("password_hash"), rs.getObject("tenant_id", UUID.class),
                        rs.getString("role"), rs.getString("status")),
                request.username());

        // Same message for unknown user and wrong password: don't reveal which usernames exist.
        Account account = found.isEmpty() ? null : found.get(0);
        if (account == null || account.passwordHash() == null
                || !passwords.matches(request.password(), account.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password.");
        }
        if (account.tenantId() == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No workspace is assigned to this account.");
        }
        if (!"active".equals(account.status())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "This account is deactivated.");
        }

        Instant now = Instant.now();
        Instant expiresAt = now.plus(tokenTtl);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("cwp-workflow-runtime")
                .subject(account.id().toString())
                .issuedAt(now)
                .expiresAt(expiresAt)
                .claim("username", account.username())
                .claim("app_metadata", Map.of("tenant_id", account.tenantId().toString(), "role", account.role()))
                .build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();

        return new LoginResponse(token, expiresAt,
                new SessionUser(account.id(), account.username(), account.tenantId(), account.role()));
    }
}
