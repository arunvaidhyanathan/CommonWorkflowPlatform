-- ============================================================================
-- CWP database, step 0: one login role per service.
-- ============================================================================
-- Run as the database administrator (superuser, or a role with CREATEROLE),
-- connected to the CWP database. Safe to re-run. Passwords are optional here
-- (local trust auth needs none); on OpenShift pass them from the database
-- Secret:
--   psql -d cwp -v identity_password=... -v design_password=... \
--        -v runtime_password=... -v spend_password=... -f 00-roles.sql
--
--   cwp_identity  identity-service   owns schema identity
--   cwp_design    design-service     owns schema design
--   cwp_runtime   flowable-wrapper   owns schema runtime (Flowable + Liquibase)
--   cwp_spend     spend-tracker      owns schema spend (its own migrations)
--
-- A service can use only its own schema. No foreign key crosses schemas, so
-- any service can later move to its own database server unchanged.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  r text;
begin
  foreach r in array array['cwp_identity', 'cwp_design', 'cwp_runtime', 'cwp_spend'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I login', r);
    end if;
    -- The administrator creates each schema's objects as its owner (set role).
    execute format('grant %I to current_user', r);
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
\if :{?spend_password}
alter role cwp_spend password :'spend_password';
\endif

commit;
