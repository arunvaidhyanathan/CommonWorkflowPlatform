# flowable-wrapper

CWP's Flowable engine host: a Java 21 / Spring Boot 4 service embedding
Flowable 8 (BPMN, CMMN, DMN and app engines). It owns every engine endpoint
(deploy, start, claim, complete and the rest) and nothing else. Login and
members live in [identity-service](../identity-service/README.md); workflows,
versions, approvals and the audit log in [design-service](../design-service/README.md).
Port 8081.

Browsers reach it through the nginx gateway at `/api/flowable/**`, which
forwards here as `/runtime/**`. Platform architecture:
[`docs/architecture.md`](../../docs/architecture.md); design history:
[`docs/archive/WorkflowWrapper.html`](../../docs/archive/WorkflowWrapper.html).

## Auth and access

- Login tokens are issued by identity-service (RS256) and verified here
  against its JWKS (`IDENTITY_JWKS_URL`). This service holds no signing secret.
- Every query is scoped to the token's tenant (Flowable's tenant id is the
  CWP tenant id).
- Writes re-check the caller's role and active status, and task candidate
  groups come from identity-service, through `identity.IdentityDirectory`
  (`HttpIdentityDirectory`: `GET /internal/identity/tenants/{t}/members/{u}`
  with `X-Internal-Token`, cached for `IDENTITY_CACHE_TTL`, default 30s).
  If identity-service is unreachable, writes fail with 503.
- Deploying is `tenant_admin` only. Script tasks are off unless
  `CWP_SCRIPTS_ENABLED=true`; deployed expressions are sandboxed (no Spring
  beans, no reflection).

## Data

Connects as the `cwp_runtime` role, which owns the `runtime` schema (created
by `database/01-schemas.sql`). At startup Liquibase applies
`src/main/resources/db/changelog/` and Flowable creates or upgrades its own
`ACT_*` tables there; both hold a database lock, so replicas can start
together. It has no access to the identity, design or spend schemas.
`ServiceBoundaryTest` fails the build if code here queries another
service's tables.

## API (`/runtime/**`, public `/api/flowable/**`)

| Area | Endpoints |
|---|---|
| Deployments | `GET/POST /runtime/deployments`, `GET /runtime/deployments/{id}` |
| Definitions | `GET /runtime/definitions`, `GET /runtime/definitions/{kind}/{key}/versions` |
| Instances | `GET/POST /runtime/instances`, `GET/DELETE /runtime/instances/{kind}/{id}`, `PUT .../variables`, `GET .../timeline`, `GET/PUT .../business-status` |
| Process events and ad-hoc | `POST /runtime/instances/process/{id}/signal/{name}`, `.../message/{name}`, `.../adhoc/{activityId}`, `.../inject-task`; `POST /runtime/instances/case/{id}/inject-plan-item` |
| Tasks | `GET /runtime/tasks`, `GET /runtime/tasks/{id}`, `POST /runtime/tasks/{id}/claim`, `/unclaim`, `/complete` |
| Plan items | `POST /runtime/plan-items/{id}/{action}` |
| Jobs | `GET /runtime/jobs`, `POST /runtime/jobs/{id}/retry`, `/fire`, `GET .../stacktrace`, `DELETE /runtime/jobs/{id}` |
| Decisions | `GET /runtime/decisions`, `POST /runtime/decisions/{key}/evaluate` |
| Expressions | `POST /runtime/expressions/evaluate` |
| Migrations | `POST /runtime/migrations`, `/validate`, `/batch`, `GET /runtime/migrations/batches/{kind}/{id}` |
| History and views | `GET /runtime/history/task-instances`, `GET /runtime/case-instances`, `GET /runtime/form-definitions/{id}` (still a stub) |

Health: `/actuator/health/liveness` and `/actuator/health/readiness` (no token).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `WORKFLOW_RUNTIME_DB_URL` | `jdbc:postgresql://localhost:5432/cwp?currentSchema=runtime` | |
| `WORKFLOW_RUNTIME_DB_USER` / `WORKFLOW_RUNTIME_DB_PASSWORD` | `cwp_runtime` / empty | Secret on OpenShift |
| `WORKFLOW_RUNTIME_DB_POOL_SIZE` | `10` | Per pod: `pods x pool` must stay under PostgreSQL's connection limit |
| `IDENTITY_SERVICE_URL` / `IDENTITY_JWKS_URL` | `http://localhost:8082` / `.../.well-known/jwks.json` | |
| `IDENTITY_CACHE_TTL` | `PT30S` | Most a role, status or group change can lag |
| `CWP_INTERNAL_TOKEN` | empty | Must match identity-service's |
| `CWP_SCRIPTS_ENABLED` | `false` | Script tasks run in this JVM |
| `CWP_MAIL_HOST` / `CWP_MAIL_PORT` | `localhost` / `2525` | SMTP relay for mail tasks (OpenShift: your relay's Service) |
| `CWP_HISTORY_LEVEL` | `audit` | `full` keeps every variable change (`run-local.sh` uses it) |
| `CWP_ASYNC_EXECUTOR` | `true` | Timers, async steps and batch parts; `false` on pods that should only serve API calls |
| `PORT` | `8081` | |

## Container

- Build: `docker build -t cwp/flowable-wrapper services/flowable-wrapper`.
- Runs as non-root, any UID; heap = 75% of the container memory limit.
- Probes: `/actuator/health/liveness`, `/actuator/health/readiness`. Allow a
  generous startup probe (Flowable's schema check on first start).
- Scales horizontally: every pod runs Flowable's async job executor against
  the shared tables, and Flowable locks each job so only one pod runs it.
  For the very first rollout against an empty schema, start with one replica
  so a single pod creates Flowable's tables.

## Run and test

```
./run-local.sh                 # repo root: the whole stack (after database/apply.sh)
mvn spring-boot:run            # this service alone
mvn test                       # engine samples, sandbox, boundary and identity-cache tests
IDENTITY_CACHE_TTL=PT0S mvn spring-boot:run
python3 -I e2e/runtime_work_test.py   # 147 end-to-end checks; CWP_RUNTIME_BASE / CWP_IDENTITY_BASE / CWP_DB to point elsewhere
```

The e2e suite expects group changes to apply at once, hence
`IDENTITY_CACHE_TTL=PT0S`. Mail tasks land in `.local-logs/mailbox.txt`
via `e2e/smtp_sink.py`.
