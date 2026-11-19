# Local development

## Prerequisites

Java 21 + Maven, Node 22 + npm, Python 3.13 + [uv](https://docs.astral.sh/uv/),
PostgreSQL 15+ running locally, Docker (for compose and spend-tracker's tests).

## Option 1: every service natively (everyday)

```
createdb cwp
database/apply.sh --seed-local -- -d cwp      # roles, schemas, tables, seed users
./run-local.sh                                # http://localhost:5173
```

Sign in as `admin`, `designer` or `approver`, password `password`. Logs go
to `.local-logs/`; BPMN mail tasks land in `.local-logs/mailbox.txt`. The
Vite dev server proxies `/api/*` to the services (same routes as the
gateway). identity-service uses a throwaway signing key here, so restarting
it signs everyone out.

| Service | Local port |
|---|---|
| web-app (Vite) | 5173 |
| flowable-wrapper | 8081 |
| identity-service | 8082 |
| design-service | 8083 |
| agentic-designer | 8091 |
| spend-tracker | 8095 |

## Option 2: the real images (docker compose)

```
cp .env.example .env          # set the passwords and tokens (any values)
docker compose up -d --build  # http://localhost:8080
```

Builds every service from its own folder, exactly like its pipeline, and
starts PostgreSQL with the scripts and seed users on first start
(`docker compose down -v` resets it).

## Tests

| Service | Unit tests | End to end |
|---|---|---|
| identity-service | `mvn test` | via design-service and flowable-wrapper suites |
| design-service | `mvn test` | `bash services/design-service/e2e/design_api_test.sh` (32 checks) |
| flowable-wrapper | `mvn test` | `python3 -I services/flowable-wrapper/e2e/runtime_work_test.py` (147 checks) |
| agentic-designer | `uv run pytest` | |
| spend-tracker | `uv run pytest` (starts a throwaway PostgreSQL in Docker) | |
| web-app | `npm run lint && npm run build` | |
| database | | `bash database/check_roles.sh -d cwp` (35 checks) |

The e2e suites expect role and group changes to apply at once: start
design-service and flowable-wrapper with `IDENTITY_CACHE_TTL=PT0S`. Point
them elsewhere with `CWP_IDENTITY_BASE`, `CWP_DESIGN_BASE`,
`CWP_RUNTIME_BASE` (e.g. `http://localhost:5173/api/flowable`) and `CWP_DB`.
