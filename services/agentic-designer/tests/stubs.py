"""Test doubles: a scripted LLM provider and a local ES256 signing key."""

import time

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from agentic_designer.llm import Turn


class ScriptedProvider:
    """Returns the given responses in order and records every call, so tests
    can assert on what the model was told."""

    name = "scripted"

    def __init__(self, *responses: str):
        self._responses = list(responses)
        self.calls: list[list[Turn]] = []

    async def generate_json(self, system, turns, schema):
        self.calls.append(list(turns))
        return self._responses.pop(0)


class LocalVerifier:
    """JwtVerifier stand-in that trusts one locally generated key instead of
    fetching Supabase's JWKS over the network."""

    def __init__(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1())

    def verify(self, token: str) -> dict:
        return jwt.decode(
            token,
            self.private_key.public_key(),
            algorithms=["ES256"],
            options={"verify_aud": False, "require": ["exp", "sub"]},
        )

    def token(self, role="designer", tenant_id="11111111-1111-1111-1111-111111111111", expires_in=300, key=None):
        claims = {
            "sub": "22222222-2222-2222-2222-222222222222",
            "aud": "authenticated",
            "exp": int(time.time()) + expires_in,
            "app_metadata": {"role": role, "tenant_id": tenant_id} if tenant_id else {"role": role},
        }
        return jwt.encode(claims, key or self.private_key, algorithm="ES256")
