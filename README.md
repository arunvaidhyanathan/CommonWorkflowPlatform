# Common Workflow Platform (CWP)

A multi-tenant platform to design BPMN, CMMN and DMN workflows, approve
them, deploy them to an embedded Flowable 8 engine and run the work. Seven
independently deployable services behind one internal gateway, on one
PostgreSQL database with a schema per service.

## Layout

| Path | What it is |
|---|---|
| `services/gateway/` | nginx entry point: routes `/api/*` to the services and `/` to web-app |
| `services/web-app/` | The browser app (React + Vite), served by nginx |
| `services/identity-service/` | Login, RS256 tokens + JWKS, tenants, members, groups, invites (Java 21 / Spring Boot 4) |
| `services/design-service/` | Workflows, immutable versions, approvals, audit log (Java 21 / Spring Boot 4) |
| `services/flowable-wrapper/` | Flowable 8 engine host: deploy, start, claim, complete, jobs, decisions (Java 21 / Spring Boot 4) |
| `services/agentic-designer/` | AI-assisted workflow authoring (Python / FastAPI) |
| `services/spend-tracker/` | API spend, budgets and key health (Python / FastAPI) |
| `database/` | Ordered SQL scripts (roles, schemas, tables), `apply.sh`, role check, local seed |
| `docs/` | Architecture, OpenShift deployment, database, operations, local development, code maps |

Each service folder is self-contained (code, Dockerfile, README, tests) and
builds on its own: `docker build services/<service>`.

## Start here

- Deploy to OpenShift: [docs/deployment-openshift.md](docs/deployment-openshift.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Run locally: [docs/local-development.md](docs/local-development.md)

Quick local run:

```
createdb cwp && database/apply.sh --seed-local -- -d cwp
./run-local.sh     # http://localhost:5173, users admin / designer / approver, password "password"
```
