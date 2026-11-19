"""Login token verification, mirroring the Java services' SecurityConfig /
TenantContext: the RS256 signature and expiry are checked against
identity-service's JWKS; tenant and role are read from ``app_metadata``.
"""

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request

# Roles allowed to generate or edit workflows (AgenticDesigner.html Section 4).
AUTHORING_ROLES = frozenset({"designer", "tenant_admin"})


@dataclass(frozen=True)
class Principal:
    user_id: str
    tenant_id: str
    role: str


class JwtVerifier:
    """Tokens are signed by identity-service with a key published in its JWKS."""

    def __init__(self, jwks_url: str):
        self._jwks = jwt.PyJWKClient(jwks_url, cache_keys=True)

    def signing_key(self, token: str):
        return self._jwks.get_signing_key_from_jwt(token).key

    def verify(self, token: str) -> dict:
        return jwt.decode(
            token,
            self.signing_key(token),
            algorithms=["RS256", "ES256"],
            # Identity comes from the signature; the audience isn't pinned.
            options={"verify_aud": False, "require": ["exp", "sub"]},
        )


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
