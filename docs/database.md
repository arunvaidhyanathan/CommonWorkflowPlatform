# Database

One PostgreSQL (15+) database, `cwp`, with one schema and one login role
per service. Scripts live in [`database/`](../database) and are all safe to
re-run.

## Layout

| Schema | Owner role | Service | Tables |
|---|---|---|---|
| `identity` | `cwp_identity` | identity-service | `users` (username, bcrypt `password_hash`), `tenants`, `profiles` (tenant, role, status), `group_members`, `invites` |
| `design` | `cwp_design` | design-service | `workflows`, `workflow_versions` (immutable), `approval_requests`, `audit_logs` + trigger functions |
| `runtime` | `cwp_runtime` | flowable-wrapper | `deployments` and Liquibase's tables (changelog in the service) plus Flowable's ~60 `ACT_*` tables |
| `spend` | `cwp_spend` | spend-tracker | `usage_events`, `provider_usage`, `key_checks`, `budgets`, `alerts`, `schema_migrations` |

Rules:

- Each role owns its schema and can't use any other (`database/check_roles.sh`
  proves it: 35 checks). Nobody but the administrator creates objects in `public`.
- No foreign key crosses schemas. `tenant_id` and user ids held outside
  `identity` are plain uuids; services keep them consistent through the API.
- Services enforce tenant isolation in code; there is no row-level security.

## Scripts

| Script | Run by | What |
|---|---|---|
| `00-roles.sql` | admin | The four login roles (passwords via psql variables) |
| `01-schemas.sql` | admin | `pgcrypto`, the four schemas owned by their roles, no `create` in `public` |
| `02-identity.sql` | admin (as `cwp_identity`) | identity tables and indexes |
| `03-design.sql` | admin (as `cwp_design`) | design tables, indexes, audit and workflow-status triggers |
| `90-seed-local.sql` | local dev only | One tenant, users admin / designer / approver (password `password`), KYC groups |
| `91-bootstrap-tenant.sql` | admin, once per tenant | A tenant and its first `tenant_admin` (values passed as psql variables) |
| `apply.sh` | admin / pipeline job | Runs 00–03 in order (`--seed-local` adds 90). Role passwords from `CWP_*_DB_PASSWORD` |
| `check_roles.sh` | anyone | Verifies each role reaches only its own schema |
| `docker-initdb/10-cwp.sh` | docker compose | Runs `apply.sh --seed-local` on the first start of the local `postgres` |

```
database/apply.sh --seed-local -- -d cwp                         # local
database/apply.sh -- -h <host> -U <admin> -d cwp                 # any environment
```

`runtime` and `spend` tables are not created here: flowable-wrapper applies
its Liquibase changelog and Flowable creates its own tables at startup;
spend-tracker applies its numbered migrations at startup. Both lock while
doing so, so replicas can start together.

## Design triggers

design-service sets `request.jwt.claims` (the acting user) on every write
transaction. The triggers in `03-design.sql` use it to:

- set a workflow to `pending_approval` / `approved` / `draft` as its approval
  request is submitted, approved or rejected;
- reset an approved workflow to `draft` when a new version is saved;
- write `audit_logs` rows for approval decisions, archive, delete and that reset.

identity-service's role and status changes reach `design.audit_logs` through
design-service's internal API, not a trigger.

## Changing the schema

- identity / design: add a new numbered script (e.g. `04-design-add-x.sql`),
  make it idempotent, add it to `apply.sh`, run it before rolling out the
  service version that needs it.
- runtime: a new Liquibase changeset in `services/flowable-wrapper`.
- spend: a new numbered file in `services/spend-tracker/src/spend_tracker/migrations/`.
- Never edit a script or changeset that has already been applied anywhere.

## Connections and growth

Pools per pod: identity 5, design 5, flowable-wrapper 10, spend-tracker 5.
Total = sum of `pool x replicas`; keep it under `max_connections` with room
for admin sessions, or add PgBouncer. Because no foreign key crosses
schemas, a service that outgrows the shared server moves to its own by
dumping its schema and changing its connection URL.
