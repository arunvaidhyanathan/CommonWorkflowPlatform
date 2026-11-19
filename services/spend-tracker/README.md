# Spend Tracker

What CWP's paid API calls cost, and whether each API key still works.
Python 3.13 / FastAPI. Port 8095. Database schema `spend`, role `cwp_spend`.
Public path `/api/spend/**`. Design history:
[`docs/archive/SpendTracker.html`](../../docs/archive/SpendTracker.html).

## Endpoints

| Route (via gateway `/api/spend`) | Who | What |
|---|---|---|
| `GET /summary?from=&to=&scope=` | `tenant_admin` (own tenant), platform admins (all) | Spend by provider, model, feature, tenant and day. Default range: month to date |
| `GET /keys` | platform admins | Latest check per key plus the outcome of the last metered call through it |
| `POST /keys/check` | platform admins | Run the key checks now |
| `POST /events` | services only (`X-Ingest-Token`); the gateway refuses it | Record one usage event |
| `GET /budgets` | platform admins | Monthly budgets (per provider or `total`) with this month's priced spend |
| `PUT /budgets/{subject}` / `DELETE` | platform admins | Set (`{"monthlyUsd": "50.00"}`) or remove a budget; setting one evaluates it immediately |
| `GET /alerts?status=open\|all` | platform admins | Budget, key and provider-limit alerts |
| `POST /alerts/{id}/ack` | platform admins | Dismiss an alert |

Platform admins are the user ids (identity-service) in `SPEND_ADMIN_USER_IDS`.

## Rules

- A call without a price is counted as **unpriced**, never folded into the dollar total.
- Key checks are free, read-only calls with the key in a header, never in a URL.
  A spend cap can't be seen by a free check; it shows up as the key's last call
  being `rate_limited`.
- The tracker receives only the keys it checks (`GEMINI_API_KEY`, `NVIDIA_API_KEY`,
  `OPENROUTER_API_KEY`, `TYPESAFE_JEV_API_KEY`), never a whole secrets file.

## Alerts

Raised where the evidence arrives, at most once while open (budget thresholds
once per month), and logged as `ALERT ...` lines:

| Kind | When | Level | Clears |
|---|---|---|---|
| `budget` | this month's priced spend reaches 80% / 100% of a budget | warning / critical | dismissed; not re-raised this month |
| `key_status` | a key check finds the key expired or invalid | critical | automatically when a check finds it valid |
| `key_refused` | a real call through a key is refused (429: rate limit, quota, spend cap) | warning | automatically when a later call succeeds |
| `provider_limit` | a provider-reported credit limit has under 20% left (OpenRouter) | warning | automatically when headroom returns |

Delivery is in the app (API Spend page) and the service log only; email or
Slack is not wired up.

## Configuration

| Variable | Notes |
|---|---|
| `SPEND_DATABASE_URL` | `postgresql://cwp_spend:<password>@<host>:5432/cwp?options=-csearch_path%3Dspend` (schema `spend`) |
| `IDENTITY_JWKS_URL` | identity-service's `/.well-known/jwks.json` |
| `SPEND_INGEST_TOKEN` | Shared with agentic-designer for `POST /events` |
| `SPEND_ADMIN_USER_IDS` | Comma-separated platform admin user ids |
| `SPEND_KEY_CHECK_INTERVAL_S` | Key-check period in seconds (default 3600; `0` = off) |
| `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `TYPESAFE_JEV_API_KEY` | Only the keys it checks |

## Container

- Build: `docker build -t cwp/spend-tracker services/spend-tracker`.
- Runs as non-root, any UID. Probe: `GET /healthz`.
- Migrations run at startup under a PostgreSQL advisory lock, so replicas can
  start together. Every pod runs the periodic key check; that only repeats a
  few free provider calls, but for many replicas set
  `SPEND_KEY_CHECK_INTERVAL_S=0` and run the check from one place.

## Develop

```
uv sync
uv run pytest     # starts a throwaway Postgres in Docker
```

Migrations are numbered files in `src/spend_tracker/migrations/`, applied once
each at startup into schema `spend`. Never edit an applied one; add a new file.
