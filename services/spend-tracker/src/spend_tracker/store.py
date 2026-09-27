"""Reads and writes for usage events and key checks."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

from . import alerts

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
        await alerts.after_event(conn, e.key_alias, e.provider, e.outcome, priced=e.cost_usd is not None and e.cost_usd > 0)


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

        async def rows(group_by: str) -> list[dict]:
            cur = await conn.cursor(row_factory=dict_row).execute(
                f"select {group_by}, {measures} from usage_events where {where} group by {group_by} order by cost_usd desc, calls desc",
                params,
            )
            return [_clean(r) for r in await cur.fetchall()]

        total = _clean(await (await conn.cursor(row_factory=dict_row).execute(f"select {measures} from usage_events where {where}", params)).fetchone())
        daily_cur = await conn.cursor(row_factory=dict_row).execute(
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
                       http_status: int | None, detail: str | None, usage=None) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "insert into key_checks (key_alias, provider, status, http_status, detail) values (%s, %s, %s, %s, %s)",
            (key_alias, provider, status, http_status, detail),
        )
        await alerts.after_key_check(conn, key_alias, provider, status, detail)
        if usage is not None:
            await conn.execute(
                """insert into provider_usage (provider, key_alias, usage_usd, limit_usd, limit_remaining_usd)
                   values (%s, %s, %s, %s, %s)""",
                (provider, key_alias, usage.usage_usd, usage.limit_usd, usage.limit_remaining_usd),
            )
            await alerts.after_provider_usage(conn, key_alias, provider, usage.limit_usd, usage.limit_remaining_usd)


async def key_status(pool: AsyncConnectionPool) -> list[dict]:
    """Latest check per key, plus what the last metered call through that
    key did: a free check can't see a spend cap, but a 429 on a real call can."""
    async with pool.connection() as conn:
        cur = await conn.cursor(row_factory=dict_row).execute(
            """with latest_check as (
                   select distinct on (key_alias) key_alias, provider, status, http_status, detail, checked_at
                   from key_checks order by key_alias, checked_at desc),
               latest_call as (
                   select distinct on (key_alias) key_alias, outcome, at
                   from usage_events order by key_alias, at desc),
               last_ok as (
                   select key_alias, max(at) as at from usage_events where outcome = 'ok' group by key_alias),
               reported as (
                   select distinct on (key_alias) key_alias, usage_usd, limit_usd, limit_remaining_usd, fetched_at
                   from provider_usage order by key_alias, fetched_at desc)
               select c.key_alias, c.provider, c.status, c.http_status, c.detail, c.checked_at,
                      u.outcome as last_call_outcome, u.at as last_call_at, o.at as last_ok_call_at,
                      r.usage_usd as reported_usage_usd, r.limit_usd as reported_limit_usd,
                      r.limit_remaining_usd as reported_limit_remaining_usd, r.fetched_at as reported_at
               from latest_check c
               left join latest_call u using (key_alias)
               left join last_ok o using (key_alias)
               left join reported r using (key_alias)
               order by c.key_alias"""
        )
        return [_clean(r) for r in await cur.fetchall()]


# Read queries use a dict row factory on their own cursor only. Setting it
# on the connection would leak into whatever code borrows that pooled
# connection next (a budget check once received dicts instead of tuples).
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


# --- budgets and alerts (S3) -------------------------------------------------------

async def list_budgets(pool: AsyncConnectionPool) -> list[dict]:
    """Each budget with this month's priced spend against it."""
    start, end, period = alerts.month_bounds(datetime.now(UTC))
    async with pool.connection() as conn:
        cur = await conn.cursor(row_factory=dict_row).execute(
            """with spent as (
                   select provider, coalesce(sum(cost_usd), 0) as usd from usage_events
                   where at >= %(start)s and at < %(end)s group by provider)
               select b.subject, b.monthly_usd, b.updated_at, b.updated_by,
                      case when b.subject = 'total' then (select coalesce(sum(usd), 0) from spent)
                           else coalesce((select usd from spent where provider = b.subject), 0) end as spent_usd
               from budgets b order by b.subject = 'total' desc, b.subject""",
            {"start": start, "end": end},
        )
        return [{**_clean(r), "period": period} for r in await cur.fetchall()]


async def set_budget(pool: AsyncConnectionPool, subject: str, monthly_usd: Decimal, by: str) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """insert into budgets (subject, monthly_usd, updated_by) values (%s, %s, %s)
               on conflict (subject) do update set monthly_usd = excluded.monthly_usd,
                   updated_at = now(), updated_by = excluded.updated_by""",
            (subject, monthly_usd, by),
        )
        # A lowered budget may already be exceeded; say so now, not at the next call.
        await alerts.evaluate_budgets(conn)


async def delete_budget(pool: AsyncConnectionPool, subject: str) -> bool:
    async with pool.connection() as conn:
        cur = await conn.execute("delete from budgets where subject = %s", (subject,))
        return cur.rowcount > 0


async def list_alerts(pool: AsyncConnectionPool, open_only: bool) -> list[dict]:
    async with pool.connection() as conn:
        cur = await conn.cursor(row_factory=dict_row).execute(
            "select * from alerts" + (" where acknowledged_at is null" if open_only else "")
            + " order by raised_at desc limit 100"
        )
        return [_clean(r) for r in await cur.fetchall()]


async def acknowledge_alert(pool: AsyncConnectionPool, alert_id: int, by: str) -> bool:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "update alerts set acknowledged_at = now(), acknowledged_by = %s where id = %s and acknowledged_at is null",
            (by, alert_id),
        )
        return cur.rowcount > 0
