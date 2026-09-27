"""HTTP layer: who may call /generate, and what the stream looks like."""

import json

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from agentic_designer.app import create_app
from fixtures import loan_approval
from stubs import LocalVerifier, ScriptedProvider

DESCRIPTION = {"description": "Loan application: review, manager approval over 10k, disbursement."}


@pytest.fixture
def verifier():
    return LocalVerifier()


def client_for(verifier, provider=None, tenant_rpm=10):
    provider = provider or ScriptedProvider(loan_approval().model_dump_json(by_alias=True))
    return TestClient(create_app(provider=provider, verifier=verifier, tenant_rpm=tenant_rpm))


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def sse_events(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def test_designer_gets_a_streamed_canvas_graph(verifier):
    resp = client_for(verifier).post("/generate", json=DESCRIPTION, headers=auth(verifier.token()))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = sse_events(resp.text)
    # Grounding announces itself first (off here: not configured in tests).
    assert [name for name, _ in events] == ["grounding", "attempt", "result"]
    assert events[0][1] == {"enabled": False, "examples": []}
    assert len(events[-1][1]["graph"]["nodes"]) == len(loan_approval().nodes)


def test_tenant_admin_may_generate(verifier):
    resp = client_for(verifier).post("/generate", json=DESCRIPTION, headers=auth(verifier.token(role="tenant_admin")))
    assert resp.status_code == 200


@pytest.mark.parametrize("role", ["viewer", "approver", ""])
def test_roles_that_cannot_author_are_refused(verifier, role):
    # Approvers review what designers make; letting them generate would
    # blur the segregation of duties Governance.html sets up.
    resp = client_for(verifier).post("/generate", json=DESCRIPTION, headers=auth(verifier.token(role=role)))
    assert resp.status_code == 403


def test_missing_token_is_401(verifier):
    assert client_for(verifier).post("/generate", json=DESCRIPTION).status_code == 401


def test_token_signed_by_another_key_is_401(verifier):
    forged = verifier.token(key=ec.generate_private_key(ec.SECP256R1()))
    assert client_for(verifier).post("/generate", json=DESCRIPTION, headers=auth(forged)).status_code == 401


def test_expired_token_is_401(verifier):
    expired = verifier.token(expires_in=-10)
    assert client_for(verifier).post("/generate", json=DESCRIPTION, headers=auth(expired)).status_code == 401


def test_account_without_a_tenant_is_refused(verifier):
    resp = client_for(verifier).post("/generate", json=DESCRIPTION, headers=auth(verifier.token(tenant_id=None)))
    assert resp.status_code == 403


def test_refusals_happen_before_the_model_is_called(verifier):
    # A refused request must not cost a model call.
    provider = ScriptedProvider()
    client = client_for(verifier, provider=provider)
    client.post("/generate", json=DESCRIPTION, headers=auth(verifier.token(role="viewer")))
    client.post("/generate", json={"description": "x" * 5000}, headers=auth(verifier.token()))
    assert provider.calls == []


@pytest.mark.parametrize("description", ["short", "x" * 4001])
def test_description_length_is_bounded(verifier, description):
    resp = client_for(verifier).post("/generate", json={"description": description}, headers=auth(verifier.token()))
    assert resp.status_code == 422


def test_per_tenant_rate_limit(verifier):
    provider = ScriptedProvider(*[loan_approval().model_dump_json(by_alias=True)] * 3)
    client = client_for(verifier, provider=provider, tenant_rpm=2)
    token = verifier.token()
    codes = [client.post("/generate", json=DESCRIPTION, headers=auth(token)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    # A different tenant is unaffected.
    other = verifier.token(tenant_id="33333333-3333-3333-3333-333333333333")
    assert client.post("/generate", json=DESCRIPTION, headers=auth(other)).status_code == 200


def test_unconfigured_provider_is_503_not_a_crash(verifier):
    app = create_app(provider=None, verifier=verifier)
    app.state.provider = None
    resp = TestClient(app).post("/generate", json=DESCRIPTION, headers=auth(verifier.token()))
    assert resp.status_code == 503


def test_provider_failure_mid_stream_becomes_an_error_event(verifier):
    class Exploding:
        name = "exploding"
        model = "m"
        key_alias = "K"

        async def generate_json(self, system, turns, schema):
            raise TimeoutError("upstream timed out")

    resp = client_for(verifier, provider=Exploding()).post("/generate", json=DESCRIPTION, headers=auth(verifier.token()))
    events = sse_events(resp.text)
    assert events[-1][0] == "error"
    assert "upstream timed out" not in events[-1][1]["message"]  # no provider internals leak to the browser


def test_provider_quota_error_reaches_the_user_in_plain_words(verifier):
    from agentic_designer.llm import ProviderError

    class OverQuota:
        name = "over-quota"
        model = "m"
        key_alias = "K"

        async def generate_json(self, system, turns, schema):
            raise ProviderError("The AI provider refused the request: rate limit or quota reached.")

    resp = client_for(verifier, provider=OverQuota()).post("/generate", json=DESCRIPTION, headers=auth(verifier.token()))
    name, body = sse_events(resp.text)[-1]
    assert name == "error"
    assert "quota" in body["message"]


# --- HS256 (legacy shared secret) tokens -------------------------------------------------------

def _hs256(secret, **claims):
    import time
    import jwt as pyjwt

    body = {"sub": "22222222-2222-2222-2222-222222222222", "exp": int(time.time()) + 300,
            "app_metadata": {"role": "designer", "tenant_id": "11111111-1111-1111-1111-111111111111"}, **claims}
    return pyjwt.encode(body, secret, algorithm="HS256")


def test_legacy_hs256_tokens_are_accepted_with_the_projects_secret():
    # Real Supabase projects may still sign logins with the legacy shared secret;
    # those tokens carry a key id that isn't in the JWKS.
    from agentic_designer.auth import JwtVerifier

    v = JwtVerifier("https://example.invalid/jwks.json", hs256_secret="project-secret")
    assert v.verify(_hs256("project-secret"))["app_metadata"]["role"] == "designer"


def test_hs256_token_signed_with_another_secret_is_rejected():
    import jwt as pyjwt
    import pytest as _pytest

    from agentic_designer.auth import JwtVerifier

    v = JwtVerifier("https://example.invalid/jwks.json", hs256_secret="project-secret")
    with _pytest.raises(pyjwt.InvalidSignatureError):
        v.verify(_hs256("someone-elses-secret"))


def test_hs256_token_is_rejected_when_no_secret_is_configured():
    import jwt as pyjwt
    import pytest as _pytest

    from agentic_designer.auth import JwtVerifier

    with _pytest.raises(pyjwt.InvalidTokenError, match="SUPABASE_JWT_HS256_SECRET"):
        JwtVerifier("https://example.invalid/jwks.json").verify(_hs256("anything"))


# --- HS256 without the secret: Supabase Auth checks the token ---------------------------------

USER_ID = "22222222-2222-2222-2222-222222222222"


def _auth_server(status=200, user_id=USER_ID):
    """A stand-in for GET /auth/v1/user; records the calls it receives."""
    import httpx

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"id": user_id} if status == 200 else {"msg": "invalid JWT"})

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def _auth_verifier(http):
    from agentic_designer.auth import JwtVerifier

    return JwtVerifier("https://example.invalid/jwks.json", supabase_url="https://proj.supabase.co/",
                       anon_key="anon", http=http)


def test_hs256_login_is_accepted_when_supabase_auth_confirms_it():
    # Migrated projects no longer reveal the legacy secret; Supabase Auth is the judge.
    http, calls = _auth_server()
    token = _hs256("secret-we-do-not-know")
    assert _auth_verifier(http).verify(token)["app_metadata"]["tenant_id"] == "11111111-1111-1111-1111-111111111111"
    assert str(calls[0].url) == "https://proj.supabase.co/auth/v1/user"
    assert calls[0].headers["authorization"] == f"Bearer {token}"
    assert calls[0].headers["apikey"] == "anon"


def test_hs256_token_supabase_auth_rejects_is_refused():
    # A forged or signed-out token: without this check, any HS256 token would pass.
    import jwt as pyjwt
    import pytest as _pytest

    http, _ = _auth_server(status=403)
    with _pytest.raises(pyjwt.InvalidTokenError, match="HTTP 403"):
        _auth_verifier(http).verify(_hs256("forged"))


def test_supabase_auth_must_name_the_same_user_as_the_token():
    import jwt as pyjwt
    import pytest as _pytest

    http, _ = _auth_server(user_id="33333333-3333-3333-3333-333333333333")
    with _pytest.raises(pyjwt.InvalidTokenError, match="different user"):
        _auth_verifier(http).verify(_hs256("x"))


def test_expired_hs256_token_is_refused_without_asking_supabase():
    import time

    import jwt as pyjwt
    import pytest as _pytest

    http, calls = _auth_server()
    with _pytest.raises(pyjwt.ExpiredSignatureError):
        _auth_verifier(http).verify(_hs256("x", exp=int(time.time()) - 10))
    assert calls == []


def test_supabase_auth_confirmation_is_reused_briefly_then_rechecked(monkeypatch):
    # One network call per login per minute, not per request; a signed-out
    # session stops working within that minute.
    from agentic_designer import auth

    http, calls = _auth_server()
    v, token = _auth_verifier(http), _hs256("x")
    clock = [1000.0]
    monkeypatch.setattr(auth.time, "monotonic", lambda: clock[0])
    v.verify(token)
    v.verify(token)
    assert len(calls) == 1
    clock[0] += auth.AUTH_CONFIRM_TTL_S + 1
    v.verify(token)
    assert len(calls) == 2


def test_unreachable_supabase_auth_refuses_the_token():
    import httpx
    import jwt as pyjwt
    import pytest as _pytest

    def down(request):
        raise httpx.ConnectError("connection refused")

    with _pytest.raises(pyjwt.InvalidTokenError, match="could not reach Supabase Auth"):
        _auth_verifier(httpx.Client(transport=httpx.MockTransport(down))).verify(_hs256("x"))
