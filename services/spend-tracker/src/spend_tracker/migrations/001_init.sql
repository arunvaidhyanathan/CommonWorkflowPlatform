-- Metered usage: one row per paid model call a CWP service made
-- (SpendTracker.html Section 3.1). Written only by the ingest endpoint.
create table usage_events (
    id             bigserial primary key,
    at             timestamptz not null,
    service        text not null,
    feature        text not null,
    provider       text not null,
    model          text not null,
    key_alias      text not null,
    tenant_id      text not null,
    user_id        text not null,
    request_id     text,
    outcome        text not null check (outcome in ('ok', 'rate_limited', 'error', 'empty')),
    input_tokens   integer not null check (input_tokens >= 0),
    output_tokens  integer not null check (output_tokens >= 0),
    -- null = unpriced (no price for this provider/model), never 0
    cost_usd       numeric(18, 8),
    latency_ms     integer not null check (latency_ms >= 0),
    received_at    timestamptz not null default now()
);

create index usage_events_at on usage_events (at);
create index usage_events_tenant_at on usage_events (tenant_id, at);
create index usage_events_key_at on usage_events (key_alias, at);

-- API key health check history (Section 3.3). Latest row per key_alias is
-- the current status.
create table key_checks (
    id           bigserial primary key,
    checked_at   timestamptz not null default now(),
    key_alias    text not null,
    provider     text not null,
    status       text not null check (status in ('valid', 'expired', 'invalid', 'missing', 'error')),
    http_status  integer,
    detail       text
);

create index key_checks_alias_at on key_checks (key_alias, checked_at desc);
