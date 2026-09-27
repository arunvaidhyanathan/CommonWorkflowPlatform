"""HTTP service. Reached through the edge gateway at /api/agent/**
(nginx strips the /api/agent prefix)."""

import json
import logging
import os
import time
from collections import defaultdict, deque

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth import JwtVerifier, Principal, authoring_principal
from .generate import MAX_DESCRIPTION_CHARS, event_payload, generate_workflow
from .llm import GeminiProvider, LLMProvider, OpenAICompatibleProvider, ProviderError

log = logging.getLogger("agentic_designer")


class GenerateRequest(BaseModel):
    description: str = Field(min_length=10, max_length=MAX_DESCRIPTION_CHARS)


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
) -> FastAPI:
    app = FastAPI(title="CWP Agentic Designer")
    app.state.provider = provider if provider is not None else _provider_from_env()
    app.state.verifier = verifier or JwtVerifier(os.environ["SUPABASE_JWKS_URL"])
    app.state.limiter = TenantRateLimiter(tenant_rpm or int(os.environ.get("AGENT_TENANT_RPM", "10")))

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok", "provider": getattr(app.state.provider, "name", None)}

    @app.post("/generate")
    async def generate(
        body: GenerateRequest,
        request: Request,
        principal: Principal = Depends(authoring_principal),
    ) -> StreamingResponse:
        provider: LLMProvider | None = request.app.state.provider
        if provider is None:
            raise HTTPException(503, "No LLM provider is configured (set AGENT_PROVIDER and its API key).")
        request.app.state.limiter.check(principal.tenant_id)

        async def stream():
            started = time.monotonic()
            outcome = "error"
            try:
                async for event in generate_workflow(provider, body.description):
                    if event.type in ("result", "failed"):
                        outcome = f"{event.type} after {event.attempt} attempt(s)"
                    yield event_payload(event)
            except ProviderError as exc:
                log.warning("generate provider error: %s", exc.__cause__ or exc)
                outcome = "provider error"
                message = exc.user_message
                yield f"event: error\ndata: {json.dumps({'message': message})}\n\n"
            except Exception as exc:  # anything else mid-stream
                log.exception("generate failed")
                message = f"{type(exc).__name__}: the model provider call failed."
                yield f"event: error\ndata: {json.dumps({'message': message})}\n\n"
            finally:
                # Log sizes and outcomes, never the description itself.
                log.info(
                    "generate tenant=%s user=%s chars=%d outcome=%s seconds=%.1f",
                    principal.tenant_id, principal.user_id, len(body.description), outcome,
                    time.monotonic() - started,
                )

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    return app


# provider -> (API key variable, OpenAI-compatible base URL or None, default model)
PROVIDERS = {
    "gemini": ("GEMINI_API_KEY", None, "gemini-3.8-flash"),
    "nvidia": ("NVIDIA_API_KEY", "https://integrate.api.nvidia.com/v1", "moonshotai/kimi-k3"),
    "openrouter": ("OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", "google/gemini-3.8-flash"),
}


def _provider_from_env() -> LLMProvider | None:
    name = os.environ.get("AGENT_PROVIDER", "gemini")
    if name not in PROVIDERS:
        # A typo here should stop the service, not silently disable the feature.
        raise RuntimeError(f"AGENT_PROVIDER={name!r} is not one of {sorted(PROVIDERS)}")
    key_var, base_url, default_model = PROVIDERS[name]
    api_key = os.environ.get(key_var)
    if not api_key:
        log.warning("%s is not set; /generate will return 503.", key_var)
        return None
    model = os.environ.get("AGENT_MODEL") or default_model
    max_tokens = int(os.environ.get("AGENT_MAX_OUTPUT_TOKENS", "8192"))
    log.info("LLM provider %s, model %s", name, model)
    if base_url is None:
        return GeminiProvider(api_key=api_key, model=model, max_output_tokens=max_tokens)
    return OpenAICompatibleProvider(name, api_key, base_url, model, max_tokens)


logging.basicConfig(level=logging.INFO)
