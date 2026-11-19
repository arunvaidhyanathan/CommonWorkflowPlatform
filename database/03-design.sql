-- ============================================================================
-- CWP database, step 3: design schema (design-service).
-- ============================================================================
-- Workflows, their immutable versions, approval requests and the tenant
-- audit log, plus the triggers that keep workflow status in step with
-- approvals and record design-time audit entries. Run as the database
-- administrator after 01-schemas.sql; objects are created as cwp_design.
-- Safe to re-run.
--
-- tenant_id and user ids (created_by, requested_by, approver_id, actor_id)
-- refer to identity-service's records but carry no foreign key: each service
-- owns its own data.
-- ============================================================================

\set ON_ERROR_STOP on

begin;
set local role cwp_design;

create table if not exists design.workflows (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  definition_key      text not null,
  name                text not null,
  description         text,
  spec_type           text not null check (spec_type in ('BPMN', 'CMMN', 'DMN')),
  status              text not null default 'draft'
                        check (status in ('draft', 'pending_approval', 'approved', 'deployed', 'archived')),
  current_version_id  uuid,
  locked_by           uuid,
  locked_at           timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint workflows_tenant_key_unique unique (tenant_id, definition_key)
);
create index if not exists workflows_tenant_idx on design.workflows (tenant_id, updated_at desc);

create table if not exists design.workflow_versions (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references design.workflows(id) on delete cascade,
  version_no   int not null,
  graph_json   jsonb not null,
  xml_content  text not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (workflow_id, version_no)
);

alter table design.workflows drop constraint if exists workflows_current_version_fk;
alter table design.workflows add constraint workflows_current_version_fk
  foreign key (current_version_id) references design.workflow_versions(id);

create table if not exists design.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workflow_id   uuid not null references design.workflows(id),
  version_id    uuid not null references design.workflow_versions(id),
  requested_by  uuid,
  requested_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approver_id   uuid,
  decided_at    timestamptz,
  comment       text
);
create index if not exists approval_requests_tenant_status_idx on design.approval_requests (tenant_id, status, requested_at);

-- One audit log per tenant. Design-time rows come from the triggers below;
-- identity-service's role and status changes arrive through design-service's
-- POST /internal/design/audit.
create table if not exists design.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  actor_id     uuid,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  occurred_at  timestamptz not null default now()
);
create index if not exists audit_logs_tenant_occurred_idx on design.audit_logs (tenant_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- Triggers. design-service sets request.jwt.claims on each write transaction
-- (DesignDb.writer), so the triggers know who acted.
-- ----------------------------------------------------------------------------
create or replace function design.current_user_id()
returns uuid
language sql stable
as $$
  select (current_setting('request.jwt.claims', true)::json ->> 'sub')::uuid
$$;

create or replace function design.audit_approval_decision()
returns trigger
language plpgsql
set search_path = design, pg_temp
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    insert into design.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
    values (new.tenant_id, design.current_user_id(), 'approval_decided', 'approval_request', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status, 'comment', new.comment));
  end if;
  return new;
end;
$$;

create or replace function design.sync_workflow_status_from_approval()
returns trigger
language plpgsql
set search_path = design, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update design.workflows set status = 'pending_approval', updated_at = now() where id = new.workflow_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'approved' then
      update design.workflows set status = 'approved', updated_at = now() where id = new.workflow_id;
    elsif new.status = 'rejected' then
      update design.workflows set status = 'draft', updated_at = now() where id = new.workflow_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function design.reset_workflow_status_on_new_version()
returns trigger
language plpgsql
set search_path = design, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_previous_status text;
begin
  select tenant_id, status into v_tenant_id, v_previous_status from design.workflows where id = new.workflow_id;
  if v_previous_status = 'approved' then
    update design.workflows set status = 'draft', updated_at = now() where id = new.workflow_id;
    insert into design.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
    values (v_tenant_id, design.current_user_id(), 'workflow_status_reset_on_edit', 'workflow', new.workflow_id,
            jsonb_build_object('status', 'approved'),
            jsonb_build_object('status', 'draft', 'version_id', new.id));
  end if;
  return new;
end;
$$;

create or replace function design.audit_workflow_archive()
returns trigger
language plpgsql
set search_path = design, pg_temp
as $$
begin
  if new.status is distinct from old.status and new.status = 'archived' then
    insert into design.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
    values (new.tenant_id, design.current_user_id(), 'workflow_archived', 'workflow', new.id,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

create or replace function design.audit_workflow_delete()
returns trigger
language plpgsql
set search_path = design, pg_temp
as $$
begin
  insert into design.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
  values (old.tenant_id, design.current_user_id(), 'workflow_deleted', 'workflow', old.id,
          jsonb_build_object('name', old.name, 'status', old.status, 'definition_key', old.definition_key),
          null);
  return old;
end;
$$;

drop trigger if exists approval_requests_audit_decision on design.approval_requests;
create trigger approval_requests_audit_decision
  after update on design.approval_requests
  for each row execute function design.audit_approval_decision();

drop trigger if exists approval_requests_sync_status on design.approval_requests;
create trigger approval_requests_sync_status
  after insert or update on design.approval_requests
  for each row execute function design.sync_workflow_status_from_approval();

drop trigger if exists workflow_versions_reset_status_after_approval on design.workflow_versions;
create trigger workflow_versions_reset_status_after_approval
  after insert on design.workflow_versions
  for each row execute function design.reset_workflow_status_on_new_version();

drop trigger if exists workflows_audit_archive on design.workflows;
create trigger workflows_audit_archive
  after update on design.workflows
  for each row execute function design.audit_workflow_archive();

drop trigger if exists workflows_audit_delete on design.workflows;
create trigger workflows_audit_delete
  after delete on design.workflows
  for each row execute function design.audit_workflow_delete();

commit;
