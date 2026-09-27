"""Key health: correct classification, keys never in URLs, and a capped key
visible even though a free check says it's valid."""

import asyncio

import httpx
import pytest

from spend_tracker import store
from spend_tracker.keys import KEYS, KeySpec, check_key, classify
from conftest import ADMIN_ID, bearer, ingest

SPEC = KeySpec("OPENROUTER_API_KEY", "openrouter", "https://openrouter.ai/api/v1/key", "Authorization", "Bearer ")


def run_check(handler, env):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await check_key(client, SPEC, env)
    return asyncio.run(go())


@pytest.mark.parametrize(
    "status, body, expected",
    [
        (200, "{}", "valid"),
        (401, '{"error":{"message":"API key expired."}}', "expired"),
        (401, '{"error":{"message":"No auth credentials found"}}', "invalid"),
        (400, '{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid"}}', "invalid"),
        (500, "upstream error", "error"),
    ],
)
def test_classification(status, body, expected):
    assert classify(status, body)[0] == expected


def test_the_key_goes_in_a_header_never_the_url():
    # URLs end up in access logs and proxies; headers don't.
    seen = {}

    def handler(request):
        seen["url"], seen["auth"] = str(request.url), request.headers.get("authorization")
        return httpx.Response(200, json={})

    result = run_check(handler, {"OPENROUTER_API_KEY": "sk-secret-123"})
    assert result.status == "valid"
    assert "sk-secret-123" not in seen["url"]
    assert seen["auth"] == "Bearer sk-secret-123"
    assert all("key=" not in spec.url for spec in KEYS)


def test_unconfigured_key_is_missing_not_an_error():
    result = run_check(lambda r: httpx.Response(200), {})
    assert result.status == "missing"


def test_network_failure_is_error_not_invalid():
    # A timeout says nothing about the key; calling it invalid would send
    # someone off rotating a working key.
    def handler(request):
        raise httpx.ConnectTimeout("slow")

    assert run_check(handler, {"OPENROUTER_API_KEY": "k"}).status == "error"


# --- /keys endpoint -----------------------------------------------------------------

def test_keys_are_platform_admin_only(client, signer):
    assert client.get("/keys", headers=bearer(signer.token(role="tenant_admin"))).status_code == 403
    assert client.post("/keys/check", headers=bearer(signer.token(role="tenant_admin"))).status_code == 403


def test_capped_key_shows_through_its_last_call(client, signer):
    # Gemini's real situation: listing models works (check says valid), but
    # every generation call returns 429 because of the spend cap.
    pool = client.app.state.pool
    client.portal.call(store.record_check, pool, "GEMINI_API_KEY", "gemini", "valid", 200, None)
    ingest(client, at="2026-09-27T10:00:00Z", outcome="ok")
    ingest(client, at="2026-09-27T11:00:00Z", outcome="rate_limited", input_tokens=0, output_tokens=0, cost_usd="0")

    (gemini,) = client.get("/keys", headers=bearer(signer.token(sub=ADMIN_ID))).json()
    assert gemini["status"] == "valid"
    assert gemini["lastCallOutcome"] == "rate_limited"
    assert gemini["lastOkCallAt"].startswith("2026-09-27T10:00")


def test_manual_check_records_every_configured_key(client, signer):
    # key_env is empty in tests, so every key reports missing without any
    # network call, and each gets a row.
    result = client.post("/keys/check", headers=bearer(signer.token(sub=ADMIN_ID))).json()
    assert {r["keyAlias"] for r in result} == {k.key_alias for k in KEYS}
    assert {r["status"] for r in result} == {"missing"}
    listed = client.get("/keys", headers=bearer(signer.token(sub=ADMIN_ID))).json()
    assert len(listed) == len(KEYS)


def test_migrations_are_applied_once(client, database_url):
    from spend_tracker.db import migrate

    assert client.portal.call(migrate, client.app.state.pool) == []


@pytest.mark.parametrize(
    "body, detail",
    [
        ('{"error":{"message":"API key expired.","code":401,"metadata":{"headers":{}}}}', "API key expired."),
        ('{"error":"Unauthorized"}', "Unauthorized"),
        ("<html>502 Bad Gateway</html>", "<html>502 Bad Gateway</html>"),
    ],
)
def test_detail_is_the_providers_message_not_the_raw_body(body, detail):
    # This text lands in alerts people read; raw JSON is noise.
    assert classify(401, body)[1] == detail
