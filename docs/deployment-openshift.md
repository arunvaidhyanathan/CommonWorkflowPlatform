# Deploying CWP on OpenShift

Step by step, from an empty OpenShift project and a new PostgreSQL database to
a running, horizontally scalable platform. Every service is an independent
image with its own pipeline; only the gateway is exposed outside the cluster.

```
            Route (TLS)
                |
             gateway  ---------------------------> web-app
                |  /api/identity  /api/design  /api/flowable  /api/agent  /api/spend
     +----------+----------+-------------+-------------+-------------+
 identity-service  design-service  flowable-wrapper  agentic-designer  spend-tracker
     |  ^   |          |  ^               |     |            |    \          |
     |  |   +-- audit -+  |               |     +- LLM APIs  +-usage events-+
     |  +-- role lookups (internal, X-Internal-Token) --+
     |                 |                  |                                 |
     +------------- PostgreSQL `cwp`: schemas identity | design | runtime | spend ----+
```

## 0. What you need

| Item | Notes |
|---|---|
| OpenShift 4.x project | e.g. `cwp`. Default `restricted-v2` SCC is enough: every image runs as an arbitrary non-root UID |
| Image registry | OpenShift internal registry or your own; one repository per service |
| PostgreSQL 15 or 16 | Operator-managed (e.g. Crunchy PGO / Red Hat) or managed service. Extension `pgcrypto` (only for the seed/bootstrap scripts) |
| An admin login on that PostgreSQL | Superuser or a role with `CREATEROLE` and `CREATE` on the database, to run `database/` once |
| SMTP relay (optional) | For BPMN mail tasks (`CWP_MAIL_HOST`) |
| LLM API keys (optional) | Gemini / NVIDIA / OpenRouter for agentic-designer |

## 1. Create the project

```
oc new-project cwp
```

## 2. Prepare PostgreSQL

1. Create the database: `create database cwp;`
2. Size connections: every pod holds a pool. Defaults: identity 5, design 5,
   flowable-wrapper 10, spend-tracker 5 per pod. With 3 replicas each that is
   75 connections; set `max_connections` with headroom, or put PgBouncer
   (transaction pooling) in front for large replica counts.
3. Generate four role passwords and keep them in a Secret (step 3).
4. Run the scripts once, as the admin, from any pod or job that has `psql`
   and the repo's `database/` folder (an OpenShift `Job` in your pipeline,
   or `oc rsh` into the PostgreSQL pod):

   ```
   export PGPASSWORD=<admin password from your DB secret>
   export CWP_IDENTITY_DB_PASSWORD=... CWP_DESIGN_DB_PASSWORD=... \
          CWP_RUNTIME_DB_PASSWORD=... CWP_SPEND_DB_PASSWORD=...
   database/apply.sh -- -h <postgres-service> -U <admin> -d cwp
   ```

   This creates roles `cwp_identity`, `cwp_design`, `cwp_runtime`,
   `cwp_spend`, one schema per service owned by its role, and the identity
   and design tables. Every script is safe to re-run. Do **not** pass
   `--seed-local` outside local development.
5. Create the first tenant and its admin (once per tenant):

   ```
   psql -h <postgres-service> -U <admin> -d cwp -v tenant_name='Acme Bank' -v tenant_slug=acme \
        -v admin_username=acme-admin -v admin_password="$ADMIN_PASSWORD" -f database/91-bootstrap-tenant.sql
   ```
6. Prove the isolation: `bash database/check_roles.sh -h <postgres-service> -d cwp`
   (35 checks; needs the role passwords in `~/.pgpass` or trust from that pod).

flowable-wrapper and spend-tracker create their own tables in `runtime` and
`spend` on first start. Details: [database.md](database.md).

## 3. Secrets and config

Create these once (values from your vault; never commit them):

```
oc create secret generic cwp-db \
  --from-literal=identity-password=... --from-literal=design-password=... \
  --from-literal=runtime-password=...  --from-literal=spend-password=...

oc create secret generic cwp-jwt --from-file=private-key.pem=./cwp-jwt.pem
#   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out cwp-jwt.pem

oc create secret generic cwp-internal \
  --from-literal=internal-token="$(openssl rand -hex 32)" \
  --from-literal=spend-ingest-token="$(openssl rand -hex 32)"

oc create secret generic cwp-llm \
  --from-literal=gemini-api-key=... --from-literal=nvidia-api-key=... --from-literal=openrouter-api-key=...
```

