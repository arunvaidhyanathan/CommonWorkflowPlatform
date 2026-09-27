"""Who may see what (SpendTracker.html Section 3.5).

The same Supabase JWT check as agentic-designer and workflow-runtime
(signature + expiry against the project's JWKS; tenant and role from
app_metadata). This is copied rather than shared on purpose: each service
owns its auth code, and it is small.

Access:
- platform admins (user ids in SPEND_ADMIN_USER_IDS): platform-wide spend
  and key health. Stands in for the platform-level role CWP doesn't have
  yet (Governance.html Section 3.1).
- tenant_admin: their own tenant's spend only. The keys are the platform
  operator's, and showing one tenant another tenant's usage would break the
  tenant isolation RLS enforces everywhere else.
- the ingest endpoint: services only, with a shared token, never a user.
"""

import hmac
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request


@dataclass(frozen=True)
class Viewer:
    user_id: str
    tenant_id: str | None
    role: str
    platform_admin: bool


class JwtVerifier:
    def __init__(self, jwks_url: str):
        self._jwks = jwt.PyJWKClient(jwks_url, cache_keys=True)

    def verify(self, token: str) -> dict:
        key = self._jwks.get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=["ES256", "RS256"],
                          options={"verify_aud": False, "require": ["exp", "sub"]})


def current_viewer(request: Request) -> Viewer:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Missing bearer token.")
    try:
        claims = request.app.state.verifier.verify(token)
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        raise HTTPException(401, f"Invalid token: {exc}") from exc
    meta = claims.get("app_metadata") or {}
    user_id = claims["sub"]
    return Viewer(
        user_id=user_id,
        tenant_id=str(meta["tenant_id"]) if meta.get("tenant_id") else None,
        role=str(meta.get("role") or ""),
        platform_admin=user_id in request.app.state.admin_user_ids,
    )


def spend_viewer(viewer: Viewer = Depends(current_viewer)) -> Viewer:
    if viewer.platform_admin:
        return viewer
    if viewer.role == "tenant_admin" and viewer.tenant_id:
        return viewer
    raise HTTPException(403, "Only tenant admins and platform admins can view API spend.")


def platform_admin(viewer: Viewer = Depends(current_viewer)) -> Viewer:
    if not viewer.platform_admin:
        raise HTTPException(403, "Only platform admins can see API key health.")
    return viewer


def ingest_caller(request: Request) -> None:
    expected = request.app.state.ingest_token
    supplied = request.headers.get("x-ingest-token", "")
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(401, "Invalid ingest token.")
