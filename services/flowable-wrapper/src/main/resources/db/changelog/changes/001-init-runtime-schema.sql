--liquibase formatted sql

-- flowable-wrapper's own tables, in schema runtime. The schema itself is
-- created by database/01-schemas.sql (owned by role cwp_runtime), so the
-- service needs no database-level privileges.

--changeset arun:002-create-deployments-table
-- Thin-layer placeholder for what Flowable's /repository/deployments would
-- eventually back for real (WorkflowWrapper.html Section 8). tenant_id is
-- not a foreign key to identity.tenants -- no foreign key crosses service
-- schemas, so this service's migrations never depend on another's shape.
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
