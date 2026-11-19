# web-app

The CWP browser app (Designer, Workbench, Approvals, Administration, Workflow
Wrapper screens): React 19 + TypeScript + Vite. Served as static files by
nginx; the gateway routes every non-`/api` path here. It talks to the
platform only through `/api/*` on the same origin (`src/lib/apiClient.ts`).

| Calls | Service |
|---|---|
| `/api/identity/**` | sign-in, members, groups, invites, own profile |
| `/api/design/**` | workflows, versions, approvals, audit log |
| `/api/flowable/**` | publish, instances, tasks, jobs, decisions, migrations |
| `/api/agent/**` | AI generate / edit / review |
| `/api/spend/**` | API spend page |

## Configuration

`VITE_API_BASE_URL` is baked in at build time; the image uses `/api`
(same origin, behind the gateway). Nothing else is configured at runtime.

## Develop

```
npm ci
npm run dev        # http://localhost:5173; vite.config.ts proxies /api/* to services on localhost
npm run build      # tsc -b && vite build -> dist/
npm run lint
```

`../../run-local.sh` starts every service plus this dev server. Proxy
targets: `CWP_IDENTITY_URL`, `CWP_DESIGN_URL`, `CWP_RUNTIME_URL`,
`CWP_AGENT_URL`, `CWP_SPEND_URL` (defaults: localhost ports of
`run-local.sh`). `samples/` holds example BPMN/CMMN/DMN models.

## Container

- Build: `docker build -t cwp/web-app services/web-app` (context = this folder;
  `npm ci` and `vite build` run in the image).
- Base `nginx-unprivileged`: port 8080, runs as any UID (restricted SCC).
  `nginx.conf`: SPA fallback, one-year cache for hashed `/assets/`, no cache
  for `index.html` so a release takes effect at once.
- Probes: `GET /healthz`.
- Stateless: scale horizontally freely.
