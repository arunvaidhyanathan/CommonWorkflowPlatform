--liquibase formatted sql

-- Runtime Gateway Phase 1 (WorkflowWrapper.html Section 9). This exact SQL
-- has already been applied directly against the shared Supabase Postgres
-- project (nrhsoabqeskybrznxfyi) during scaffolding, ahead of this service
-- ever running. When this service connects to that project for the first
-- time, run `liquibase changelog-sync` (or the Spring Boot equivalent) so
-- Liquibase records this changeset as already applied instead of re-running
-- it and failing on "already exists" -- see README.md.
--
-- Deliberately a NEW schema, not new tables in `public`: this keeps one
-- tenant registry (public.tenants, owned by Supabase/RLS) while giving this
-- service full, unencumbered ownership over the workflow-runtime data
-- shape, which doesn't need and isn't subject to RLS the way the
-- anon-key-facing public schema is (see WorkflowWrapper.html Section 7).

--changeset arun:001-create-runtime-schema
create schema if not exists runtime;

--changeset arun:002-create-deployments-table
-- Thin-layer placeholder for what Flowable's /repository/deployments would
-- eventually back for real (WorkflowWrapper.html Section 8). tenant_id is
-- not a foreign key to public.tenants -- this schema deliberately doesn't
-- take a cross-schema FK dependency on the Supabase-owned schema, so this
-- service's migrations never need to know about that schema's shape.
-- Tenant scoping is enforced in application code (TenantContext.java,
-- documented in WorkflowWrapper.html Section 7), not by a database
-- constraint here.
create table if not exists runtime.deployments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    name text not null,
    spec_type text,
    description text,
    status text not null default 'pending',
    created_by uuid,
    created_at timestamptz not null default now()
);

--changeset arun:003-deployments-tenant-index
create index if not exists deployments_tenant_idx on runtime.deployments (tenant_id, created_at desc);

--changeset arun:004-deployments-table-comment
comment on table runtime.deployments is
    'Thin-layer placeholder for Flowable-style deployments (WorkflowWrapper.html Phase 1/2). No real deployable artifact is produced yet -- see Designer.html Section 23.1/23.3.';
