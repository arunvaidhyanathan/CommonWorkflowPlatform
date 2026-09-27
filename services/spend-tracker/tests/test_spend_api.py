"""Ingest and summary: honest totals, and nobody sees spend they shouldn't."""

from decimal import Decimal

import pytest

from conftest import ADMIN_ID, INGEST_TOKEN, TENANT_A, TENANT_B, bearer, event, ingest

RANGE = {"from": "2026-09-01T00:00:00Z", "to": "2026-10-01T00:00:00Z"}


def summary(client, token, **params):
    return client.get("/summary", params={**RANGE, **params}, headers=bearer(token))


# --- ingest ---------------------------------------------------------------------

@pytest.mark.parametrize("headers", [{}, {"X-Ingest-Token": "wrong"}])
def test_ingest_requires_the_service_token(client, headers):
    # Anyone who could post events could fake or inflate spend.
    assert client.post("/events", json=event(), headers=headers).status_code == 401


@pytest.mark.parametrize("bad", [{"input_tokens": -1}, {"outcome": "maybe"}, {"tenant_id": ""}])
def test_malformed_events_are_rejected(client, bad):
    resp = client.post("/events", json=event(**bad), headers={"X-Ingest-Token": INGEST_TOKEN})
    assert resp.status_code == 422


# --- totals ------------------------------------------------------------------------

def test_totals_sum_priced_calls_and_count_unpriced_ones_separately(client, signer):
    ingest(client, cost_usd="0.50")
    ingest(client, cost_usd="0.25")
    ingest(client, provider="nvidia", model="moonshotai/kimi-k3", key_alias="NVIDIA_API_KEY", cost_usd=None)
    ingest(client, outcome="rate_limited", input_tokens=0, output_tokens=0, cost_usd="0")

    total = summary(client, signer.token(sub=ADMIN_ID)).json()["total"]
    # An unpriced call must never be folded into the dollar total as $0 or a guess.
    assert Decimal(total["costUsd"]) == Decimal("0.75")
    assert total["unpricedCalls"] == 1
    assert (total["calls"], total["okCalls"], total["rateLimitedCalls"]) == (4, 3, 1)
    assert total["inputTokens"] == 3000


def test_breakdowns_and_daily_series(client, signer):
    ingest(client, at="2026-09-26T10:00:00Z", cost_usd="1.00")
    ingest(client, at="2026-09-27T10:00:00Z", cost_usd="2.00")
    ingest(client, at="2026-09-27T11:00:00Z", provider="nvidia", model="m", key_alias="NVIDIA_API_KEY", cost_usd=None)
    body = summary(client, signer.token(sub=ADMIN_ID)).json()

    assert body["byProvider"][0]["provider"] == "gemini"  # most expensive first
    assert [(d["day"], d["calls"]) for d in body["daily"]] == [("2026-09-26", 1), ("2026-09-27", 2)]
    assert {(m["provider"], m["model"]) for m in body["byModel"]} == {("gemini", "gemini-3.8-flash"), ("nvidia", "m")}


def test_range_is_start_inclusive_end_exclusive(client, signer):
    ingest(client, at="2026-08-31T23:59:59Z")
    ingest(client, at="2026-09-01T00:00:00Z")
    ingest(client, at="2026-10-01T00:00:00Z")
    assert summary(client, signer.token(sub=ADMIN_ID)).json()["total"]["calls"] == 1


def test_bad_range_is_rejected(client, signer):
    resp = client.get("/summary", params={"from": "2026-10-01T00:00:00Z", "to": "2026-09-01T00:00:00Z"},
                      headers=bearer(signer.token()))
    assert resp.status_code == 422


# --- who sees what ----------------------------------------------------------------------

def test_tenant_admin_sees_only_their_own_tenant(client, signer):
    ingest(client, tenant_id=TENANT_A, cost_usd="1.00")
    ingest(client, tenant_id=TENANT_B, cost_usd="5.00")
    body = summary(client, signer.token(role="tenant_admin", tenant_id=TENANT_A)).json()
    assert body["scope"] == "tenant"
    assert Decimal(body["total"]["costUsd"]) == Decimal("1.00")
    assert body["byTenant"] == []  # no view of which other tenants exist


