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
    assert [name for name, _ in events] == ["attempt", "result"]
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

        async def generate_json(self, system, turns, schema):
            raise ProviderError("The AI provider refused the request: rate limit or quota reached.")

    resp = client_for(verifier, provider=OverQuota()).post("/generate", json=DESCRIPTION, headers=auth(verifier.token()))
    name, body = sse_events(resp.text)[-1]
    assert name == "error"
    assert "quota" in body["message"]
