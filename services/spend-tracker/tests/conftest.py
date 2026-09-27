"""Test fixtures: a throwaway Postgres in Docker, a local ES256 signer, and
an app wired to both. The SQL is exercised against real Postgres, not mocks."""

import subprocess
import time
import uuid

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from spend_tracker.app import create_app

INGEST_TOKEN = "test-ingest-token"
ADMIN_ID = "aaaaaaaa-0000-0000-0000-000000000001"
TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"


@pytest.fixture(scope="session")
def database_url():
    name = f"spend-test-{uuid.uuid4().hex[:8]}"
    subprocess.run(
        ["docker", "run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=test",
         "-p", "127.0.0.1::5432", "postgres:16-alpine"],
        check=True, capture_output=True,
    )
    try:
        port = subprocess.run(["docker", "port", name, "5432"], check=True, capture_output=True, text=True).stdout
        url = f"postgresql://postgres:test@127.0.0.1:{port.strip().rsplit(':', 1)[1]}/postgres"
        for _ in range(60):
            try:
                psycopg.connect(url, connect_timeout=1).close()
                break
            except psycopg.OperationalError:
                time.sleep(0.5)
        else:
            raise RuntimeError("test Postgres did not start")
        yield url
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


class Signer:
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())

    def verify(self, token):
        return jwt.decode(token, self.key.public_key(), algorithms=["ES256"],
                          options={"verify_aud": False, "require": ["exp", "sub"]})

    def token(self, sub="bbbbbbbb-0000-0000-0000-000000000002", role="tenant_admin", tenant_id=TENANT_A):
        meta = {"role": role}
        if tenant_id:
            meta["tenant_id"] = tenant_id
        return jwt.encode({"sub": sub, "exp": int(time.time()) + 300, "app_metadata": meta}, self.key, algorithm="ES256")


@pytest.fixture
def signer():
    return Signer()


@pytest.fixture
def client(database_url, signer):
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("drop table if exists usage_events, key_checks, budgets, alerts, provider_usage, schema_migrations")
    app = create_app(
        database_url=database_url, verifier=signer, ingest_token=INGEST_TOKEN,
        admin_user_ids={ADMIN_ID}, key_env={}, check_interval_s=0,
    )
    with TestClient(app) as c:
        yield c


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def event(**overrides):
    e = {
        "at": "2026-09-27T12:00:00+00:00", "service": "agentic-designer", "feature": "generate",
        "provider": "gemini", "model": "gemini-3.8-flash", "key_alias": "GEMINI_API_KEY",
        "tenant_id": TENANT_A, "user_id": "u1", "request_id": "r1", "outcome": "ok",
        "input_tokens": 1000, "output_tokens": 500, "cost_usd": "0.0026250", "latency_ms": 1200,
    }
    e.update(overrides)
    return e


def ingest(client, **overrides):
    resp = client.post("/events", json=event(**overrides), headers={"X-Ingest-Token": INGEST_TOKEN})
    assert resp.status_code == 204, resp.text
