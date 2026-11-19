# Operations

## Health and probes

| Service | Liveness | Readiness |
|---|---|---|
| identity-service, design-service, flowable-wrapper | `/actuator/health/liveness` | `/actuator/health/readiness` |
| agentic-designer, spend-tracker | `/healthz` | `/healthz` |
| gateway, web-app | `/healthz` | `/healthz` |

## Secrets

| Secret | Used by | Rotation |
|---|---|---|
| Role passwords (`cwp_identity`, `cwp_design`, `cwp_runtime`, `cwp_spend`) | each service for its own role | `alter role ... password`, update the Secret, restart that service |
| `CWP_JWT_PRIVATE_KEY` (PKCS#8 RSA) | identity-service (every replica) | Replace, restart identity-service; users sign in again |
| `CWP_INTERNAL_TOKEN` | identity, design, flowable-wrapper | Replace, restart the three together |
| `SPEND_INGEST_TOKEN` | agentic-designer, spend-tracker | Replace, restart both |
| LLM provider keys | agentic-designer, spend-tracker | Replace, restart both |

## Logs and tracing

- The gateway writes one JSON line per request: time, request id, client IP,
  method, URI, status, bytes, duration, upstream and upstream duration.
- `X-Request-Id` is kept from the caller or minted by the gateway, forwarded
  to the service and returned to the client. Quote it when reporting an error.
- Services log to stdout. agentic-designer and spend-tracker log alerts as
  `ALERT ...` lines.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Every API call returns 401 after an identity-service restart | It ran without `CWP_JWT_PRIVATE_KEY` (local only) and made a new key | Sign in again; on OpenShift always set the shared key |
| identity-service won't start: "CWP_JWT_PRIVATE_KEY is not set" | Missing key Secret | Mount the `cwp-jwt` Secret |
| Writes fail with 503 "Could not check your membership" | identity-service down, or `CWP_INTERNAL_TOKEN` differs between services | Restore identity-service; align the token |
| Role or status change fails with 503 "Could not record this change in the audit log" | design-service down, or token mismatch | Restore design-service; nothing was changed |
| A service logs "permission denied for table/schema" | It points at the wrong schema/role, or `database/apply.sh` was not run | Check its DB URL and user; run `apply.sh`, then `check_roles.sh` |
| flowable-wrapper fails at first start with Liquibase lock errors | Several replicas raced on an empty schema | Scale to 1 for the first rollout; clear a stale lock with Liquibase's `releaseLocks` if needed |
| Gateway returns 502 on one route | That service has no ready pods, or its `*_UPSTREAM` / `NGINX_RESOLVER` is wrong | `oc get pods`; check the gateway's environment (fully qualified names) |
| Every user is rate-limited together (429) | `TRUSTED_PROXY_CIDR` doesn't cover the router, so all traffic looks like one IP | Set it to the cluster's pod network |

## Scaling notes

- All services are stateless; scale with HPAs (see
  [deployment-openshift.md](deployment-openshift.md#9-scaling-for-load)).
- Per-pod effects: gateway rate limits and agentic-designer's per-tenant
  limit multiply with replicas; identity lookups are cached per pod (up to
  30s); spend-tracker's key check runs on every pod.
- PostgreSQL connections grow with replicas; see [database.md](database.md#connections-and-growth).
