# Spend Tracker

What CWP's paid API calls cost, and whether each API key still works.
Design and status: [`Documents/SpendTracker.html`](../../Documents/SpendTracker.html).

## Endpoints

| Route (via gateway `/api/spend`) | Who | What |
|---|---|---|
| `GET /summary?from=&to=&scope=` | `tenant_admin` (own tenant), platform admins (all) | Spend by provider, model, feature, tenant and day. Default range: month to date |
| `GET /keys` | platform admins | Latest check per key plus the outcome of the last metered call through it |
| `POST /keys/check` | platform admins | Run the key checks now |
| `POST /events` | services only (`X-Ingest-Token`); the gateway refuses it | Record one usage event |

Platform admins are the Supabase user ids in `SPEND_ADMIN_USER_IDS`.

## Rules

- A call without a price is counted as **unpriced**, never folded into the dollar total.
- Key checks are free, read-only calls with the key in a header, never in a URL.
  A spend cap can't be seen by a free check; it shows up as the key's last call
  being `rate_limited`.
- The tracker receives only the keys it checks (`GEMINI_API_KEY`, `NVIDIA_API_KEY`,
  `OPENROUTER_API_KEY`, `TYPESAFE_JEV_API_KEY`), never a whole secrets file.

## Develop

```
uv sync
uv run pytest     # starts a throwaway Postgres in Docker
```

Migrations are numbered files in `src/spend_tracker/migrations/`, applied once
each at startup. Never edit an applied one; add a new file.
