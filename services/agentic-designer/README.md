# Agentic Designer

LLM-assisted workflow authoring for CWP. Python 3.13 / FastAPI. Port 8090.
No database. Public path `/api/agent/**`. Design history:
[`docs/archive/AgenticDesigner.html`](../../docs/archive/AgenticDesigner.html).

The rule: **the model proposes, code decides.** The model only ever returns
a `WorkflowGraph` (Generate) or a list of patch ops (Edit); this package
validates them before anything reaches the Designer canvas, and saving
always goes through the SPA's normal draft and approval flow.

## Status

Generate, Edit and Review for BPMN, CMMN and DMN, plus an evaluation harness. Grounding in the tenant's own workflows is built but switched off: it needs a store reading design-service's workflows (see Grounding).

| Module | What it is |
|---|---|
| `graph.py` | `WorkflowGraph` / `Node` / `Edge`: the typed contract the model must produce. camelCase JSON, unknown fields rejected |
| `patch.py` | Edit ops (`add_node`, `update_node`, `remove_node`, `connect`, `disconnect`, `set_condition`) and `apply_patch` |
| `validator.py` | Structural rules `AD001`–`AD017` (errors block, warnings don't) |
| `cmmn.py` | CMMN case contract, rules `CD001`–`CD011`, canvas conversion (mirrors `cmmnAdapter.ts`) |
| `dmn.py` | DMN decision-table contract, rules `DM001`–`DM012`, conversion to the Designer's `DmnModel` |
| `embeddings.py` / `grounding.py` | Embedding providers (NVIDIA, Gemini) and grounding logic over a pluggable `GroundingStore` (none wired in production) |
| `evaluation/` | Evaluation harness: cases, FEEL evaluator for DMN, runner (`scripts/eval.py`) |
| `specs.py` | One `Spec` per notation (model, validator, conversion, prompts) that Generate/Edit/Review run against |
| `canvas.py` | `to_canvas` / `from_canvas`: conversion to the SPA's `GraphSnapshot` |
| `llm.py` | `LLMProvider` interface (`generate_json`); Gemini adapter and an OpenAI-compatible adapter (NVIDIA, OpenRouter) |
| `generate.py` | Generate mode: prompt, repair loop (max 2 repairs; empty replies retried), server-sent event payloads |
| `review.py` | Review mode: code checks first, then grounded AI findings in fixed categories; checks-only without a model |
| `edit.py` | Edit mode: patch-op proposals against the current canvas; rejected only for errors they introduce; diff for the preview |
| `auth.py` | Login token check against identity-service's JWKS (RS256); only `designer` / `tenant_admin` may author |
| `app.py` | FastAPI: `GET /healthz`, `POST /generate`, `POST /edit` and `POST /review` (streamed, with keepalive; `spec`: BPMN, CMMN or DMN), per-tenant rate limit |
| `usage.py` + `prices.json` | Spend metering: one usage event per model call (tokens, estimated cost or "unpriced", outcome); dated price table |

Configuration: `AGENT_PROVIDER` (`gemini` | `nvidia` | `openrouter`), that provider's key
(`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`), `AGENT_MODEL` (empty = provider
default), `AGENT_EDIT_MODEL` (optional, Edit only), `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TENANT_RPM`, `IDENTITY_JWKS_URL`; `SPEND_TRACKER_URL` and
`SPEND_INGEST_TOKEN` send usage events to the spend tracker (without them, events go to the log only).

## Develop

```
uv sync
uv run pytest
uv run uvicorn agentic_designer.app:create_app --factory --port 8090   # needs IDENTITY_JWKS_URL
```

## Container

- Build: `docker build -t cwp/agentic-designer services/agentic-designer`.
- Runs as non-root, any UID. Probe: `GET /healthz`.
- Stateless: scale horizontally. The per-tenant rate limit (`AGENT_TENANT_RPM`)
  is counted per pod, so the effective limit is `rpm x replicas`. Requests
  stream for up to minutes: keep the gateway's 300s read timeout and give
  pods a termination grace period of at least that.

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

## Grounding (switched off)

Grounding lets Generate and Edit first look up the tenant's most similar workflows
(`grounding.py`) and show the model condensed summaries of them, so results follow the tenant's
conventions. The logic and its tests remain; the production store (formerly Supabase) was removed
with Supabase. To switch it back on, implement a `GroundingStore` that reads the tenant's workflows
from design-service and stores embeddings (e.g. a `vector` table in a new schema), and pass it to
`create_app(grounding=...)`. Best-effort by design: any grounding failure means no examples, never a
failed request.
