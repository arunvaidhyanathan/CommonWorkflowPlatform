"""Spend metering (SpendTracker.html S0): every model call is recorded once,
with honest cost figures, and recording never breaks the call."""

import asyncio
import json
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from agentic_designer.app import create_app
from agentic_designer.generate import generate_workflow
from agentic_designer.llm import ProviderError
from agentic_designer.usage import MeteredProvider, PriceTable, UsageContext
from fixtures import BROKEN, loan_approval
from stubs import LocalVerifier, RecordingSink, ScriptedProvider

PRICES = PriceTable(
    [
        {"provider": "scripted", "model": "scripted-model", "effective_from": "2026-01-01",
         "input_per_mtok": "0.75", "output_per_mtok": "3.75"},
        {"provider": "scripted", "model": "scripted-model", "effective_from": "2027-01-01",
         "input_per_mtok": "1.50", "output_per_mtok": "7.50"},
    ]
)
CTX = UsageContext(feature="generate", tenant_id="t1", user_id="u1", request_id="req-1")


def graph_json(graph=None):
    return (graph or loan_approval()).model_dump_json(by_alias=True)


# --- price table ---------------------------------------------------------------

def test_cost_is_tokens_times_price_per_million():
    cost = PRICES.estimate("scripted", "scripted-model", 1_000_000, 200_000, date(2026, 9, 27))
    assert cost == Decimal("0.75") + Decimal("0.75")  # 1M in at 0.75 + 0.2M out at 3.75


def test_price_change_applies_from_its_effective_date():
    # Gemini 3.8 Flash doubles on 2027-01-01; a table that ignored dates would
    # misprice every call after that by half.
    before = PRICES.estimate("scripted", "scripted-model", 1_000_000, 0, date(2026, 12, 31))
    after = PRICES.estimate("scripted", "scripted-model", 1_000_000, 0, date(2027, 1, 1))
    assert (before, after) == (Decimal("0.75"), Decimal("1.50"))


@pytest.mark.parametrize(
    "provider, model",
    [("scripted", "other-model"), ("nvidia", "scripted-model")],
)
def test_unknown_model_or_provider_is_unpriced_not_free(provider, model):
    # The same model name on another host is a different price.
    assert PRICES.estimate(provider, model, 1000, 1000, date(2026, 9, 27)) is None


def test_bundled_price_file_loads_and_prices_gemini():
    table = PriceTable.bundled()
    cost = table.estimate("gemini", "gemini-3.8-flash", 1_000_000, 1_000_000, date(2026, 9, 27))
    assert cost == Decimal("4.50")


# --- metering each call ----------------------------------------------------------

def metered(provider, sink):
    return MeteredProvider(provider, sink, PRICES, CTX)


def test_successful_call_records_one_event_with_tokens_and_cost():
    sink = RecordingSink()
    asyncio.run(metered(ScriptedProvider("{}", input_tokens=2000, output_tokens=1000), sink).generate_json("s", [], {}))
    (event,) = sink.events
    assert (event.outcome, event.input_tokens, event.output_tokens) == ("ok", 2000, 1000)
    assert Decimal(event.cost_usd) > 0
    assert (event.tenant_id, event.user_id, event.request_id, event.key_alias) == ("t1", "u1", "req-1", "SCRIPTED_API_KEY")


def test_failed_call_is_recorded_and_the_error_still_reaches_the_caller():
    # A 429 is exactly what the tracker must show; it's how a capped key is noticed.
    class Capped(ScriptedProvider):
        async def generate_json(self, system, turns, schema):
            raise ProviderError("quota", kind="rate_limited")

    sink = RecordingSink()
    with pytest.raises(ProviderError):
        asyncio.run(metered(Capped(), sink).generate_json("s", [], {}))
    (event,) = sink.events
    assert (event.outcome, event.input_tokens, event.output_tokens) == ("rate_limited", 0, 0)


def test_a_broken_sink_never_breaks_generation():
    class BrokenSink:
        def record(self, event):
            raise ConnectionError("tracker down")

    completion = asyncio.run(metered(ScriptedProvider("{}"), BrokenSink()).generate_json("s", [], {}))
    assert completion.text == "{}"


def test_every_repair_attempt_is_a_separate_billed_call():
    sink = RecordingSink()
    provider = metered(ScriptedProvider(graph_json(BROKEN["AD011"]), graph_json()), sink)

    async def run():
        return [e async for e in generate_workflow(provider, "Loan approval with a manager step")]

    assert asyncio.run(run())[-1].type == "result"
    assert [e.outcome for e in sink.events] == ["ok", "ok"]


# --- through the HTTP endpoint -------------------------------------------------------

def test_endpoint_records_tenant_user_and_gateway_request_id():
    verifier, sink = LocalVerifier(), RecordingSink()
    app = create_app(provider=ScriptedProvider(graph_json()), verifier=verifier, usage_sink=sink, prices=PRICES)
    resp = TestClient(app).post(
        "/generate",
        json={"description": "Loan application with manager approval"},
        headers={"Authorization": f"Bearer {verifier.token()}", "X-Request-Id": "gw-42"},
    )
    assert resp.status_code == 200
    (event,) = sink.events
    assert event.feature == "generate" and event.request_id == "gw-42"
    assert event.tenant_id == "11111111-1111-1111-1111-111111111111"
    json.dumps(event.__dict__)  # serializable as-is for the S1 sink


def test_refused_requests_record_nothing():
    verifier, sink = LocalVerifier(), RecordingSink()
    app = create_app(provider=ScriptedProvider(graph_json()), verifier=verifier, usage_sink=sink, prices=PRICES)
    TestClient(app).post(
        "/generate",
        json={"description": "Loan application with manager approval"},
        headers={"Authorization": f"Bearer {verifier.token(role='viewer')}"},
    )
    assert sink.events == []
