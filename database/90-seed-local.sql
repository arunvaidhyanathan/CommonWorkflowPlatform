-- ============================================================================
-- LOCAL DEVELOPMENT ONLY: one tenant and one user per role, password
-- "password". Never run this on a shared or production database.
-- ============================================================================
-- Run after 02-identity.sql. Safe to re-run.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

insert into identity.tenants (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Local Tenant', 'local')
on conflict (id) do nothing;

insert into identity.users (id, username, email, password_hash) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin',    'admin',    crypt('password', gen_salt('bf', 10))),
  ('00000000-0000-0000-0000-0000000000a2', 'designer', 'designer', crypt('password', gen_salt('bf', 10))),
  ('00000000-0000-0000-0000-0000000000a3', 'approver', 'approver', crypt('password', gen_salt('bf', 10)))
on conflict (id) do nothing;

insert into identity.profiles (id, tenant_id, role, display_name, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'tenant_admin', 'Admin',    'admin'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'designer',     'Designer', 'designer'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'approver',     'Approver', 'approver')
on conflict (id) do nothing;

-- Candidate groups used by the KYC sample (services/web-app/samples/kyc-onboarding-case.cmmn).
insert into identity.group_members (tenant_id, user_id, group_key) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'kycAnalyst'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'eddTeam'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'seniorCompliance'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'kycManager')
on conflict do nothing;

commit;
