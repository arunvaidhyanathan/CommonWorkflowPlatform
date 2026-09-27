# Agentic Designer

LLM-assisted workflow authoring for CWP. Design and phase status:
[`Documents/AgenticDesigner.html`](../../Documents/AgenticDesigner.html).

The rule: **the model proposes, code decides.** The model only ever returns
a `WorkflowGraph` (Generate) or a list of patch ops (Edit); this package
validates them before anything reaches the Designer canvas, and saving
always goes through the SPA's normal draft and approval flow.

## Status

A0 (contract) done; A1 (Generate) built and live-verified on NVIDIA-hosted models.

| Module | What it is |
|---|---|
| `graph.py` | `WorkflowGraph` / `Node` / `Edge`: the typed contract the model must produce. camelCase JSON, unknown fields rejected |
| `patch.py` | Edit ops (`add_node`, `update_node`, `remove_node`, `connect`, `disconnect`, `set_condition`) and `apply_patch` |
| `validator.py` | Structural rules `AD001`–`AD016` (errors block, warnings don't) |
| `canvas.py` | `to_canvas` / `from_canvas`: conversion to the SPA's `GraphSnapshot` |
| `llm.py` | `LLMProvider` interface (`generate_json`); Gemini adapter and an OpenAI-compatible adapter (NVIDIA, OpenRouter) |
| `generate.py` | Generate mode: prompt, repair loop (max 2 repairs), server-sent event payloads |
| `auth.py` | Supabase JWT check (JWKS, ES256); only `designer` / `tenant_admin` may author |
| `app.py` | FastAPI: `GET /healthz`, `POST /generate` (streamed), per-tenant rate limit |
| `usage.py` + `prices.json` | Spend metering: one usage event per model call (tokens, estimated cost or "unpriced", outcome); dated price table |

Configuration: `AGENT_PROVIDER` (`gemini` | `nvidia` | `openrouter`), that provider's key
(`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`), `AGENT_MODEL` (empty = provider
default), `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TENANT_RPM`, `SUPABASE_JWKS_URL`; `SPEND_TRACKER_URL` and
`SPEND_INGEST_TOKEN` send usage events to the spend tracker (without them, events go to the log only).

## Develop

```
uv sync
uv run pytest
uv run uvicorn agentic_designer.app:create_app --factory --port 8090   # needs SUPABASE_JWKS_URL
```

In the full stack it runs from `docker compose up` behind `/api/agent/**`.
