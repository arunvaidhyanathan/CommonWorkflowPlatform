"""Budgets and alerts (S3): the alerts that would have caught this project's
real incidents (Gemini's spend cap, OpenRouter's expired key), raised once,
and cleared when the problem goes away."""

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from conftest import ADMIN_ID, bearer, ingest
from spend_tracker import store
from spend_tracker.keys import KeySpec, check_key, parse_openrouter_usage


def now_iso(offset_s=0):
    return (datetime.now(UTC) + timedelta(seconds=offset_s)).isoformat()


def admin(signer):
    return bearer(signer.token(sub=ADMIN_ID))


def set_budget(client, signer, subject, usd):
    return client.put(f"/budgets/{subject}", json={"monthlyUsd": usd}, headers=admin(signer))


def open_alerts(client, signer, kind=None):
    alerts = client.get("/alerts", headers=admin(signer)).json()
    return [a for a in alerts if kind is None or a["kind"] == kind]


# --- budgets -------------------------------------------------------------------------

def test_budget_thresholds_alert_once_each(client, signer):
    set_budget(client, signer, "gemini", "10.00")
    ingest(client, at=now_iso(), cost_usd="7.00")
    assert open_alerts(client, signer, "budget") == []  # 70%: nothing yet

    ingest(client, at=now_iso(), cost_usd="1.50")  # 85%
    ingest(client, at=now_iso(), cost_usd="0.10")  # still 86%: no second warning
    assert [(a["threshold"], a["level"]) for a in open_alerts(client, signer, "budget")] == [(80, "warning")]

    ingest(client, at=now_iso(), cost_usd="2.00")  # 106%
    ingest(client, at=now_iso(), cost_usd="2.00")
    levels = sorted((a["threshold"], a["level"]) for a in open_alerts(client, signer, "budget"))
    assert levels == [(80, "warning"), (100, "critical")]


def test_lowering_a_budget_below_current_spend_alerts_immediately(client, signer):
    # Waiting for the next call to notice would hide an overspend that already happened.
    ingest(client, at=now_iso(), cost_usd="5.00")
    set_budget(client, signer, "gemini", "4.00")
    assert {a["threshold"] for a in open_alerts(client, signer, "budget")} == {80, 100}


def test_unpriced_calls_never_count_toward_a_budget(client, signer):
    set_budget(client, signer, "total", "1.00")
    for _ in range(5):
        ingest(client, at=now_iso(), provider="nvidia", model="m", key_alias="NVIDIA_API_KEY", cost_usd=None)
    assert open_alerts(client, signer, "budget") == []
    (budget,) = client.get("/budgets", headers=admin(signer)).json()
    assert budget["spentUsd"] == "0"


def test_total_budget_sums_every_provider(client, signer):
    set_budget(client, signer, "total", "10.00")
    ingest(client, at=now_iso(), cost_usd="5.00")
    ingest(client, at=now_iso(), provider="openrouter", model="x", key_alias="OPENROUTER_API_KEY", cost_usd="4.00")
    assert [a["subject"] for a in open_alerts(client, signer, "budget")] == ["total"]  # 90%


def test_acknowledged_budget_alert_does_not_come_back_this_month(client, signer):
    set_budget(client, signer, "gemini", "1.00")
    ingest(client, at=now_iso(), cost_usd="0.90")
    (alert,) = open_alerts(client, signer, "budget")
    assert client.post(f"/alerts/{alert['id']}/ack", headers=admin(signer)).status_code == 204
    ingest(client, at=now_iso(), cost_usd="0.01")  # still between 80% and 100%
    assert open_alerts(client, signer, "budget") == []


def test_last_months_spend_does_not_count(client, signer):
    set_budget(client, signer, "gemini", "1.00")
    ingest(client, at=(datetime.now(UTC).replace(day=1) - timedelta(days=1)).isoformat(), cost_usd="5.00")
    ingest(client, at=now_iso(), cost_usd="0.10")
    assert open_alerts(client, signer, "budget") == []


def test_budget_listing_shows_spend_against_budget(client, signer):
    set_budget(client, signer, "gemini", "10.00")
    ingest(client, at=now_iso(), cost_usd="2.50")
    (b,) = client.get("/budgets", headers=admin(signer)).json()
    assert (b["subject"], b["monthlyUsd"], b["spentUsd"]) == ("gemini", "10", "2.5")
    assert b["period"] == datetime.now(UTC).strftime("%Y-%m")


@pytest.mark.parametrize("subject, usd", [("Gemini!", "5"), ("gemini", "0"), ("gemini", "-3"), ("gemini", "5.123")])
def test_bad_budgets_are_rejected(client, signer, subject, usd):
    assert set_budget(client, signer, subject, usd).status_code == 422


