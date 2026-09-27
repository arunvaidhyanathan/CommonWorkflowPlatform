"""API key health checks (SpendTracker.html Section 3.3).

Each check is a free, read-only call (list models / key info). Keys travel
in headers, never URLs, so they can't end up in access logs. A free check
can't detect a spend cap; that shows up as rate_limited calls in the usage
data instead (store.key_status).
"""

import json
import os
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import httpx


@dataclass(frozen=True)
class KeySpec:
    key_alias: str  # the environment variable that holds the key
    provider: str
    url: str
    header: str
    prefix: str = ""
    # The check endpoint also returns the provider's own usage totals.
    reports_usage: bool = False


# Only the paid-API keys the platform uses. AWS stays out until Cost
# Explorer is wanted (SpendTracker.html Section 2).
KEYS = (
    KeySpec("GEMINI_API_KEY", "gemini", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", "x-goog-api-key"),
    KeySpec("NVIDIA_API_KEY", "nvidia", "https://integrate.api.nvidia.com/v1/models", "Authorization", "Bearer "),
    KeySpec("OPENROUTER_API_KEY", "openrouter", "https://openrouter.ai/api/v1/key", "Authorization", "Bearer ", reports_usage=True),
    KeySpec("TYPESAFE_JEV_API_KEY", "typesafe", "https://api.typesafe.ai/v1/models", "Authorization", "Bearer "),
)


@dataclass(frozen=True)
class CheckResult:
    key_alias: str
    provider: str
    status: str  # valid | expired | invalid | missing | error
    http_status: int | None
    detail: str | None
    usage: "ProviderUsage | None" = None


@dataclass(frozen=True)
class ProviderUsage:
    usage_usd: Decimal | None
    limit_usd: Decimal | None
    limit_remaining_usd: Decimal | None


def parse_openrouter_usage(payload: object) -> ProviderUsage | None:
    """OpenRouter GET /api/v1/key: {"data": {"usage", "limit", "limit_remaining", ...}}.
    ``limit`` is null for keys without a credit limit."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return None
    return ProviderUsage(_money(data.get("usage")), _money(data.get("limit")), _money(data.get("limit_remaining")))


def _money(value: object) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


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
    usage = None
    if status == "valid" and spec.reports_usage:
        try:
            usage = parse_openrouter_usage(resp.json())
        except ValueError:
            usage = None
    return CheckResult(spec.key_alias, spec.provider, status, resp.status_code, detail, usage)


def _short(body: str) -> str:
    """The provider's own error message when the body is JSON
    ({"error": {"message": ...}}, as Gemini, OpenRouter and NVIDIA send),
    otherwise the trimmed text. Error bodies don't echo the key back for
    these providers, but never store more than needed."""
    try:
        err = json.loads(body).get("error")
        message = err.get("message") if isinstance(err, dict) else err
        if isinstance(message, str) and message.strip():
            return " ".join(message.split())[:200]
    except (ValueError, AttributeError):
        pass
    return " ".join(body.split())[:200]
