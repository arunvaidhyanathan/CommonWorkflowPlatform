"""Budgets and alerts (SpendTracker.html Section 3d).

Alerts are raised where the evidence arrives: after each usage event
(budgets, refused calls), after each key check (expired/invalid keys), and
after each provider usage report (credit limits). Duplicates are prevented
by unique indexes (migration 002), so these functions can run as often as
events arrive. Key alerts clear themselves once the evidence says the
problem is gone.
"""

import logging
from datetime import UTC, datetime
from decimal import Decimal

from psycopg import AsyncConnection

log = logging.getLogger("spend_tracker.alerts")

BUDGET_THRESHOLDS = ((80, "warning"), (100, "critical"))
PROVIDER_LIMIT_WARN_FRACTION = Decimal("0.2")  # warn when < 20% of a credit limit remains


def month_bounds(now: datetime) -> tuple[datetime, datetime, str]:
    start = datetime(now.year, now.month, 1, tzinfo=UTC)
    end = datetime(now.year + (now.month == 12), now.month % 12 + 1, 1, tzinfo=UTC)
    return start, end, f"{now.year:04d}-{now.month:02d}"


async def _raise(conn: AsyncConnection, kind: str, subject: str, level: str, message: str,
                 period: str | None = None, threshold: int | None = None) -> bool:
    if kind == "budget":
        conflict = "on conflict (kind, subject, period, threshold) where kind = 'budget' do nothing"
    else:
        conflict = "on conflict (kind, subject) where acknowledged_at is null and kind <> 'budget' do nothing"
    cur = await conn.execute(
        f"""insert into alerts (kind, subject, level, message, period, threshold)
            values (%s, %s, %s, %s, %s, %s) {conflict} returning id""",
        (kind, subject, level, message, period, threshold),
    )
    raised = await cur.fetchone() is not None
    if raised:
        log.warning("ALERT %s %s %s: %s", level.upper(), kind, subject, message)
    return raised


async def _resolve(conn: AsyncConnection, kind: str, subject: str, reason: str) -> None:
    await conn.execute(
        """update alerts set acknowledged_at = now(), acknowledged_by = %s
           where kind = %s and subject = %s and acknowledged_at is null""",
        (f"auto: {reason}", kind, subject),
    )


async def evaluate_budgets(conn: AsyncConnection, now: datetime | None = None) -> None:
    """Raise a budget alert for every threshold crossed this month."""
    now = now or datetime.now(UTC)
    start, end, period = month_bounds(now)
    budgets = await (await conn.execute("select subject, monthly_usd from budgets")).fetchall()
    if not budgets:
        return
    rows = await (await conn.execute(
        """select provider, coalesce(sum(cost_usd), 0) from usage_events
           where at >= %s and at < %s group by provider""",
        (start, end),
    )).fetchall()
    spent_by_provider = {provider: spent for provider, spent in rows}
    for subject, budget in budgets:
        spent = sum(spent_by_provider.values(), Decimal(0)) if subject == "total" else spent_by_provider.get(subject, Decimal(0))
        percent = spent / budget * 100
        for threshold, level in BUDGET_THRESHOLDS:
            if percent >= threshold:
                await _raise(
                    conn, "budget", subject, level,
                    f"{subject} spend ${spent:.2f} is {percent:.0f}% of its ${budget:.2f} monthly budget ({period}).",
                    period=period, threshold=threshold,
                )


async def after_event(conn: AsyncConnection, key_alias: str, provider: str, outcome: str, priced: bool) -> None:
    if outcome == "rate_limited":
        await _raise(conn, "key_refused", key_alias, "warning",
                     f"A call through {key_alias} ({provider}) was refused: rate limit, quota or spend cap.")
    elif outcome == "ok":
        await _resolve(conn, "key_refused", key_alias, "a later call succeeded")
    if priced:
        await evaluate_budgets(conn)


async def after_key_check(conn: AsyncConnection, key_alias: str, provider: str, status: str, detail: str | None) -> None:
    if status in ("expired", "invalid"):
        await _raise(conn, "key_status", key_alias, "critical",
                     f"{key_alias} ({provider}) is {status}" + (f": {detail}" if detail else "."))
    elif status == "valid":
        await _resolve(conn, "key_status", key_alias, "key checked valid")


async def after_provider_usage(conn: AsyncConnection, key_alias: str, provider: str,
                               limit_usd: Decimal | None, remaining_usd: Decimal | None) -> None:
    if limit_usd and remaining_usd is not None and limit_usd > 0:
        if remaining_usd / limit_usd < PROVIDER_LIMIT_WARN_FRACTION:
            await _raise(conn, "provider_limit", key_alias, "warning",
                         f"{key_alias} ({provider}) has ${remaining_usd:.2f} of its ${limit_usd:.2f} credit limit left.")
        else:
            await _resolve(conn, "provider_limit", key_alias, "limit headroom restored")
