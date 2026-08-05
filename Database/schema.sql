-- ============================================================================
-- Common Workflow Platform (CWP) -- Design-Time Schema (Portable DDL)
-- ============================================================================
-- Generated: 2026-08-04, from the live schema described in
-- Documents/DataArchitecture.html. This script reproduces the design-time
-- data model on ANY PostgreSQL 14+ instance (Supabase, RDS, Cloud SQL, a
-- local Postgres, etc.) -- it deliberately does NOT depend on
-- Supabase-specific objects (auth.users, auth.jwt(), auth.uid(), the
-- Supabase Realtime/Storage extensions).
--
-- WHAT THIS SCRIPT DOES NOT DO:
--   1. Create user accounts or an identity provider. `profiles.id` is a
--      plain uuid FK'd to whatever your auth system's user-id primary key
--      is (Section "Identity / Auth Provider Substitution" below). On the
--      current live database, that's Supabase Auth's `auth.users(id)`.
--   2. Recreate Flowable's own ACT_*-prefixed engine tables. Those are
--      owned and Liquibase-managed by the Runtime Gateway itself
--      (WaaS/Workflow-Wrapper) -- see that project's
--      src/main/resources/db/changelog/. Do not hand-manage them here.
--   3. Migrate data. This is schema only. See Database/MIGRATION.md for
--      the data export/import plan.
--
-- HOW TO RUN:
--   psql "$DATABASE_URL" -f Database/schema.sql
--
-- Idempotency: every statement uses IF NOT EXISTS / OR REPLACE / DROP...
-- IF EXISTS guards, so this script can be re-run safely against a
-- partially-provisioned database.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
-- gen_random_uuid() ships in core as of Postgres 13, but pgcrypto is kept
-- for parity with the live database and for md5()/digest() if ever needed.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Identity / Auth Provider Substitution
-- ----------------------------------------------------------------------------
-- The live database's `profiles.id` references Supabase Auth's built-in
-- `auth.users(id)`. A portable target has no such schema unless you bring
-- your own (e.g. Keycloak, Auth0, or a hand-rolled `app_auth.users` table
-- fronted by a JWT-issuing service). This script creates a minimal
-- stand-in table -- `app_auth.users` -- so the FK below has something real
-- to point at. If your target already has its own identity table, DROP
-- this stand-in and repoint the FK in `profiles` (Section 3) at your real
-- one instead.
create schema if not exists app_auth;

create table if not exists app_auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

comment on table app_auth.users is
  'Minimal stand-in for whatever identity provider issues JWTs on the target platform. Not a full auth system -- replace with your real provider''s user table if you have one, and repoint profiles.id_fkey at it.';

-- ----------------------------------------------------------------------------
-- 2. tenants
-- ----------------------------------------------------------------------------
create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. profiles (tenant membership + role)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                       uuid primary key references app_auth.users(id) on delete cascade,
  tenant_id                uuid not null references public.tenants(id),
  role                     text not null check (role in ('designer', 'tenant_admin', 'approver', 'viewer')),
  display_name             text,
  created_at               timestamptz not null default now(),
  status                   text not null default 'active' check (status in ('active', 'deactivated')),
  onboarding_dismissed_at  timestamptz,
  email                    text
);

-- ----------------------------------------------------------------------------
-- 4. workflows
-- ----------------------------------------------------------------------------
create table if not exists public.workflows (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  definition_key      text not null,
  name                text not null,
  description         text,
  spec_type           text not null check (spec_type in ('BPMN', 'CMMN', 'DMN')),
  status              text not null default 'draft'
                        check (status in ('draft', 'pending_approval', 'approved', 'deployed', 'archived')),
  current_version_id  uuid, -- FK added after workflow_versions exists (circular reference)
  locked_by           uuid references public.profiles(id),
  locked_at           timestamptz,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint workflows_tenant_key_unique unique (tenant_id, definition_key)
);

-- ----------------------------------------------------------------------------
-- 5. workflow_versions (immutable snapshots)
-- ----------------------------------------------------------------------------
create table if not exists public.workflow_versions (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references public.workflows(id) on delete cascade,
  version_no   int not null,
  graph_json   jsonb not null,
  xml_content  text not null,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  unique (workflow_id, version_no)
);

-- Close the circular reference from workflows -> workflow_versions now that
-- the target table exists.
alter table public.workflows
  drop constraint if exists workflows_current_version_fk;
alter table public.workflows
  add constraint workflows_current_version_fk
  foreign key (current_version_id) references public.workflow_versions(id);

-- ----------------------------------------------------------------------------
-- 6. deployments (design-time traceability record; NOT the same table as
--    the Runtime Gateway's own runtime.deployments in Section 10)
-- ----------------------------------------------------------------------------
create table if not exists public.deployments (
  id                        uuid primary key default gen_random_uuid(),
  workflow_version_id       uuid not null references public.workflow_versions(id),
  tenant_id                 uuid not null references public.tenants(id),
  flowable_deployment_id    text,
  deployed_by               uuid references public.profiles(id),
  deployed_at               timestamptz not null default now(),
  status                    text not null default 'pending'
                              check (status in ('pending', 'active', 'failed', 'superseded'))
);

-- ----------------------------------------------------------------------------
-- 7. form_schemas
-- ----------------------------------------------------------------------------
create table if not exists public.form_schemas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  form_key     text not null,
  json_schema  jsonb not null,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  unique (tenant_id, form_key, version)
);

-- ----------------------------------------------------------------------------
-- 8. approval_requests
-- ----------------------------------------------------------------------------
create table if not exists public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  workflow_id   uuid not null references public.workflows(id),
  version_id    uuid not null references public.workflow_versions(id),
  requested_by  uuid references public.profiles(id),
  requested_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approver_id   uuid references public.profiles(id),
  decided_at    timestamptz,
  comment       text
);

-- ----------------------------------------------------------------------------
-- 9. audit_logs
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  actor_id     uuid references public.profiles(id),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  occurred_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 10. invites
-- ----------------------------------------------------------------------------
create table if not exists public.invites (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  email        text not null,
  role         text not null check (role in ('designer', 'tenant_admin', 'approver', 'viewer')),
  invited_by   uuid references public.profiles(id),
  status       text not null default 'invited' check (status in ('invited', 'accepted', 'revoked')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

-- ----------------------------------------------------------------------------
-- 11. Indexes (beyond the unique constraints/PKs already implied above)
-- ----------------------------------------------------------------------------
create index if not exists idx_workflows_tenant           on public.workflows (tenant_id);
create index if not exists idx_workflow_versions_workflow on public.workflow_versions (workflow_id);
create index if not exists idx_deployments_tenant         on public.deployments (tenant_id);
create index if not exists idx_deployments_version        on public.deployments (workflow_version_id);
create index if not exists idx_form_schemas_tenant        on public.form_schemas (tenant_id);
create index if not exists audit_logs_tenant_occurred_idx on public.audit_logs (tenant_id, occurred_at desc);
create index if not exists invites_tenant_idx             on public.invites (tenant_id, created_at desc);

commit;
