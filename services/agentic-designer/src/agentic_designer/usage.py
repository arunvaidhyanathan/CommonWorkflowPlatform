"""Spend metering (SpendTracker.html, phase S0).

Every model call, successful or not, produces exactly one UsageEvent with
the tokens the provider reported and an estimated cost from the price
table. A model without a price is "unpriced" (cost None), never $0, so
missing data can't pass for free usage. Recording must never break the call
it measures.
"""

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from importlib import resources
from typing import Any, Literal, Protocol

from .llm import Completion, LLMProvider, ProviderError, Turn

log = logging.getLogger("agentic_designer.usage")

Outcome = Literal["ok", "rate_limited", "error", "empty"]
_PER_MILLION = Decimal(1_000_000)


@dataclass(frozen=True)
class UsageContext:
    """Who and what a model call is for; set per request by the endpoint."""

    feature: str
    tenant_id: str
    user_id: str
    request_id: str | None = None


@dataclass(frozen=True)
class UsageEvent:
    at: str  # ISO-8601 UTC
    service: str
    feature: str
    provider: str
    model: str
    key_alias: str
    tenant_id: str
    user_id: str
    request_id: str | None
    outcome: Outcome
    input_tokens: int
    output_tokens: int
    cost_usd: str | None  # decimal string; None = unpriced
    latency_ms: int


class PriceTable:
    def __init__(self, entries: list[dict[str, Any]]):
        self._entries = sorted(
            (
                {
                    "provider": e["provider"],
                    "model": e["model"],
                    "effective_from": date.fromisoformat(e["effective_from"]),
                    "input": Decimal(e["input_per_mtok"]),
                    "output": Decimal(e["output_per_mtok"]),
                }
                for e in entries
            ),
            key=lambda e: e["effective_from"],
        )

    @classmethod
    def bundled(cls) -> "PriceTable":
        text = resources.files("agentic_designer").joinpath("prices.json").read_text()
        return cls(json.loads(text)["prices"])

    def estimate(self, provider: str, model: str, input_tokens: int, output_tokens: int, on: date) -> Decimal | None:
        """Cost in USD using the latest price in effect on ``on``, or None."""
        price = None
        for e in self._entries:
            if e["provider"] == provider and e["model"] == model and e["effective_from"] <= on:
                price = e
        if price is None:
            return None
        return (input_tokens * price["input"] + output_tokens * price["output"]) / _PER_MILLION


class UsageSink(Protocol):
    def record(self, event: UsageEvent) -> None: ...


class LogSink:
    """One JSON line per event in the service log. Kept alongside HttpSink,
    so the log still has every event if the tracker is down."""

    def record(self, event: UsageEvent) -> None:
        log.info("usage %s", json.dumps(asdict(event)))


class HttpSink:
    """Posts each event to the spend-tracker service (SpendTracker.html S1)
    on the internal network. Fire-and-forget on the running event loop: a
    slow or down tracker never delays generation. Undelivered events are
    logged in full so they can be replayed."""

    def __init__(self, url: str, token: str, client=None):
        import httpx

        self._url = url
        self._token = token
        self._client = client or httpx.AsyncClient(timeout=5)
        self._pending: set[asyncio.Task] = set()

    def record(self, event: UsageEvent) -> None:
        task = asyncio.get_running_loop().create_task(self._post(event))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _post(self, event: UsageEvent) -> None:
        try:
            resp = await self._client.post(self._url, json=asdict(event), headers={"X-Ingest-Token": self._token})
            resp.raise_for_status()
        except Exception as exc:
            log.warning("usage event not delivered (%s): %s", type(exc).__name__, json.dumps(asdict(event)))

    async def drain(self) -> None:
        """Wait for in-flight posts (tests, shutdown)."""
        if self._pending:
            await asyncio.gather(*list(self._pending), return_exceptions=True)


class FanoutSink:
    def __init__(self, *sinks: "UsageSink"):
        self._sinks = sinks

    def record(self, event: UsageEvent) -> None:
        for sink in self._sinks:
            sink.record(event)


class MeteredProvider:
    """Wraps an LLMProvider so each call is recorded, then returns or
    re-raises exactly what the wrapped provider did."""

    def __init__(self, inner: LLMProvider, sink: UsageSink, prices: PriceTable, context: UsageContext):
        self.name = inner.name
        self.model = inner.model
        self.key_alias = inner.key_alias
        self._inner = inner
        self._sink = sink
        self._prices = prices
        self._context = context

    async def generate_json(self, system: str, turns: list[Turn], schema: dict[str, Any]) -> Completion:
        started = time.monotonic()
        try:
            completion = await self._inner.generate_json(system, turns, schema)
        except ProviderError as exc:
            self._record(exc.kind, 0, 0, started)
            raise
        except Exception:
            self._record("error", 0, 0, started)
            raise
        self._record("ok", completion.input_tokens, completion.output_tokens, started)
        return completion

    def _record(self, outcome: Outcome, input_tokens: int, output_tokens: int, started: float) -> None:
        now = datetime.now(UTC)
        cost = self._prices.estimate(self.name, self.model, input_tokens, output_tokens, now.date())
        event = UsageEvent(
            at=now.isoformat(timespec="milliseconds"),
            service="agentic-designer",
            feature=self._context.feature,
            provider=self.name,
            model=self.model,
            key_alias=self.key_alias,
            tenant_id=self._context.tenant_id,
            user_id=self._context.user_id,
            request_id=self._context.request_id,
            outcome=outcome,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=None if cost is None else str(cost),
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        try:
            self._sink.record(event)
        except Exception:
            # Metering is never allowed to break the call it measures.
            log.exception("could not record usage event")
