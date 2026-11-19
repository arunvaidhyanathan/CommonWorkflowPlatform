# CWP architecture

The Common Workflow Platform lets tenants design BPMN, CMMN and DMN models,
get them approved, deploy them to an embedded Flowable 8 engine and run the
resulting work (tasks, cases, decisions, jobs). It is built as seven
independently deployable services behind one internal gateway, on one
PostgreSQL database with a schema per service.

## Services

| Service | Tech | Owns | Port | Public path |
|---|---|---|---|---|
| [gateway](../services/gateway/README.md) | nginx | Routing, CORS, per-client rate limits, request ids, access logs | 8080 | (entry point) |
| [web-app](../services/web-app/README.md) | React 19, Vite, nginx | The browser app | 8080 | `/` |
| [identity-service](../services/identity-service/README.md) | Java 21, Spring Boot 4 | Login, RS256 tokens + JWKS, tenants, members, task groups, invites | 8082 | `/api/identity` |
| [design-service](../services/design-service/README.md) | Java 21, Spring Boot 4 | Workflows, immutable versions, approvals, audit log | 8083 | `/api/design` |
| [flowable-wrapper](../services/flowable-wrapper/README.md) | Java 21, Spring Boot 4, Flowable 8 | Every engine endpoint: deploy, start, claim, complete, jobs, history, decisions, migrations | 8081 | `/api/flowable` |
| [agentic-designer](../services/agentic-designer/README.md) | Python 3.13, FastAPI | AI generate / edit / review of models (proposes; never saves or deploys) | 8090 | `/api/agent` |
| [spend-tracker](../services/spend-tracker/README.md) | Python 3.13, FastAPI | API spend, budgets, key health | 8095 | `/api/spend` |

Adding a capability means adding a service: its own folder, image, pipeline,
schema and role, plus one gateway `location`. Nothing else has to change.

## Request flow

1. The browser loads the SPA from web-app through the gateway.
2. It signs in with `POST /api/identity/auth/login`; identity-service checks
   the bcrypt password and returns an RS256 token (`sub` = user id,
   `app_metadata.tenant_id`, `app_metadata.role`, 8h by default).
3. Every API call carries the token. The gateway routes by path prefix and
   forwards it untouched; it never validates tokens.
4. Each service verifies the token against identity-service's
   `/.well-known/jwks.json` (keys cached) and scopes every query to the
   token's tenant in code.
5. Writes (saving, approving, deploying, task actions) re-check the caller's
   **current** role and active status with identity-service instead of
   trusting the token's role, cached up to 30 seconds per pod. A demotion or
   deactivation therefore takes effect within 30 seconds. If identity-service
   is unreachable, writes fail with 503 rather than trusting the token.

## Service-to-service calls

Internal endpoints live under `/internal/**`, require the shared
`X-Internal-Token`, and are never routed by the gateway.

| Caller | Calls | Why |
|---|---|---|
| design-service, flowable-wrapper | identity-service `GET /internal/identity/tenants/{t}/members/{u}` | Role, status and task candidate groups |
| identity-service | design-service `POST /internal/design/audit` | Role and status changes go into the one tenant audit log, inside the change's transaction (no unaudited change) |
| every service | identity-service `GET /.well-known/jwks.json` | Token verification key |
| agentic-designer | spend-tracker `POST /events` (`X-Ingest-Token`) | Usage metering of LLM calls |

## Data

One PostgreSQL database `cwp`; one schema and one login role per service
(details: [database.md](database.md)):

| Schema | Role | Service | Created by |
|---|---|---|---|
| `identity` | `cwp_identity` | identity-service | `database/02-identity.sql` |
| `design` | `cwp_design` | design-service | `database/03-design.sql` (tables + audit/status triggers) |
| `runtime` | `cwp_runtime` | flowable-wrapper | Liquibase + Flowable at startup |
| `spend` | `cwp_spend` | spend-tracker | its own migrations at startup |

A service can't read another service's schema (the roles get "permission
denied"), and no foreign key crosses schemas: a user or tenant id held by
design-service or flowable-wrapper is a plain reference. Each service can
therefore move to its own database server by changing its connection URL.
Build-time tests (`ServiceBoundaryTest`, `TableOwnershipTest`) fail if code
reaches into another service's tables.

## Production characteristics

- **Stateless services, horizontal scaling.** No service keeps session state;
  every replica serves any request. identity-service signs with one shared
  key (startup fails without it), Flowable coordinates async jobs across
  pods through database locks, and spend-tracker's migrations hold an
  advisory lock.
- **Container-ready.** Every image runs as an arbitrary non-root UID (OpenShift
  restricted SCC), sizes its JVM from the memory limit, exposes liveness and
  readiness probes, and shuts down gracefully.
- **Rate limiting at the edge** per real client IP (X-Forwarded-For trusted
  only from the router's network); agentic-designer adds a per-tenant limit.
- **Observability:** JSON access logs with a request id that is forwarded to
  every service and returned to the client (`X-Request-Id`).

Known limits worth planning for: the role/status cache is per pod (up to 30s
lag); per-pod rate limits multiply with replicas; spend-tracker's hourly key
check runs on every pod; agent grounding in tenant workflows is built but
switched off until a store reading design-service's workflows is added.

## Repository layout

```
services/<service>/   one folder per deployable: code, Dockerfile, README, tests
database/             ordered SQL scripts, apply.sh, role check, local seed
docs/                 platform docs (this folder); archive/ = design history; code-maps/
docker-compose.yml    the same images wired together on one machine
run-local.sh          every service natively, for development
```
