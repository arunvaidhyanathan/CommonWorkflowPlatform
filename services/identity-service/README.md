# identity-service

CWP's identity provider: username/password login, RS256 login tokens with a
public key set (JWKS), tenant members, task groups, invites and the caller's
own profile. Java 21 / Spring Boot 4. Port 8082. Database schema
`identity`, role `cwp_identity`.

| Path | Who | What |
|---|---|---|
| `POST /identity/auth/login` | anyone | `{token, expiresAt, user}` |
| `GET /.well-known/jwks.json` | every service | Public signing key; every service verifies tokens with it |
| `/identity/members` (+ `/{id}/role`, `/groups`, `/status`) | tenant admins | Create users, change role, groups, activate/deactivate |
| `/identity/invites` (+ `/{id}/revoke`) | tenant admins | History of created users |
| `/identity/me`, `/identity/me/dismiss-getting-started` | any user | Own profile |
| `GET /internal/identity/tenants/{t}/members/{u}` | design-service, flowable-wrapper | Role, status, groups. `X-Internal-Token`; never routed by the gateway |

Public path: `/api/identity/**`. Token claims: `sub` = user id,
`app_metadata.tenant_id`, `app_metadata.role`. Role and status changes are
posted to design-service's audit log (`POST /internal/design/audit`) inside
the change's transaction; if that fails the change rolls back (503).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `IDENTITY_DB_URL` | `jdbc:postgresql://localhost:5432/cwp?currentSchema=identity` | |
| `IDENTITY_DB_USER` / `IDENTITY_DB_PASSWORD` | `cwp_identity` / empty | Secret on OpenShift |
| `IDENTITY_DB_POOL_SIZE` | `5` | Per pod: `pods x pool` must stay under PostgreSQL's connection limit |
| `CWP_JWT_PRIVATE_KEY` | empty | PKCS#8 PEM, **the same for every replica** (Secret). `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` |
| `CWP_JWT_ALLOW_EPHEMERAL_KEY` | `false` | `true` only for local dev: a throwaway key per start. Without a key and without this, startup fails |
| `CWP_JWT_TTL` | `PT8H` | Token lifetime |
| `CWP_INTERNAL_TOKEN` | empty | Shared with design-service and flowable-wrapper. Empty refuses every `/internal` call |
| `DESIGN_SERVICE_URL` | `http://localhost:8083` | Where audit events go |
| `PORT` | `8082` | |

## Container

- Build: `docker build -t cwp/identity-service services/identity-service`.
- Runs as non-root, any UID; heap = 75% of the container memory limit.
- Probes: `/actuator/health/liveness`, `/actuator/health/readiness`.
- Stateless (the key comes from config): scale horizontally. Graceful shutdown on SIGTERM.

## Run and test

```
mvn test                 # signing keys, table ownership
mvn spring-boot:run      # or ../../run-local.sh
```
