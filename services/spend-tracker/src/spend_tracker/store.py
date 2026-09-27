"""Reads and writes for usage events and key checks."""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

Outcome = Literal["ok", "rate_limited", "error", "empty"]


class UsageEventIn(BaseModel):
    """The event agentic-designer's usage.py emits, field for field."""

    at: datetime
    service: str = Field(min_length=1, max_length=100)
    feature: str = Field(min_length=1, max_length=100)
    provider: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)
    key_alias: str = Field(min_length=1, max_length=100)
    tenant_id: str = Field(min_length=1, max_length=100)
    user_id: str = Field(min_length=1, max_length=100)
    request_id: str | None = Field(default=None, max_length=200)
    outcome: Outcome
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cost_usd: Decimal | None = None
    latency_ms: int = Field(ge=0)


async def insert_event(pool: AsyncConnectionPool, e: UsageEventIn) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """insert into usage_events (at, service, feature, provider, model, key_alias, tenant_id, user_id,
                   request_id, outcome, input_tokens, output_tokens, cost_usd, latency_ms)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (e.at, e.service, e.feature, e.provider, e.model, e.key_alias, e.tenant_id, e.user_id,
             e.request_id, e.outcome, e.input_tokens, e.output_tokens, e.cost_usd, e.latency_ms),
        )


async def summary(pool: AsyncConnectionPool, start: datetime, end: datetime, tenant_id: str | None) -> dict:
    """Spend between start (inclusive) and end (exclusive). ``tenant_id``
    None means platform-wide; otherwise only that tenant's rows.

    Costs are summed over priced calls only; unpriced calls are counted
    separately so a total never silently includes guesses."""
    where = "at >= %(start)s and at < %(end)s" + ("" if tenant_id is None else " and tenant_id = %(tenant)s")
    params = {"start": start, "end": end, "tenant": tenant_id}
    measures = """count(*) as calls,
                  count(*) filter (where outcome = 'ok') as ok_calls,
                  count(*) filter (where outcome = 'rate_limited') as rate_limited_calls,
                  count(*) filter (where outcome in ('error', 'empty')) as failed_calls,
                  coalesce(sum(input_tokens), 0) as input_tokens,
                  coalesce(sum(output_tokens), 0) as output_tokens,
                  coalesce(sum(cost_usd), 0) as cost_usd,
                  count(*) filter (where cost_usd is null and outcome = 'ok') as unpriced_calls"""

    async with pool.connection() as conn:
        conn.row_factory = dict_row

        async def rows(group_by: str) -> list[dict]:
            cur = await conn.execute(
                f"select {group_by}, {measures} from usage_events where {where} group by {group_by} order by cost_usd desc, calls desc",
                params,
            )
            return [_clean(r) for r in await cur.fetchall()]

        total = _clean(await (await conn.execute(f"select {measures} from usage_events where {where}", params)).fetchone())
        daily_cur = await conn.execute(
            f"""select (at at time zone 'UTC')::date as day, count(*) as calls, coalesce(sum(cost_usd), 0) as cost_usd
                from usage_events where {where} group by day order by day""",
            params,
        )
        daily = [_clean(r) for r in await daily_cur.fetchall()]
        return {
            "scope": "platform" if tenant_id is None else "tenant",
            "tenantId": tenant_id,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "total": total,
            "byProvider": await rows("provider"),
            "byModel": await rows("provider, model"),
            "byFeature": await rows("service, feature"),
            "byTenant": await rows("tenant_id") if tenant_id is None else [],
            "daily": daily,
        }


async def record_check(pool: AsyncConnectionPool, key_alias: str, provider: str, status: str,
                       http_status: int | None, detail: str | None) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "insert into key_checks (key_alias, provider, status, http_status, detail) values (%s, %s, %s, %s, %s)",
            (key_alias, provider, status, http_status, detail),
        )


async def key_status(pool: AsyncConnectionPool) -> list[dict]:
    """Latest check per key, plus what the last metered call through that
    key did: a free check can't see a spend cap, but a 429 on a real call can."""
    async with pool.connection() as conn:
        conn.row_factory = dict_row
        cur = await conn.execute(
            """with latest_check as (
                   select distinct on (key_alias) key_alias, provider, status, http_status, detail, checked_at
                   from key_checks order by key_alias, checked_at desc),
               latest_call as (
                   select distinct on (key_alias) key_alias, outcome, at
                   from usage_events order by key_alias, at desc),
               last_ok as (
                   select key_alias, max(at) as at from usage_events where outcome = 'ok' group by key_alias)
               select c.key_alias, c.provider, c.status, c.http_status, c.detail, c.checked_at,
                      u.outcome as last_call_outcome, u.at as last_call_at, o.at as last_ok_call_at
               from latest_check c
               left join latest_call u using (key_alias)
               left join last_ok o using (key_alias)
               order by c.key_alias"""
        )
        return [_clean(r) for r in await cur.fetchall()]


def _clean(row: dict) -> dict:
    """camelCase keys; Decimals as strings (exact); datetimes/dates as ISO."""
    out = {}
    for k, v in row.items():
        head, *rest = k.split("_")
        key = head + "".join(p.title() for p in rest)
        if isinstance(v, Decimal):
            # Plain decimal notation: numeric(18,8) zero would otherwise
            # print as "0E-8".
            v = format(v.normalize(), "f")
        elif hasattr(v, "isoformat"):
            v = v.isoformat()
        out[key] = v
    return out
