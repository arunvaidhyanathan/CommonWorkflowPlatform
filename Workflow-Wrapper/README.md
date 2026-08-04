# Runtime Gateway (Workflow Wrapper)

CWP's second backend: a Java service embedding a real Flowable 8.0.0
engine, sitting alongside the existing Supabase (Postgres + Auth + Edge
Functions) backend. Full architecture rationale lives in
[`Documents/WorkflowWrapper.html`](../Documents/WorkflowWrapper.html) --
read that first if anything below is unclear.

## What this is (and isn't)

This is **Phase 1, 2, and 7** of WorkflowWrapper.html's Section 9 roadmap,
plus Governance Phase 4 (the deploy-authority SoD check).

An earlier version of this service was a "thin API layer" with no real
engine behind it, because Flowable's stable line was believed not to run
on Spring Boot 4. That was true when first checked in isolation, but
**Flowable Open Source 8.0.0 shipped official Spring Boot 4 support in
February 2026** and this wasn't rechecked until later -- see
WorkflowWrapper.html Section 4 for the full correction. As of this
revision:

- Real: JWT authentication against Supabase Auth, tenant-scoped
  persistence into a genuine `runtime` schema in the shared Supabase
  Postgres project, a `POST/GET /runtime/deployments` API that deploys
  each manifest artifact to a real, embedded Flowable engine
  (`RepositoryService`/`CmmnRepositoryService`/`DmnRepositoryService`
  depending on `specType`), a deploy-authority check gating who may
  deploy, and `/runtime/case-instances` / `/runtime/history/task-instances`
  reading real data from the embedded `CmmnRuntimeService`/`HistoryService`.
- Still stubbed: `/runtime/form-definitions/{id}`. Not an engine-embedding
  problem -- Flowable's standalone Form Engine (a separate, independently
  versioned form-definition repository) was deprecated as of Flowable
  7.0.1 and isn't part of `flowable-spring-boot-starter` 8.0.0. Flowable 8's
  actual form mechanism is the Process/CMMN engine's own `FormService`,
  tied to a specific definition's embedded form key rather than a
  browsable repository -- this endpoint needs a real redesign against
  that API, not just wiring (WorkflowWrapper.html Section 10).

## NOT YET COMPILED

This project was hand-written in a sandboxed environment with only JDK 11
installed, no Maven, and no network access to resolve dependencies. Every
file was reviewed carefully against Flowable's official Spring Boot
integration docs, but **none of it has been compiled, run, or tested.**
The Flowable engine-embedding code (deployment, case-instance, and history
wiring) is materially riskier uncompiled surface area than the original
thin layer was -- treat this as genuinely unverified, not a formality.
Before trusting this code:

```
mvn clean verify
```

on a machine with JDK 21 and normal network access. Fix whatever that
turns up (dependency version mismatches against the real Spring Boot 4.0
GA release, or against Flowable 8.0.0's actual released API, are the most
likely surprises) before deploying anywhere.

## Prerequisites

- JDK 21 (not 25 -- see the note on `pom.xml`'s `java.version`: Spring Boot
  4.0 supports both, but Flowable's own official system requirements only
  list Java 17 or 21 as supported, not 25)
- Maven 3.9+
- Network access to Maven Central and to the Supabase project below
- A Postgres role scoped to the `runtime` schema (see "Database setup")

## Configuration

All configuration is environment-variable driven (`application.yml`).
Nothing in that file is a real credential.

| Variable | Purpose | Local default |
|---|---|---|
| `RUNTIME_GATEWAY_DB_URL` | JDBC URL, direct Postgres connection (not PostgREST) | `jdbc:postgresql://localhost:5432/postgres?currentSchema=runtime` |
| `RUNTIME_GATEWAY_DB_USER` | Postgres role, scoped to `runtime` schema only | `runtime_gateway_service` |
| `RUNTIME_GATEWAY_DB_PASSWORD` | That role's password | *(none -- must be set)* |
| `SUPABASE_JWKS_URL` | Supabase Auth JWKS endpoint | `https://nrhsoabqeskybrznxfyi.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_MODE` | `jwks` (default) or `hs256` (legacy Supabase projects) | `jwks` |
| `SUPABASE_JWT_HS256_SECRET` | Only used when `SUPABASE_JWT_MODE=hs256` | *(none)* |
| `PORT` | HTTP port | `8081` |

Confirm which JWT signing mode project `nrhsoabqeskybrznxfyi` actually uses
in the Supabase dashboard (Project Settings -> API -> JWT Settings) before
relying on the `jwks` default in anything beyond local development.

## Database setup

The `runtime` schema and `runtime.deployments` table are defined as
Liquibase changesets in `src/main/resources/db/changelog/`. That exact SQL
has already been applied directly to the live Supabase project as part of
scaffolding this service (ahead of the service itself ever connecting), so
that the schema exists and other CWP work isn't blocked on this service's
first successful boot.

**The first time this service connects to that project**, run:

```
mvn liquibase:changelogSync
```

(or the equivalent Spring Boot Actuator/Liquibase API) so Liquibase marks
changeset `001-init-runtime-schema.sql` as already applied instead of
re-running `create schema`/`create table` and failing on "already exists."
Any changesets added *after* this point will run normally.

You will also need to create the `runtime_gateway_service` Postgres role
yourself and set its password -- this was deliberately left for you to do
directly in the Supabase SQL editor rather than handled here, since this
service should never see or generate that credential. Grant `USAGE` and
`CREATE` on schema `runtime` (not just `SELECT/INSERT/UPDATE` on
`runtime.deployments` -- `CREATE` is now required because
`flowable.database-schema-update=true` needs this role to create and
manage Flowable's own tables in the same schema on boot), and nothing on
`public`.

## Running locally

```
mvn spring-boot:run
```

Health check: `GET http://localhost:8081/actuator/health` (unauthenticated).
Everything under `/runtime/**` requires a valid Supabase-issued JWT in the
`Authorization: Bearer <token>` header.

## API surface

| Method | Path | Status |
|---|---|---|
| `POST` | `/runtime/deployments` | Real. Requires `tenant_admin` role (Governance.html Section 11.3, provisional). Deploys each `manifest` artifact (`definitionKey`/`name`/`specType`/`xml`) to the matching Flowable engine (BPMN/CMMN/DMN) and records the resulting engine deployment id(s) in `engine_deployment_ids_json`. |
| `GET` | `/runtime/deployments` | Real. Tenant-scoped list, including manifest and engine deployment ids. |
| `GET` | `/runtime/deployments/{id}` | Real. 404 outside caller's tenant. |
| `GET` | `/runtime/case-instances` | Real. Queries the embedded `CmmnRuntimeService`, tenant-scoped. |
| `GET` | `/runtime/form-definitions/{id}` | Stub. Always 404 -- needs a redesign, not just wiring (see above). |
| `GET` | `/runtime/history/task-instances` | Real. Queries the embedded (BPMN) `HistoryService`, tenant-scoped. CMMN task history not included yet. |

See WorkflowWrapper.html Section 8 for the full contract and Section 9 for
what's still not built (Designer's Form Builder, deployment target
mapping, tenant-aware seed bundles, and dynamic form rendering).
