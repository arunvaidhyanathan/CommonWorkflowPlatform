# design-service

CWP's design-time data: workflows, their immutable versions, approval
requests and the tenant audit log. Port 8083.

| Path | Who | What |
|---|---|---|
| `/design/workflows`, `/design/workflows/{id}`, `/design/workflows/key-taken` | logged-in users | List, read, create (designer/tenant_admin), archive, delete (tenant_admin) |
| `POST /design/workflows/{id}/versions`, `GET /design/versions/{id}` | designers | Save and load immutable versions |
| `/design/approvals`, `/design/approvals/pending`, `/design/approvals/{id}/decision` | designers / approvers | Submit, list, decide (never on your own submission) |
| `GET /design/audit` | tenant admins | Audit log |

Through the gateway these are `/api/design/**`. Until the SPA cutover the old
`/api/runtime/design/**` paths are rewritten here by nginx and the Vite dev
proxy (members, invites and `/me` go to identity-service instead).

Login tokens come from identity-service and are verified against its JWKS.
Every write re-checks the caller's role and active status with
identity-service (`IdentityClient`), cached for `IDENTITY_CACHE_TTL`
(default 30s), then sets `request.jwt.claims` so the audit and status
triggers in `Database/policies.sql` record who acted.

Audit entries carry the actor's id only. identity-service records role and
status changes through `POST /internal/design/audit` (`X-Internal-Token`,
never routed by the gateway).

## Configuration

| Variable | Default |
|---|---|
| `DESIGN_DB_URL` | `jdbc:postgresql://localhost:5432/cwp?currentSchema=public` |
| `DESIGN_DB_USER` / `DESIGN_DB_PASSWORD` | `cwp_design` / empty (own role, Database/roles.sql) |
| `IDENTITY_SERVICE_URL` / `IDENTITY_JWKS_URL` | `http://localhost:8082` / `.../.well-known/jwks.json` |
| `IDENTITY_CACHE_TTL` | `PT30S` |
| `CWP_INTERNAL_TOKEN` | empty (identity lookups then fail) |

## Run and test

```
mvn spring-boot:run      # or ./run-local.sh at the repo root
mvn test
IDENTITY_CACHE_TTL=PT0S mvn spring-boot:run   # then: bash e2e/design_api_test.sh
```
