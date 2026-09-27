"""Supabase JWT verification, mirroring workflow-runtime's SecurityConfig /
TenantContext: signature and expiry checked against the project's JWKS (or,
for HS256 tokens, the legacy secret or Supabase Auth);
tenant and role read from ``app_metadata``, the same claims the database's
RLS helpers (current_tenant_id(), current_role_claim()) use.
"""

import hashlib
import time
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Depends, HTTPException, Request

# Roles allowed to generate or edit workflows (AgenticDesigner.html Section 4).
AUTHORING_ROLES = frozenset({"designer", "tenant_admin"})


@dataclass(frozen=True)
class Principal:
    user_id: str
    tenant_id: str
    role: str


# How long a Supabase Auth confirmation of an HS256 token is reused.
AUTH_CONFIRM_TTL_S = 60


class JwtVerifier:
    """Supabase tokens are signed either with an asymmetric key published in
    the project's JWKS (ES256/RS256) or, for projects still on it, with the
    legacy shared secret (HS256, whose key id isn't in the JWKS).

    HS256 tokens are checked with the secret when it is configured.
    Otherwise Supabase Auth checks them (GET /auth/v1/user, which verifies
    the signature and that the session still exists); the answer is reused
    for AUTH_CONFIRM_TTL_S. Supabase no longer reveals the legacy secret
    once a project has migrated to signing keys, so this is the usual path."""

    def __init__(self, jwks_url: str, hs256_secret: str | None = None,
                 supabase_url: str | None = None, anon_key: str | None = None,
                 http: httpx.Client | None = None):
        self._jwks = jwt.PyJWKClient(jwks_url, cache_keys=True)
        self._hs256_secret = hs256_secret or None
        self._user_url = f"{supabase_url.rstrip('/')}/auth/v1/user" if supabase_url and anon_key else None
        self._anon_key = anon_key
        self._http = http or httpx.Client(timeout=5)
        self._confirmed: dict[str, float] = {}

    def signing_key(self, token: str):
        return self._jwks.get_signing_key_from_jwt(token).key

    def verify(self, token: str) -> dict:
        if jwt.get_unverified_header(token).get("alg") == "HS256":
            if self._hs256_secret:
                return jwt.decode(token, self._hs256_secret, algorithms=["HS256"],
                                  options={"verify_aud": False, "require": ["exp", "sub"]})
            if self._user_url:
                return self._confirm_with_supabase_auth(token)
            raise jwt.InvalidTokenError(
                "HS256 token, but neither SUPABASE_JWT_HS256_SECRET nor SUPABASE_URL and SUPABASE_ANON_KEY are configured")
        return jwt.decode(
            token,
            self.signing_key(token),
            algorithms=["ES256", "RS256"],
            # Supabase access tokens carry aud "authenticated"; like
            # workflow-runtime, identity comes from the signature, so the
            # audience isn't pinned here.
            options={"verify_aud": False, "require": ["exp", "sub"]},
        )

    def _confirm_with_supabase_auth(self, token: str) -> dict:
        # Claims are read locally (expiry still enforced); the signature is
        # Supabase Auth's call.
        claims = jwt.decode(token, options={"verify_signature": False, "verify_exp": True,
                                            "require": ["exp", "sub"]})
        key = hashlib.sha256(token.encode()).hexdigest()
        now = time.monotonic()
        if now - self._confirmed.get(key, float("-inf")) > AUTH_CONFIRM_TTL_S:
            try:
                r = self._http.get(self._user_url, headers={"apikey": self._anon_key, "Authorization": f"Bearer {token}"})
            except httpx.HTTPError as exc:
                raise jwt.InvalidTokenError(f"could not reach Supabase Auth to check the token: {exc}") from exc
            if r.status_code != 200:
                raise jwt.InvalidTokenError(f"Supabase Auth rejected the token (HTTP {r.status_code})")
            if r.json().get("id") != claims["sub"]:
                raise jwt.InvalidTokenError("Supabase Auth returned a different user than the token names")
            self._confirmed = {k: t for k, t in self._confirmed.items() if now - t <= AUTH_CONFIRM_TTL_S}
            self._confirmed[key] = now
        return claims


def current_principal(request: Request) -> Principal:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Missing bearer token.")

    verifier: JwtVerifier = request.app.state.verifier
    try:
        claims = verifier.verify(token)
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        raise HTTPException(401, f"Invalid token: {exc}") from exc

    app_metadata = claims.get("app_metadata") or {}
    tenant_id, role = app_metadata.get("tenant_id"), app_metadata.get("role")
    if not tenant_id:
        raise HTTPException(403, "Account has no tenant.")
    return Principal(user_id=claims["sub"], tenant_id=str(tenant_id), role=str(role or ""))


def authoring_principal(principal: Principal = Depends(current_principal)) -> Principal:
    if principal.role not in AUTHORING_ROLES:
        raise HTTPException(403, "Only designers and tenant admins can use the Agentic Designer.")
    return principal
