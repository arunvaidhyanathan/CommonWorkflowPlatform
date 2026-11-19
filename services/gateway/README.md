# gateway

CWP's single internal entry point (nginx). Routes `/api/*` to the services
and every other path to web-app. Owns CORS, per-client rate limits, request
ids and JSON access logs. It does **not** validate tokens: every service
verifies the login token itself against identity-service's JWKS.

| Path | Goes to |
|---|---|
| `/healthz` | the gateway itself |
| `/api/identity/**` | identity-service `/identity/**` |
| `/api/design/**` | design-service `/design/**` |
| `/api/flowable/**` | flowable-wrapper `/runtime/**` |
| `/api/agent/**` | agentic-designer `/**` (server-sent events, 300s read timeout, own rate limit) |
| `/api/spend/**` | spend-tracker `/**`; `/api/spend/events` returns 404 (internal only) |
| `/internal/**`, any other `/api/**` | 404 |
| everything else | web-app |

Config: `templates/cwp.conf.template` (rendered from the environment at
start) and `snippets/cwp-api.conf` (CORS, preflight and proxy headers shared
by every API route). Adding a service = one `location` block plus one
`*_UPSTREAM` variable.

## Configuration

| Variable | Default (compose) | OpenShift |
|---|---|---|
| `NGINX_RESOLVER` | `127.0.0.11` | `dns-default.openshift-dns.svc.cluster.local` |
| `WEB_APP_UPSTREAM` | `web-app:8080` | `web-app.<ns>.svc.cluster.local:8080` |
| `IDENTITY_SERVICE_UPSTREAM` | `identity-service:8082` | `identity-service.<ns>.svc.cluster.local:8082` |
| `DESIGN_SERVICE_UPSTREAM` | `design-service:8083` | `design-service.<ns>.svc.cluster.local:8083` |
| `FLOWABLE_WRAPPER_UPSTREAM` | `flowable-wrapper:8081` | `flowable-wrapper.<ns>.svc.cluster.local:8081` |
| `AGENTIC_DESIGNER_UPSTREAM` | `agentic-designer:8090` | `agentic-designer.<ns>.svc.cluster.local:8090` |
| `SPEND_TRACKER_UPSTREAM` | `spend-tracker:8095` | `spend-tracker.<ns>.svc.cluster.local:8095` |
| `TRUSTED_PROXY_CIDR` | `10.0.0.0/8` | the cluster's pod network (router pods); X-Forwarded-For is trusted only from here |
| `API_RATE_LIMIT` / `AGENT_RATE_LIMIT` | `50r/s` / `2r/s` | per real client IP |
| `CORS_ALLOWED_ORIGINS` | `^http://localhost:5173$` | regex of browser origins allowed cross-origin |

Upstreams are resolved per request, so the gateway starts even when a
service isn't deployed (that route returns 502). nginx's resolver does not
use search domains: give fully qualified service names on OpenShift.

## Container

- Build: `docker build -t cwp/gateway services/gateway` (context = this folder).
- Base `nginx-unprivileged`: port 8080, runs as any UID (restricted SCC).
- Probes: `GET /healthz` (liveness and readiness).
- Stateless: scale horizontally freely. Rate limits are per pod (each pod
  counts its own clients), so the effective limit is `rate x replicas`.
