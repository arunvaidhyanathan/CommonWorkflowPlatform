# design-service

CWP's design-time data: workflows, their immutable versions, approval
requests and the tenant audit log. Java 21 / Spring Boot 4. Port 8083.
Database schema `design`, role `cwp_design`.

| Path | Who | What |
|---|---|---|
| `/design/workflows`, `/design/workflows/{id}`, `/design/workflows/key-taken` | logged-in users | List, read, create (designer/tenant_admin), archive, delete (tenant_admin) |
| `POST /design/workflows/{id}/versions`, `GET /design/versions/{id}` | designers | Save and load immutable versions |
| `/design/approvals`, `/design/approvals/pending`, `/design/approvals/{id}/decision` | designers / approvers | Submit, list, decide (never on your own submission) |
| `GET /design/audit` | tenant admins | Audit log (actor ids, no emails) |
| `POST /internal/design/audit` | identity-service | Record role and status changes. `X-Internal-Token`; never routed by the gateway |

Public path: `/api/design/**`. Every write re-checks the caller's role and
status with identity-service (`IdentityClient`, cached for
`IDENTITY_CACHE_TTL`), then sets `request.jwt.claims` so the triggers in
`database/03-design.sql` record who acted and keep workflow status in step
with approvals.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DESIGN_DB_URL` | `jdbc:postgresql://localhost:5432/cwp?currentSchema=design` | |
| `DESIGN_DB_USER` / `DESIGN_DB_PASSWORD` | `cwp_design` / empty | Secret on OpenShift |
| `DESIGN_DB_POOL_SIZE` | `5` | Per pod |
| `IDENTITY_SERVICE_URL` / `IDENTITY_JWKS_URL` | `http://localhost:8082` / `.../.well-known/jwks.json` | |
| `IDENTITY_CACHE_TTL` | `PT30S` | Most a role change or deactivation can lag for writes |
| `CWP_INTERNAL_TOKEN` | empty | Same value as identity-service |
| `PORT` | `8083` | |

## Container

- Build: `docker build -t cwp/design-service services/design-service`.
- Runs as non-root, any UID; heap = 75% of the container memory limit.
- Probes: `/actuator/health/liveness`, `/actuator/health/readiness`.
- Stateless: scale horizontally. The identity cache is per pod, so each pod
  may lag a role change by up to `IDENTITY_CACHE_TTL` independently.

## Run and test

```
mvn test                                        # identity cache, table ownership
mvn spring-boot:run                             # or ../../run-local.sh
IDENTITY_CACHE_TTL=PT0S mvn spring-boot:run     # then: bash e2e/design_api_test.sh (CWP_DESIGN_BASE, CWP_IDENTITY_BASE, CWP_DB)
```
