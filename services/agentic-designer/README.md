# Agentic Designer

LLM-assisted workflow authoring for CWP. Design and phase status:
[`Documents/AgenticDesigner.html`](../../Documents/AgenticDesigner.html).

The rule: **the model proposes, code decides.** The model only ever returns
a `WorkflowGraph` (Generate) or a list of patch ops (Edit); this package
validates them before anything reaches the Designer canvas, and saving
always goes through the SPA's normal draft and approval flow.

## Status

A0–A5 done: Generate, Edit and Review for BPMN, CMMN and DMN, an evaluation harness, and grounding in the tenant's own workflows.

| Module | What it is |
|---|---|
| `graph.py` | `WorkflowGraph` / `Node` / `Edge`: the typed contract the model must produce. camelCase JSON, unknown fields rejected |
| `patch.py` | Edit ops (`add_node`, `update_node`, `remove_node`, `connect`, `disconnect`, `set_condition`) and `apply_patch` |
| `validator.py` | Structural rules `AD001`–`AD017` (errors block, warnings don't) |
| `cmmn.py` | CMMN case contract, rules `CD001`–`CD011`, canvas conversion (mirrors `cmmnAdapter.ts`) |
| `dmn.py` | DMN decision-table contract, rules `DM001`–`DM012`, conversion to the Designer's `DmnModel` |
| `embeddings.py` / `grounding.py` | Embedding providers (NVIDIA, Gemini) and grounding in the tenant's workflows via Supabase |
| `evaluation/` | Evaluation harness: cases, FEEL evaluator for DMN, runner (`scripts/eval.py`) |
| `specs.py` | One `Spec` per notation (model, validator, conversion, prompts) that Generate/Edit/Review run against |
| `canvas.py` | `to_canvas` / `from_canvas`: conversion to the SPA's `GraphSnapshot` |
| `llm.py` | `LLMProvider` interface (`generate_json`); Gemini adapter and an OpenAI-compatible adapter (NVIDIA, OpenRouter) |
| `generate.py` | Generate mode: prompt, repair loop (max 2 repairs; empty replies retried), server-sent event payloads |
| `review.py` | Review mode: code checks first, then grounded AI findings in fixed categories; checks-only without a model |
| `edit.py` | Edit mode: patch-op proposals against the current canvas; rejected only for errors they introduce; diff for the preview |
| `auth.py` | Supabase JWT check (JWKS, ES256); only `designer` / `tenant_admin` may author |
| `app.py` | FastAPI: `GET /healthz`, `POST /generate`, `POST /edit` and `POST /review` (streamed, with keepalive; `spec`: BPMN, CMMN or DMN), per-tenant rate limit |
| `usage.py` + `prices.json` | Spend metering: one usage event per model call (tokens, estimated cost or "unpriced", outcome); dated price table |

Configuration: `AGENT_PROVIDER` (`gemini` | `nvidia` | `openrouter`), that provider's key
(`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`), `AGENT_MODEL` (empty = provider
default), `AGENT_EDIT_MODEL` (optional, Edit only), `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TENANT_RPM`, `SUPABASE_JWKS_URL`; `SPEND_TRACKER_URL` and
`SPEND_INGEST_TOKEN` send usage events to the spend tracker (without them, events go to the log only).

## Develop

```
uv sync
uv run pytest
uv run uvicorn agentic_designer.app:create_app --factory --port 8090   # needs SUPABASE_JWKS_URL
```

In the full stack it runs from `docker compose up` behind `/api/agent/**`.

## Evaluate

```
uv run python scripts/eval.py run --provider nvidia --model moonshotai/kimi-k3 --pause 10 --env-file ../../.env
uv run python scripts/eval.py run ... --modes review --specs DMN        # a subset
uv run python scripts/eval.py compare evals/reports/A.json evals/reports/B.json
```

Real, metered model calls. Cases live in `src/agentic_designer/evaluation/cases.py` (Generate,
Edit and grounding) and `tests/review_samples.py` (seeded review defects). DMN results are judged
by *executing* the generated table (`evaluation/feel.py`). A case with no valid result fails every
check; "no answer" (every attempt empty) is counted separately from a wrong answer. Reports go to
`evals/reports/`.

## Grounding

With `AGENT_GROUNDING=on`, Generate and Edit first look up the tenant's most similar workflows
(`grounding.py`) and show the model condensed summaries of them, so results follow the tenant's
conventions. Embeddings live in Supabase (`public.workflow_embeddings`, pgvector, RLS) and are read
and written through PostgREST *as the user*, so the database keeps tenants apart. Settings:
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (the browser app's public key), `AGENT_EMBED_PROVIDER`
(`nvidia` or `gemini`), `AGENT_EMBED_MODEL`. Best-effort: any grounding failure means no examples,
never a failed request. The stream's first event, `grounding`, names the workflows used.