def test_budgets_and_alerts_are_platform_admin_only(client, signer):
    tenant_admin = bearer(signer.token(role="tenant_admin"))
    assert client.get("/budgets", headers=tenant_admin).status_code == 403
    assert client.put("/budgets/gemini", json={"monthlyUsd": "5"}, headers=tenant_admin).status_code == 403
    assert client.get("/alerts", headers=tenant_admin).status_code == 403


def test_delete_budget(client, signer):
    set_budget(client, signer, "gemini", "5")
    assert client.delete("/budgets/gemini", headers=admin(signer)).status_code == 204
    assert client.delete("/budgets/gemini", headers=admin(signer)).status_code == 404


# --- refused calls (the Gemini spend-cap incident) -----------------------------------------

def test_refused_call_alerts_once_and_clears_when_calls_succeed_again(client, signer):
    ingest(client, at=now_iso(), outcome="rate_limited", input_tokens=0, output_tokens=0, cost_usd="0")
    ingest(client, at=now_iso(1), outcome="rate_limited", input_tokens=0, output_tokens=0, cost_usd="0")
    (alert,) = open_alerts(client, signer, "key_refused")
    assert alert["subject"] == "GEMINI_API_KEY" and alert["level"] == "warning"

    ingest(client, at=now_iso(2), outcome="ok")
    assert open_alerts(client, signer, "key_refused") == []
    history = client.get("/alerts", params={"status": "all"}, headers=admin(signer)).json()
    assert history[0]["acknowledgedBy"].startswith("auto:")

    # A new refusal after recovery is a new incident.
    ingest(client, at=now_iso(3), outcome="rate_limited", input_tokens=0, output_tokens=0, cost_usd="0")
    assert len(open_alerts(client, signer, "key_refused")) == 1


# --- key checks (the OpenRouter expiry incident) -----------------------------------------------

def test_expired_key_alerts_once_across_repeated_checks_and_clears_when_renewed(client, signer):
    pool = client.app.state.pool
    for _ in range(3):
        client.portal.call(store.record_check, pool, "OPENROUTER_API_KEY", "openrouter", "expired", 401, "API key expired.")
    (alert,) = open_alerts(client, signer, "key_status")
    assert alert["level"] == "critical" and "expired" in alert["message"]

    client.portal.call(store.record_check, pool, "OPENROUTER_API_KEY", "openrouter", "valid", 200, None)
    assert open_alerts(client, signer, "key_status") == []


def test_network_error_on_a_check_is_not_a_key_alert(client, signer):
    client.portal.call(store.record_check, client.app.state.pool, "NVIDIA_API_KEY", "nvidia", "error", None, "ConnectTimeout")
    assert open_alerts(client, signer, "key_status") == []


# --- provider-reported usage (OpenRouter) ----------------------------------------------------------

SPEC = KeySpec("OPENROUTER_API_KEY", "openrouter", "https://openrouter.ai/api/v1/key", "Authorization", "Bearer ", reports_usage=True)


def _check(payload):
    async def go():
        transport = httpx.MockTransport(lambda r: httpx.Response(200, json=payload))
        async with httpx.AsyncClient(transport=transport) as c:
            return await check_key(c, SPEC, {"OPENROUTER_API_KEY": "k"})
    return asyncio.run(go())


def test_openrouter_check_captures_the_providers_own_usage_totals():
    result = _check({"data": {"usage": 12.5, "limit": 20, "limit_remaining": 7.5, "is_free_tier": False}})
    assert result.status == "valid"
    assert (str(result.usage.usage_usd), str(result.usage.limit_usd), str(result.usage.limit_remaining_usd)) == ("12.5", "20", "7.5")


def test_key_without_a_credit_limit_has_no_limit():
    usage = parse_openrouter_usage({"data": {"usage": 3, "limit": None, "limit_remaining": None}})
    assert usage.limit_usd is None and usage.limit_remaining_usd is None


def test_low_provider_credit_alerts_and_shows_on_keys(client, signer):
    usage = _check({"data": {"usage": 18.5, "limit": 20, "limit_remaining": 1.5}}).usage
    client.portal.call(store.record_check, client.app.state.pool, "OPENROUTER_API_KEY", "openrouter", "valid", 200, None, usage)

    (alert,) = open_alerts(client, signer, "provider_limit")
    assert "$1.50" in alert["message"]
    (key,) = client.get("/keys", headers=admin(signer)).json()
    assert (key["reportedUsageUsd"], key["reportedLimitUsd"], key["reportedLimitRemainingUsd"]) == ("18.5", "20", "1.5")
