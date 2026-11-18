-- ============================================================================
-- CWP on a local Postgres -- simple username/password auth + seed data
-- ============================================================================
-- Run AFTER schema.sql and policies.sql:
--   createdb cwp
--   psql -d cwp -f Database/schema.sql -f Database/policies.sql -f Database/local.sql
--
-- workflow-runtime checks passwords against app_auth.users.password_hash
-- (bcrypt) and issues its own JWT. It connects as the tables' owner, so the
-- RLS policies are not enforced at the database; workflow-runtime enforces
-- the same tenant/role rules in code. The audit and status triggers still
-- run, reading the actor from request.jwt.claims, which workflow-runtime
-- sets on each transaction.
-- ============================================================================

begin;

alter table app_auth.users add column if not exists username text unique;
alter table app_auth.users add column if not exists password_hash text;

-- workflow-runtime's own schema (Liquibase + Flowable ACT_* tables).
create schema if not exists runtime;

-- Seed: one tenant and one user per role. LOCAL DEVELOPMENT ONLY -- the
-- password for every seeded user is "password".
insert into public.tenants (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Local Tenant', 'local')
on conflict (id) do nothing;

insert into app_auth.users (id, email, username, password_hash) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin',    'admin',    crypt('password', gen_salt('bf', 10))),
  ('00000000-0000-0000-0000-0000000000a2', 'designer', 'designer', crypt('password', gen_salt('bf', 10))),
  ('00000000-0000-0000-0000-0000000000a3', 'approver', 'approver', crypt('password', gen_salt('bf', 10)))
on conflict (id) do nothing;

insert into public.profiles (id, tenant_id, role, display_name, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'tenant_admin', 'Admin',    'admin'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'designer',     'Designer', 'designer'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'approver',     'Approver', 'approver')
on conflict (id) do nothing;

commit;
