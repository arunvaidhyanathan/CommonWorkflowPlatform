"""Text embeddings for grounding (AgenticDesigner.html phase A5).

Provider-agnostic like llm.py: NVIDIA now (``nvidia/nemotron-3-embed-1b``,
2048 dimensions), Gemini once its spend cap allows. Queries and passages are
embedded differently by retrieval models, so callers say which is which.
Every call is metered as feature "embed".
"""

import time
from datetime import UTC, datetime
from typing import Literal, Protocol

from .usage import PriceTable, UsageContext, UsageEvent, UsageSink

Kind = Literal["query", "passage"]


class Embedder(Protocol):
    name: str
    model: str
    key_alias: str

    async def embed(self, texts: list[str], kind: Kind) -> tuple[list[list[float]], int]:
        """Vectors in input order, and the input tokens used."""
        ...


class NvidiaEmbedder:
    name = "nvidia"
    key_alias = "NVIDIA_API_KEY"

    def __init__(self, api_key: str, model: str = "nvidia/nemotron-3-embed-1b"):
        from openai import AsyncOpenAI

        self.model = model
        self._client = AsyncOpenAI(api_key=api_key, base_url="https://integrate.api.nvidia.com/v1", max_retries=0, timeout=60)

    async def embed(self, texts, kind):
        resp = await self._client.embeddings.create(
            model=self.model, input=texts, encoding_format="float",
            extra_body={"input_type": kind, "truncate": "END"},
        )
        vectors = [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]
        return vectors, (resp.usage.prompt_tokens if resp.usage else 0)


class GeminiEmbedder:
    name = "gemini"
    key_alias = "GEMINI_API_KEY"

    def __init__(self, api_key: str, model: str = "gemini-embedding-001"):
        from google import genai

        self.model = model
        self._client = genai.Client(api_key=api_key)

    async def embed(self, texts, kind):
        from google.genai import types

        resp = await self._client.aio.models.embed_content(
            model=self.model, contents=texts,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY" if kind == "query" else "RETRIEVAL_DOCUMENT"),
        )
        return [e.values for e in resp.embeddings], 0


class MeteredEmbedder:
    """Records one usage event per embedding call (the spend tracker's
    ``embed`` feature); failures are recorded and re-raised."""

    def __init__(self, inner: Embedder, sink: UsageSink, prices: PriceTable, context: UsageContext):
        self.name, self.model, self.key_alias = inner.name, inner.model, inner.key_alias
        self._inner, self._sink, self._prices, self._context = inner, sink, prices, context

    async def embed(self, texts, kind):
        started = time.monotonic()
        try:
            vectors, tokens = await self._inner.embed(texts, kind)
        except Exception:
            self._record("error", 0, started)
            raise
        self._record("ok", tokens, started)
        return vectors, tokens

    def _record(self, outcome, tokens, started):
        now = datetime.now(UTC)
        cost = self._prices.estimate(self.name, self.model, tokens, 0, now.date())
        try:
            self._sink.record(UsageEvent(
                at=now.isoformat(timespec="milliseconds"), service="agentic-designer", feature="embed",
                provider=self.name, model=self.model, key_alias=self.key_alias,
                tenant_id=self._context.tenant_id, user_id=self._context.user_id, request_id=self._context.request_id,
                outcome=outcome, input_tokens=tokens, output_tokens=0,
                cost_usd=None if cost is None else str(cost), latency_ms=int((time.monotonic() - started) * 1000),
            ))
        except Exception:
            pass  # metering never breaks the call it measures
