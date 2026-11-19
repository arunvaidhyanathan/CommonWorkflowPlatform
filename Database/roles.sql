-- ============================================================================
-- CWP database roles: one login role per service, each limited to the tables
-- that service owns. LOCAL POSTGRES / DOCKER COMPOSE ONLY -- never run this
-- on the hosted Supabase project.
-- ============================================================================
-- Run AFTER schema.sql, policies.sql and local.sql, as a superuser (the
-- roles get BYPASSRLS). Safe to re-run. Passwords are optional (local trust
-- auth needs none):
--   psql -d cwp -f Database/roles.sql
--   psql -d cwp -v identity_password=... -v design_password=... \
--        -v runtime_password=... -f Database/roles.sql
--
--   cwp_identity  identity-service  app_auth.users, tenants, profiles,
--                                    group_members, invites
--   cwp_design    design-service    workflows, workflow_versions,
--                                    approval_requests, audit_logs
--   cwp_runtime   flowable-wrapper  the runtime schema (its own tables and
--                                    Flowable's ACT_* tables)
--
-- BYPASSRLS: the services enforce tenant and role rules in code (the RLS
-- policies in policies.sql are written for Supabase's request roles), as
-- they did when they connected as the tables' owner. What the roles add is
-- that no service can read or write another service's tables.
--
-- Foreign keys from design tables to tenants/profiles stay: they are checked
-- with the table owner's rights, so they keep working while everything
-- shares one database. Drop them only when the services get separate
-- database servers.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  r text;
begin
  foreach r in array array['cwp_identity', 'cwp_design', 'cwp_runtime'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I login bypassrls', r);
    else
      execute format('alter role %I login bypassrls', r);
    end if;
  end loop;
end
$$;

\if :{?identity_password}
alter role cwp_identity password :'identity_password';
\endif
\if :{?design_password}
alter role cwp_design password :'design_password';
\endif
\if :{?runtime_password}
alter role cwp_runtime password :'runtime_password';
\endif

-- Profile status changes are audited by identity-service, which posts them to
-- design-service's audit log: the trigger on profiles would need identity to
-- write design's audit_logs. (Kept in policies.sql for the hosted Supabase
-- project, which this script never touches.)
drop trigger if exists profiles_audit_status on public.profiles;

-- identity-service
grant usage on schema app_auth, public to cwp_identity;
grant select, insert, update, delete on
  app_auth.users, public.tenants, public.profiles, public.group_members, public.invites
  to cwp_identity;

-- design-service
grant usage on schema public to cwp_design;
grant select, insert, update, delete on
  public.workflows, public.workflow_versions, public.approval_requests, public.audit_logs
  to cwp_design;

-- flowable-wrapper: owns its schema and everything in it, because Flowable
-- and Liquibase create and alter their own tables.
alter schema runtime owner to cwp_runtime;
do $$
declare
  obj record;
begin
  for obj in select tablename as name from pg_tables where schemaname = 'runtime' loop
    execute format('alter table runtime.%I owner to cwp_runtime', obj.name);
  end loop;
  -- Sequences that belong to a column move with their table; only standalone ones are left.
  for obj in
    select c.relname as name from pg_class c
    where c.relnamespace = 'runtime'::regnamespace and c.relkind = 'S'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i'))
  loop
    execute format('alter sequence runtime.%I owner to cwp_runtime', obj.name);
  end loop;
  for obj in select viewname as name from pg_views where schemaname = 'runtime' loop
    execute format('alter view runtime.%I owner to cwp_runtime', obj.name);
  end loop;
end
$$;

commit;
