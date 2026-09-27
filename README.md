# Common Workflow Platform (CWP)

Platform docs start at [`Documents/CWP.html`](Documents/CWP.html).

## Layout

| Path | What it is |
|---|---|
| `Designer/` | The React SPA (app shell: Designer, Workbench, Approvals, Administration, Workflow Wrapper screens) |
| `gateway/` | nginx edge gateway: serves the SPA, routes `/api/*` to services, owns CORS / rate limits / request ids |
| `services/workflow-runtime/` | Java 21 / Spring Boot 4 / Flowable 8 engine host |
| `services/agentic-designer/` | Agentic Designer: LLM-assisted workflow authoring (Python / FastAPI) |
| `services/spend-tracker/` | API spend tracker: usage events, spend summaries, API key health (Python / FastAPI) |
| `Database/` | Portable schema + RLS for the Supabase design-time data |

Supabase (hosted) stays the identity and design-time data backend.

## Run the stack

```
cp .env.example .env        # set WORKFLOW_RUNTIME_DB_PASSWORD (any value) and GEMINI_API_KEY
docker compose up -d --build
```

Open `http://localhost:8080` (or `GATEWAY_PORT` from `.env`). The SPA is
built into the gateway image and reads its Supabase settings from
`Designer/.env.local`, so that file must exist before building.

| Route | Goes to |
|---|---|
| `/` | SPA |
| `/healthz` | Gateway health |
| `/api/runtime/**` | workflow-runtime (`/runtime/**`) |
| `/api/agent/**` | agentic-designer (`/**`) |
| `/api/spend/**` | spend-tracker (`/**`); `/api/spend/events` is blocked (internal only) |

Every service verifies the Supabase JWT itself; nginx does not.

### Vite dev against the stack

Run `npm run dev` in `Designer/` with
`VITE_API_BASE_URL=http://localhost:<GATEWAY_PORT>/api` in
`Designer/.env.local`. `http://localhost:5173` is in the gateway's default
CORS allow-list (`CORS_ALLOWED_ORIGINS`).