One ConfigMap per service holds the non-secret settings in
[the configuration table below](#5-configuration-per-service).

## 4. Build the images (one pipeline per service)

Every service builds from its own folder; no pipeline needs any other
service's code:

| Service | Build context | Test step | Port |
|---|---|---|---|
| gateway | `services/gateway` | `nginx -t` on the rendered template | 8080 |
| web-app | `services/web-app` | `npm ci && npm run lint && npm run build` | 8080 |
| identity-service | `services/identity-service` | `mvn verify` | 8082 |
| design-service | `services/design-service` | `mvn verify` | 8083 |
| flowable-wrapper | `services/flowable-wrapper` | `mvn verify` | 8081 |
| agentic-designer | `services/agentic-designer` | `uv sync && uv run pytest` | 8090 |
| spend-tracker | `services/spend-tracker` | `uv sync && uv run pytest` (needs Docker or a test PostgreSQL) | 8095 |

```
docker build -t <registry>/cwp/<service>:<version> services/<service>
docker push <registry>/cwp/<service>:<version>
```

(or an OpenShift `BuildConfig` with `contextDir: services/<service>` and the
Docker strategy). Tag images immutably (git SHA); deploy by digest.

## 5. Configuration per service

`<ns>` is the project, e.g. `cwp`. Internal URLs use Services
(`http://<service>.<ns>.svc.cluster.local:<port>`); the gateway needs fully
qualified names because nginx's resolver ignores search domains.

| Service | Settings (ConfigMap) | From Secrets |
|---|---|---|
| identity-service | `IDENTITY_DB_URL=jdbc:postgresql://<pg>:5432/cwp?currentSchema=identity`, `IDENTITY_DB_USER=cwp_identity`, `DESIGN_SERVICE_URL=http://design-service.<ns>.svc:8083` | `IDENTITY_DB_PASSWORD`, `CWP_JWT_PRIVATE_KEY` (same for every replica), `CWP_INTERNAL_TOKEN` |
| design-service | `DESIGN_DB_URL=...?currentSchema=design`, `DESIGN_DB_USER=cwp_design`, `IDENTITY_SERVICE_URL=http://identity-service.<ns>.svc:8082`, `IDENTITY_JWKS_URL=http://identity-service.<ns>.svc:8082/.well-known/jwks.json` | `DESIGN_DB_PASSWORD`, `CWP_INTERNAL_TOKEN` |
| flowable-wrapper | `WORKFLOW_RUNTIME_DB_URL=...?currentSchema=runtime`, `WORKFLOW_RUNTIME_DB_USER=cwp_runtime`, `IDENTITY_SERVICE_URL`, `IDENTITY_JWKS_URL`, `CWP_MAIL_HOST`, `CWP_MAIL_PORT` | `WORKFLOW_RUNTIME_DB_PASSWORD`, `CWP_INTERNAL_TOKEN` |
| agentic-designer | `IDENTITY_JWKS_URL`, `AGENT_PROVIDER`, `AGENT_MODEL`, `AGENT_TENANT_RPM`, `SPEND_TRACKER_URL=http://spend-tracker.<ns>.svc:8095` | `GEMINI_API_KEY` / `NVIDIA_API_KEY` / `OPENROUTER_API_KEY`, `SPEND_INGEST_TOKEN` |
| spend-tracker | `IDENTITY_JWKS_URL`, `SPEND_ADMIN_USER_IDS`, `SPEND_KEY_CHECK_INTERVAL_S` | `SPEND_DATABASE_URL=postgresql://cwp_spend:<pw>@<pg>:5432/cwp?options=-csearch_path%3Dspend`, `SPEND_INGEST_TOKEN`, provider keys |
| web-app | none | none |
| gateway | `NGINX_RESOLVER=dns-default.openshift-dns.svc.cluster.local`, `*_UPSTREAM=<service>.<ns>.svc.cluster.local:<port>` (6 of them), `TRUSTED_PROXY_CIDR=<cluster pod network>`, `CORS_ALLOWED_ORIGINS`, `API_RATE_LIMIT`, `AGENT_RATE_LIMIT` | none |

Never set `CWP_JWT_ALLOW_EPHEMERAL_KEY` on OpenShift: without it,
identity-service refuses to start when the shared key is missing.

## 6. Deploy

For each service: a `Deployment`, a `ClusterIP` `Service` on its port, the
probes below, resource requests/limits, and a `HorizontalPodAutoscaler`.
Order the first rollout by dependency:

1. **identity-service** (everyone verifies tokens against its JWKS)
2. **design-service**
3. **flowable-wrapper**, with **1 replica** for the very first rollout so a
   single pod creates Flowable's tables; scale up afterwards
4. **spend-tracker**, then **agentic-designer**
5. **web-app**
6. **gateway**, then expose it: `oc create route edge cwp --service=gateway --port=8080`
   (add your hostname and certificate)

| Service | Liveness | Readiness | Startup budget |
|---|---|---|---|
| Java services | `/actuator/health/liveness` | `/actuator/health/readiness` | startupProbe up to ~120s (flowable-wrapper's first start creates ~65 tables) |
| agentic-designer, spend-tracker | `/healthz` | `/healthz` | 30s |
| gateway, web-app | `/healthz` | `/healthz` | 10s |

Set `terminationGracePeriodSeconds` to 30 for the Java services (graceful
shutdown waits up to 25s) and 330 for agentic-designer (streams run up to 300s).

Example (identity-service; the others follow the same shape):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: identity-service }
spec:
  replicas: 2
  selector: { matchLabels: { app: identity-service } }
  template:
    metadata: { labels: { app: identity-service } }
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: identity-service
          image: <registry>/cwp/identity-service@sha256:<digest>
          ports: [{ containerPort: 8082 }]
          envFrom: [{ configMapRef: { name: identity-service } }]
          env:
            - { name: IDENTITY_DB_PASSWORD, valueFrom: { secretKeyRef: { name: cwp-db, key: identity-password } } }
            - { name: CWP_JWT_PRIVATE_KEY, valueFrom: { secretKeyRef: { name: cwp-jwt, key: private-key.pem } } }
            - { name: CWP_INTERNAL_TOKEN, valueFrom: { secretKeyRef: { name: cwp-internal, key: internal-token } } }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits:   { memory: 768Mi }
          startupProbe:   { httpGet: { path: /actuator/health/liveness, port: 8082 }, periodSeconds: 5, failureThreshold: 24 }
          livenessProbe:  { httpGet: { path: /actuator/health/liveness, port: 8082 }, periodSeconds: 10 }
          readinessProbe: { httpGet: { path: /actuator/health/readiness, port: 8082 }, periodSeconds: 5 }
---
apiVersion: v1
kind: Service
metadata: { name: identity-service }
spec: { selector: { app: identity-service }, ports: [{ port: 8082, targetPort: 8082 }] }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: identity-service }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: identity-service }
  minReplicas: 2
  maxReplicas: 6
  metrics: [{ type: Resource, resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } } }]
