-- ============================================================================
-- CWP database, step 2: identity schema (identity-service).
-- ============================================================================
-- Users and their passwords, tenants, tenant membership and role, task
-- candidate groups, and invites. Run as the database administrator after
-- 01-schemas.sql; objects are created as cwp_identity. Safe to re-run.
-- ============================================================================

\set ON_ERROR_STOP on

begin;
set local role cwp_identity;

-- Login accounts. identity-service checks password_hash (bcrypt) on login.
create table if not exists identity.users (
  id             uuid primary key default gen_random_uuid(),
  username       text not null unique,
  email          text unique,
  password_hash  text,
  created_at     timestamptz not null default now()
);

create table if not exists identity.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

-- Tenant membership and role. A user belongs to exactly one tenant.
create table if not exists identity.profiles (
  id                       uuid primary key references identity.users(id) on delete cascade,
  tenant_id                uuid not null references identity.tenants(id),
  role                     text not null check (role in ('designer', 'tenant_admin', 'approver', 'viewer')),
  display_name             text,
  email                    text,
  status                   text not null default 'active' check (status in ('active', 'deactivated')),
  onboarding_dismissed_at  timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists profiles_tenant_idx on identity.profiles (tenant_id);

-- Flowable task candidate groups. A member is also, implicitly, in a group
-- named after their role (e.g. "designer").
create table if not exists identity.group_members (
  tenant_id   uuid not null references identity.tenants(id),
  user_id     uuid not null references identity.profiles(id) on delete cascade,
  group_key   text not null check (group_key ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'),
  created_at  timestamptz not null default now(),
  primary key (user_id, group_key)
);
create index if not exists group_members_tenant_group_idx on identity.group_members (tenant_id, group_key);

-- History of users created by tenant admins.
create table if not exists identity.invites (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.tenants(id),
  email        text not null,
  role         text not null check (role in ('designer', 'tenant_admin', 'approver', 'viewer')),
  invited_by   uuid references identity.profiles(id),
  status       text not null default 'invited' check (status in ('invited', 'accepted', 'revoked')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);
create index if not exists invites_tenant_idx on identity.invites (tenant_id, created_at desc);

commit;