def test_tenant_admin_cannot_ask_for_platform_scope(client, signer):
    assert summary(client, signer.token(role="tenant_admin"), scope="platform").status_code == 403


def test_platform_admin_sees_every_tenant(client, signer):
    ingest(client, tenant_id=TENANT_A, cost_usd="1.00")
    ingest(client, tenant_id=TENANT_B, cost_usd="5.00")
    body = summary(client, signer.token(sub=ADMIN_ID, role="designer")).json()
    assert body["scope"] == "platform"
    assert Decimal(body["total"]["costUsd"]) == Decimal("6.00")
    assert {t["tenantId"] for t in body["byTenant"]} == {TENANT_A, TENANT_B}


def test_platform_admin_can_narrow_to_their_own_tenant(client, signer):
    ingest(client, tenant_id=TENANT_A, cost_usd="1.00")
    ingest(client, tenant_id=TENANT_B, cost_usd="5.00")
    body = summary(client, signer.token(sub=ADMIN_ID, tenant_id=TENANT_A), scope="tenant").json()
    assert Decimal(body["total"]["costUsd"]) == Decimal("1.00")


@pytest.mark.parametrize("role", ["designer", "approver", "viewer"])
def test_other_roles_cannot_see_spend(client, signer, role):
    assert summary(client, signer.token(role=role)).status_code == 403


def test_no_token_is_401(client):
    assert client.get("/summary").status_code == 401


def test_costs_are_plain_decimal_strings(client, signer):
    # The dashboard shows these as-is; "0E-8" or "1.5E+1" would be nonsense to a reader.
    ingest(client, outcome="rate_limited", input_tokens=0, output_tokens=0, cost_usd="0")
    ingest(client, at="2026-09-02T00:00:00Z", cost_usd="15.00000000")
    body = summary(client, signer.token(sub=ADMIN_ID)).json()
    assert body["total"]["costUsd"] == "15"
    assert all("E" not in d["costUsd"] for d in body["daily"])


def test_legacy_hs256_tokens_verify_with_the_secret_and_only_with_it():
    import time

    import jwt as pyjwt

    from spend_tracker.auth import JwtVerifier

    token = pyjwt.encode({"sub": "u1", "exp": int(time.time()) + 300}, "project-secret", algorithm="HS256")
    assert JwtVerifier("https://example.invalid/jwks.json", "project-secret").verify(token)["sub"] == "u1"
    with pytest.raises(pyjwt.InvalidTokenError):
        JwtVerifier("https://example.invalid/jwks.json", "wrong-secret").verify(token)
    with pytest.raises(pyjwt.InvalidTokenError):
        JwtVerifier("https://example.invalid/jwks.json").verify(token)


def test_hs256_tokens_without_the_secret_are_judged_by_supabase_auth():
    # The migrated project no longer reveals its legacy secret, so Supabase
    # Auth decides; a token it rejects must never reach spend data.
    import time

    import httpx
    import jwt as pyjwt

    from spend_tracker.auth import JwtVerifier

    def verifier(status, user_id="u1"):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(status, json={"id": user_id})

        v = JwtVerifier("https://example.invalid/jwks.json", None, "https://proj.supabase.co", "anon",
                        httpx.Client(transport=httpx.MockTransport(handler)))
        return v, calls

    token = pyjwt.encode({"sub": "u1", "exp": int(time.time()) + 300}, "unknown", algorithm="HS256")
    v, calls = verifier(200)
    assert v.verify(token)["sub"] == "u1"
    v.verify(token)
    assert len(calls) == 1 and str(calls[0].url) == "https://proj.supabase.co/auth/v1/user"
    with pytest.raises(pyjwt.InvalidTokenError, match="HTTP 401"):
        verifier(401)[0].verify(token)
    with pytest.raises(pyjwt.InvalidTokenError, match="different user"):
        verifier(200, user_id="u2")[0].verify(token)