```

## 7. Lock down the network

`NetworkPolicy` per service:

- gateway: ingress only from the OpenShift router (`openshift-ingress` namespace).
- web-app and every API service: ingress only from the gateway, plus the
  internal callers: identity-service from design-service and
  flowable-wrapper; design-service from identity-service; spend-tracker
  from agentic-designer.
- PostgreSQL: ingress only from identity-service, design-service,
  flowable-wrapper, spend-tracker and the migration job.
- Egress to the internet only for agentic-designer and spend-tracker (LLM
  provider APIs).

`/internal/**` is already refused by the gateway; the policies make sure it
is reachable only from the listed services as well.

## 8. Verify

```
GW=https://<route-host>
curl -s $GW/healthz                                          # {"status":"ok"}
curl -s -X POST $GW/api/identity/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"acme-admin","password":"..."}'          # 200 + token
TOKEN=...
for p in identity/me design/workflows flowable/definitions spend/healthz agent/healthz; do
  curl -s -o /dev/null -w "$p %{http_code}\n" -H "Authorization: Bearer $TOKEN" $GW/api/$p
done                                                         # all 200
curl -s -o /dev/null -w '%{http_code}\n' $GW/internal/identity/x   # 404
```

Then open `$GW` in a browser and sign in.

## 9. Scaling for load

| Service | Min / max replicas (start) | Scales on | Notes |
|---|---|---|---|
| gateway | 2 / 6 | CPU | Rate limits are per pod (`rate x replicas`) |
| web-app | 2 / 4 | CPU | Static files; cheap |
| identity-service | 2 / 6 | CPU | Every login and every write's role lookup (cached 30s per pod) |
| design-service | 2 / 6 | CPU | |
| flowable-wrapper | 2 / 10 | CPU | Every pod also runs the async job executor; Flowable locks jobs so each runs once. Watch DB connections |
| agentic-designer | 2 / 4 | CPU or concurrent streams | Long-lived SSE requests; per-tenant RPM limit is per pod |
| spend-tracker | 1 / 2 | CPU | Low traffic; every pod runs the hourly key check |

Add a `PodDisruptionBudget` (`minAvailable: 1`) per service. PostgreSQL is
the shared bottleneck: give it the most attention (connection limits,
PgBouncer, read replicas later, backups). Each service already owns its own
schema with no cross-schema foreign keys, so a busy service can move to its
own database server by changing only its connection URL.

## 10. Day-2 operations

- **Releases:** rolling updates; Java services drain in-flight requests on SIGTERM.
- **Schema changes:** identity and design: add a new numbered script under
  `database/` and run `database/apply.sh` before rolling the service;
  runtime: a new Liquibase changeset in flowable-wrapper; spend: a new
  numbered migration in spend-tracker. Never edit an applied script.
- **Signing key rotation:** replace the `cwp-jwt` Secret and restart
  identity-service; everyone signs in again (the JWKS holds one key).
- **Internal token rotation:** update `cwp-internal` and restart identity,
  design and flowable-wrapper together.
- **Backups:** one PostgreSQL database holds all state; back it up
  (operator-managed PITR). Containers are stateless.
- More: [operations.md](operations.md).
