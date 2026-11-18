# identity-service

CWP's identity provider: username/password login, RS256 login tokens, tenant
members, task groups, invites and the caller's own profile. Port 8082.

| Path | Who | What |
|---|---|---|
| `POST /identity/auth/login` | anyone | Returns `{token, expiresAt, user}` |
| `GET /.well-known/jwks.json` | other services | Public signing key; every service verifies tokens with it |
| `/identity/members`, `/identity/invites`, `/identity/me` | logged-in users | Tenant admin screens and own profile |
| `GET /internal/identity/tenants/{t}/members/{u}` | flowable-wrapper, design-service | Role, status, groups. Needs `X-Internal-Token`; never routed by the gateway |

Through the gateway these are `/api/identity/**`. Until the SPA cutover the
old paths (`/api/runtime/auth/**`, `/api/runtime/design/{members,invites,me}`)
are rewritten here by nginx and the Vite dev proxy.

Token claims keep the shape the rest of CWP reads: `sub` is the user id,
`app_metadata.tenant_id` / `app_metadata.role` the tenant and role.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `IDENTITY_DB_URL` | `jdbc:postgresql://localhost:5432/cwp?currentSchema=public` | Shares the `cwp` database until the DB split |
| `IDENTITY_DB_USER` / `IDENTITY_DB_PASSWORD` | `$USER` / empty | |
| `CWP_JWT_PRIVATE_KEY` | empty | PKCS#8 PEM. Empty: throwaway key per start (local dev only) |
| `CWP_JWT_TTL` | `PT8H` | Token lifetime |
| `CWP_INTERNAL_TOKEN` | empty | Empty refuses every `/internal` call |

Generate a key: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`

## Run and test

```
mvn spring-boot:run      # or ./run-local.sh at the repo root
mvn test
```
