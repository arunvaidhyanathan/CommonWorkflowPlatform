"""HTTP service. Reached through the edge gateway at /api/agent/**
(nginx strips the /api/agent prefix)."""

import asyncio
import json
import logging
import os
import time
from collections import defaultdict, deque

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth import JwtVerifier, Principal, authoring_principal
from .canvas import CanvasConversionError, from_canvas
from .edit import MAX_GRAPH_NODES, MAX_INSTRUCTION_CHARS, edit_event_payload, edit_workflow
from .generate import MAX_DESCRIPTION_CHARS, event_payload, generate_workflow
from .llm import GeminiProvider, LLMProvider, OpenAICompatibleProvider, ProviderError
from .usage import FanoutSink, HttpSink, LogSink, MeteredProvider, PriceTable, UsageContext, UsageSink

log = logging.getLogger("agentic_designer")


class GenerateRequest(BaseModel):
    description: str = Field(min_length=10, max_length=MAX_DESCRIPTION_CHARS)


class EditRequest(BaseModel):
    instruction: str = Field(min_length=5, max_length=MAX_INSTRUCTION_CHARS)
    # The Designer canvas as-is (GraphSnapshot: React Flow nodes and edges).
    graph: dict


class TenantRateLimiter:
    """Requests per tenant per minute, in process memory. Enough for one
    replica; move to a shared store before running more than one."""

    def __init__(self, per_minute: int):
        self._per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, tenant_id: str) -> None:
        now = time.monotonic()
        hits = self._hits[tenant_id]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= self._per_minute:
            raise HTTPException(429, "Too many generation requests for this tenant; try again in a minute.")
        hits.append(now)


def create_app(
    provider: LLMProvider | None = None,
    verifier: JwtVerifier | None = None,
    tenant_rpm: int | None = None,
    usage_sink: UsageSink | None = None,
    prices: PriceTable | None = None,
) -> FastAPI:
    app = FastAPI(title="CWP Agentic Designer")
    app.state.provider = provider if provider is not None else _provider_from_env()
    # Edit may use a different model (AGENT_EDIT_MODEL): measured on NVIDIA,
    # Kimi K3 returned empty replies on 2 of 3 edit prompts, GLM 5.3 on none.
    app.state.edit_provider = (
        (_provider_from_env(os.environ.get("AGENT_EDIT_MODEL")) if os.environ.get("AGENT_EDIT_MODEL") else None)
        if provider is None else None
    )
    app.state.verifier = verifier or JwtVerifier(os.environ["SUPABASE_JWKS_URL"])
    app.state.usage_sink = usage_sink or _usage_sink_from_env()
    app.state.prices = prices or PriceTable.bundled()
    app.state.limiter = TenantRateLimiter(tenant_rpm or int(os.environ.get("AGENT_TENANT_RPM", "10")))

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok", "provider": getattr(app.state.provider, "name", None)}

    def metered_for(request: Request, principal: Principal, feature: str) -> MeteredProvider:
        """Refusals happen here, before any model call: no provider, or the
        tenant's rate limit."""
        provider: LLMProvider | None = request.app.state.provider
        if feature == "edit" and request.app.state.edit_provider is not None:
            provider = request.app.state.edit_provider
        if provider is None:
            raise HTTPException(503, "No LLM provider is configured (set AGENT_PROVIDER and its API key).")
        request.app.state.limiter.check(principal.tenant_id)
        return MeteredProvider(
            provider,
            request.app.state.usage_sink,
            request.app.state.prices,
            UsageContext(
                feature=feature,
                tenant_id=principal.tenant_id,
                user_id=principal.user_id,
                request_id=request.headers.get("x-request-id"),
            ),
        )

    def sse(feature: str, events, to_payload, principal: Principal, chars: int) -> StreamingResponse:
        async def stream():
            started = time.monotonic()
            outcome = "error"
            try:
                async for item in with_keepalive(events, KEEPALIVE_S):
                    if item is None:
                        # SSE comment: keeps proxies and the browser from
                        # timing out while a slow model works.
                        yield ": keepalive\n\n"
                        continue
                    if item.type in ("result", "failed"):
                        outcome = f"{item.type} after {item.attempt} attempt(s)"
                    yield to_payload(item)
            except ProviderError as exc:
                log.warning("%s provider error: %s", feature, exc.__cause__ or exc)
                outcome = "provider error"
                yield f"event: error\ndata: {json.dumps({'message': exc.user_message})}\n\n"
            except Exception as exc:  # anything else mid-stream
                log.exception("%s failed", feature)
                message = f"{type(exc).__name__}: the model provider call failed."
                yield f"event: error\ndata: {json.dumps({'message': message})}\n\n"
            finally:
                # Log sizes and outcomes, never the user's text itself.
                log.info(
                    "%s tenant=%s user=%s chars=%d outcome=%s seconds=%.1f",
                    feature, principal.tenant_id, principal.user_id, chars, outcome, time.monotonic() - started,
                )

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @app.post("/generate")
    async def generate(
        body: GenerateRequest,
        request: Request,
        principal: Principal = Depends(authoring_principal),
    ) -> StreamingResponse:
        metered = metered_for(request, principal, "generate")
        return sse("generate", generate_workflow(metered, body.description), event_payload, principal, len(body.description))

    @app.post("/edit")
    async def edit(
        body: EditRequest,
        request: Request,
        principal: Principal = Depends(authoring_principal),
    ) -> StreamingResponse:
        try:
            current = from_canvas(body.graph)
        except CanvasConversionError as exc:
            raise HTTPException(422, str(exc)) from exc
        if not current.nodes:
            raise HTTPException(422, "The canvas is empty; use Generate instead.")
        if len(current.nodes) > MAX_GRAPH_NODES:
            raise HTTPException(422, f"Workflows over {MAX_GRAPH_NODES} nodes can't be edited by the agent yet.")
        metered = metered_for(request, principal, "edit")
        return sse("edit", edit_workflow(metered, current, body.instruction), edit_event_payload, principal, len(body.instruction))

    return app


