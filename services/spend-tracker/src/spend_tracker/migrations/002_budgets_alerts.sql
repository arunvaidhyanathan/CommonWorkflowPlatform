-- S3 (SpendTracker.html Section 3d): monthly budgets, alerts, and usage
-- totals reported by providers that expose them.

-- One monthly budget per provider, or 'total' for everything. Compared with
-- month-to-date (UTC) priced spend; unpriced calls can't count toward it.
create table budgets (
    subject      text primary key,
    monthly_usd  numeric(12, 2) not null check (monthly_usd > 0),
    updated_at   timestamptz not null default now(),
    updated_by   text not null
);

create table alerts (
    id               bigserial primary key,
    raised_at        timestamptz not null default now(),
    -- budget: spend crossed a threshold; key_status: a check found the key
    -- expired/invalid; key_refused: a real call through a key was refused;
    -- provider_limit: a provider-reported credit limit is nearly used up
    kind             text not null check (kind in ('budget', 'key_status', 'key_refused', 'provider_limit')),
    subject          text not null,   -- provider, 'total', or key alias
    level            text not null check (level in ('warning', 'critical')),
    message          text not null,
    period           text,            -- 'YYYY-MM' for budget alerts
    threshold        integer,         -- percent, for budget alerts
    acknowledged_at  timestamptz,
    acknowledged_by  text
);

-- A budget threshold alerts once per subject, month and threshold, even
-- after it's acknowledged.
create unique index alerts_budget_once
    on alerts (kind, subject, period, threshold) where kind = 'budget';
-- Other kinds: at most one open (unacknowledged) alert per kind and subject,
-- so a key that stays broken doesn't raise one alert per check.
create unique index alerts_open_once
    on alerts (kind, subject) where acknowledged_at is null and kind <> 'budget';
create index alerts_open on alerts (raised_at desc) where acknowledged_at is null;

-- Totals as the provider itself reports them (e.g. OpenRouter per-key usage).
-- These include use of the key outside CWP, unlike metered usage_events.
create table provider_usage (
    id                   bigserial primary key,
    fetched_at           timestamptz not null default now(),
    provider             text not null,
    key_alias            text not null,
    usage_usd            numeric(14, 4),
    limit_usd            numeric(14, 4),
    limit_remaining_usd  numeric(14, 4)
);

create index provider_usage_alias_at on provider_usage (key_alias, fetched_at desc);
