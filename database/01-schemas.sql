-- ============================================================================
-- CWP database, step 1: one schema per service, owned by that service's role.
-- ============================================================================
-- Run as the database administrator after 00-roles.sql. Safe to re-run.
--
-- runtime and spend stay empty here: flowable-wrapper creates its tables at
-- startup (Liquibase + Flowable's own schema management) and spend-tracker
-- runs its numbered migrations at startup. Both hold a database lock while
-- doing so, so several replicas can start at once.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- pgcrypto: only the seed and bootstrap scripts use it (bcrypt via crypt()).
-- gen_random_uuid() is built into PostgreSQL 13+.
create extension if not exists pgcrypto;

create schema if not exists identity authorization cwp_identity;
create schema if not exists design   authorization cwp_design;
create schema if not exists runtime  authorization cwp_runtime;
create schema if not exists spend    authorization cwp_spend;

-- Nobody but the administrator creates objects in public.
revoke create on schema public from public;

commit;