# provider -> (API key variable, OpenAI-compatible base URL or None, default model)
PROVIDERS = {
    "gemini": ("GEMINI_API_KEY", None, "gemini-3.8-flash"),
    "nvidia": ("NVIDIA_API_KEY", "https://integrate.api.nvidia.com/v1", "moonshotai/kimi-k3"),
    "openrouter": ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", "google/gemini-3.8-flash"),
}


KEEPALIVE_S = 15


async def with_keepalive(events, every_s: float):
    """Yield each event from ``events``; yield None whenever ``every_s``
    passes with no event. The pending step is never cancelled."""
    iterator = events.__aiter__()
    pending = asyncio.ensure_future(iterator.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=every_s)
            if not done:
                yield None
                continue
            try:
                item = pending.result()
            except StopAsyncIteration:
                return
            yield item
            pending = asyncio.ensure_future(iterator.__anext__())
    finally:
        if not pending.done():
            pending.cancel()


def _usage_sink_from_env() -> UsageSink:
    url = os.environ.get("SPEND_TRACKER_URL")
    if not url:
        log.warning("SPEND_TRACKER_URL is not set; usage events go to the log only.")
        return LogSink()
    return FanoutSink(LogSink(), HttpSink(url.rstrip("/") + "/events", os.environ.get("SPEND_INGEST_TOKEN", "")))


def _provider_from_env(model_override: str | None = None) -> LLMProvider | None:
    name = os.environ.get("AGENT_PROVIDER", "gemini")
    if name not in PROVIDERS:
        # A typo here should stop the service, not silently disable the feature.
        raise RuntimeError(f"AGENT_PROVIDER={name!r} is not one of {sorted(PROVIDERS)}")
    key_var, base_url, default_model = PROVIDERS[name]
    api_key = os.environ.get(key_var)
    if not api_key:
        log.warning("%s is not set; /generate will return 503.", key_var)
        return None
    model = model_override or os.environ.get("AGENT_MODEL") or default_model
    max_tokens = int(os.environ.get("AGENT_MAX_OUTPUT_TOKENS", "8192"))
    log.info("LLM provider %s, model %s", name, model)
    if base_url is None:
        return GeminiProvider(api_key=api_key, model=model, max_output_tokens=max_tokens)
    return OpenAICompatibleProvider(name, key_var, api_key, base_url, model, max_tokens)


logging.basicConfig(level=logging.INFO)
