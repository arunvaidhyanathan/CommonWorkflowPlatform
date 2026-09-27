"""API key health checks (SpendTracker.html Section 3.3).

Each check is a free, read-only call (list models / key info). Keys travel
in headers, never URLs, so they can't end up in access logs. A free check
can't detect a spend cap; that shows up as rate_limited calls in the usage
data instead (store.key_status).
"""

import os
from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class KeySpec:
    key_alias: str  # the environment variable that holds the key
    provider: str
    url: str
    header: str
    prefix: str = ""


# Only the paid-API keys the platform uses. AWS stays out until Cost
# Explorer is wanted (SpendTracker.html Section 2).
KEYS = (
    KeySpec("GEMINI_API_KEY", "gemini", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", "x-goog-api-key"),
    KeySpec("NVIDIA_API_KEY", "nvidia", "https://integrate.api.nvidia.com/v1/models", "Authorization", "Bearer "),
    KeySpec("OPENROUTER_API_KEY", "openrouter", "https://openrouter.ai/api/v1/key", "Authorization", "Bearer "),
    KeySpec("TYPESAFE_JEV_API_KEY", "typesafe", "https://api.typesafe.ai/v1/models", "Authorization", "Bearer "),
)


@dataclass(frozen=True)
class CheckResult:
    key_alias: str
    provider: str
    status: str  # valid | expired | invalid | missing | error
    http_status: int | None
    detail: str | None


def classify(status_code: int, body: str) -> tuple[str, str | None]:
    if 200 <= status_code < 300:
        return "valid", None
    lowered = body.lower()
    if status_code in (400, 401, 403):
        if "expired" in lowered:
            return "expired", _short(body)
        return "invalid", _short(body)
    return "error", _short(body)


async def check_key(client: httpx.AsyncClient, spec: KeySpec, env: dict[str, str] | None = None) -> CheckResult:
    value = (env if env is not None else os.environ).get(spec.key_alias)
    if not value:
        return CheckResult(spec.key_alias, spec.provider, "missing", None, "not configured for the tracker")
    try:
        resp = await client.get(spec.url, headers={spec.header: spec.prefix + value}, timeout=20)
    except httpx.HTTPError as exc:
        return CheckResult(spec.key_alias, spec.provider, "error", None, type(exc).__name__)
    status, detail = classify(resp.status_code, resp.text)
    return CheckResult(spec.key_alias, spec.provider, status, resp.status_code, detail)


def _short(body: str) -> str:
    # Provider error text, trimmed. Error bodies don't echo the key back for
    # these providers, but never store more than needed.
    return " ".join(body.split())[:200]
