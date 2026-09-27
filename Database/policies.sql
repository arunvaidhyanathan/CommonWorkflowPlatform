-- ============================================================================
-- Common Workflow Platform (CWP) -- Auth Helpers, RLS Policies & Triggers
-- ============================================================================
-- Run AFTER schema.sql. Reproduces the live database's row-level security
-- model and audit-trail triggers in a portable form.
--
-- PORTABILITY NOTE (read this first):
-- The live database's helper functions (current_tenant_id(),
-- current_role_claim(), is_current_user_active()) are implemented using
-- Supabase-specific calls: `auth.jwt()` and `auth.uid()`. Those functions
-- only exist because Supabase's PostgREST layer sets a Postgres session
-- variable (`request.jwt.claims`) per request and ships `auth.jwt()` /
-- `auth.uid()` as thin wrappers around reading it.
--
-- This script reimplements the SAME three helpers using the underlying
-- mechanism directly -- `current_setting('request.jwt.claims', true)` --
-- which is the actual PostgREST convention (Supabase's `auth.jwt()` is not
-- special; any PostgREST-fronted Postgres does this). That means these
-- policies work unmodified on any Postgres instance sitting behind
-- PostgREST, with or without Supabase. If your target platform's REST
-- layer uses a different claims-passing convention, only these four
-- functions need to change -- every policy below calls them by name, not
-- by inlining auth.jwt()/auth.uid() directly, so the blast radius of a
-- future auth-provider swap is contained to this one block.
--
-- HOW TO RUN:
--   psql "$DATABASE_URL" -f Database/policies.sql
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Auth claim helper functions
-- ----------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql stable
as $$
  select ((current_setting('request.jwt.claims', true)::json -> 'app_metadata') ->> 'tenant_id')::uuid
$$;

create or replace function public.current_role_claim()
returns text
language sql stable
as $$
  select (current_setting('request.jwt.claims', true)::json -> 'app_metadata') ->> 'role'
$$;

-- Portable replacement for Supabase's auth.uid(): the JWT's standard `sub`
-- claim is the current user's id on any spec-compliant JWT, not just
-- Supabase-issued ones.
create or replace function public.current_user_id()
returns uuid
language sql stable
as $$
  select (current_setting('request.jwt.claims', true)::json ->> 'sub')::uuid
$$;

create or replace function public.is_current_user_active()
returns boolean
language sql stable
as $$
  select coalesce(
    (select status = 'active' from public.profiles where id = public.current_user_id()),
    true
  )
$$;

-- ----------------------------------------------------------------------------
-- 2. Enable RLS on every design-time table
-- ----------------------------------------------------------------------------
alter table public.tenants            enable row level security;
alter table public.profiles           enable row level security;
alter table public.workflows          enable row level security;
alter table public.workflow_versions  enable row level security;
alter table public.deployments        enable row level security;
alter table public.form_schemas       enable row level security;
alter table public.approval_requests  enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.invites            enable row level security;

-- ----------------------------------------------------------------------------
-- 3. Policies -- tenants
-- ----------------------------------------------------------------------------
drop policy if exists "tenant self read" on public.tenants;
create policy "tenant self read" on public.tenants
  for select using (id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 4. Policies -- profiles
-- ----------------------------------------------------------------------------
drop policy if exists "profiles tenant read" on public.profiles;
create policy "profiles tenant read" on public.profiles
  for select using (tenant_id = current_tenant_id());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
  for update
  using (
    tenant_id = current_tenant_id()
    and current_role_claim() = 'tenant_admin'
    and is_current_user_active()
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_claim() = 'tenant_admin'
  );

-- A user may update their own row, but never their own role/tenant/email
-- (those are tamper-proof JWT claims elsewhere) -- prevents silent
-- self-privilege-escalation via a direct table write.
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update
  using (id = current_user_id())
  with check (
    id = current_user_id()
    and role = (select p.role from public.profiles p where p.id = current_user_id())
    and tenant_id = (select p.tenant_id from public.profiles p where p.id = current_user_id())
    and email is not distinct from (select p.email from public.profiles p where p.id = current_user_id())
  );

-- ----------------------------------------------------------------------------
-- 5. Policies -- workflows
-- ----------------------------------------------------------------------------
drop policy if exists "workflows tenant read" on public.workflows;
create policy "workflows tenant read" on public.workflows
  for select using (tenant_id = current_tenant_id());

drop policy if exists "workflows designer write" on public.workflows;
create policy "workflows designer write" on public.workflows
  for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
  );

drop policy if exists "workflows designer update" on public.workflows;
create policy "workflows designer update" on public.workflows
  for update
  using (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
  )
  with check (tenant_id = current_tenant_id());

drop policy if exists "workflows admin delete" on public.workflows;
create policy "workflows admin delete" on public.workflows
  for delete
  using (
    tenant_id = current_tenant_id()
    and current_role_claim() = 'tenant_admin'
    and is_current_user_active()
  );

-- ----------------------------------------------------------------------------
-- 6. Policies -- workflow_versions (immutable: no update/delete policy at all)
-- ----------------------------------------------------------------------------
drop policy if exists "versions tenant read" on public.workflow_versions;
create policy "versions tenant read" on public.workflow_versions
  for select using (
    workflow_id in (select id from public.workflows where tenant_id = current_tenant_id())
  );

drop policy if exists "versions designer insert" on public.workflow_versions;
create policy "versions designer insert" on public.workflow_versions
  for insert
  with check (
    current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
    and workflow_id in (select id from public.workflows where tenant_id = current_tenant_id())
  );

-- ----------------------------------------------------------------------------
-- 7. Policies -- deployments (design-time traceability table)
-- ----------------------------------------------------------------------------
drop policy if exists "deployments tenant read" on public.deployments;
create policy "deployments tenant read" on public.deployments
  for select using (tenant_id = current_tenant_id());

drop policy if exists "deployments designer insert" on public.deployments;
create policy "deployments designer insert" on public.deployments
  for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
  );

-- ----------------------------------------------------------------------------
-- 8. Policies -- form_schemas
-- ----------------------------------------------------------------------------
drop policy if exists "forms tenant read" on public.form_schemas;
create policy "forms tenant read" on public.form_schemas
  for select using (tenant_id = current_tenant_id());

drop policy if exists "forms designer write" on public.form_schemas;
create policy "forms designer write" on public.form_schemas
  for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
  );

drop policy if exists "forms designer update" on public.form_schemas;
create policy "forms designer update" on public.form_schemas
  for update
  using (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
  )
  with check (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 9. Policies -- approval_requests
-- ----------------------------------------------------------------------------
drop policy if exists "approval_requests tenant read" on public.approval_requests;
create policy "approval_requests tenant read" on public.approval_requests
  for select using (tenant_id = current_tenant_id());

drop policy if exists "approval_requests designer insert" on public.approval_requests;
create policy "approval_requests designer insert" on public.approval_requests
  for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
    and workflow_id in (select id from public.workflows where tenant_id = current_tenant_id())
  );

-- Segregation of duties: an approver can decide, but never their own
-- submission (requested_by is distinct from the deciding user).
drop policy if exists "approval_requests admin decide" on public.approval_requests;
create policy "approval_requests admin decide" on public.approval_requests
  for update
  using (
    tenant_id = current_tenant_id()
    and current_role_claim() = 'approver'
    and is_current_user_active()
    and requested_by is distinct from current_user_id()
  )
  with check (
    tenant_id = current_tenant_id()
    and requested_by is distinct from current_user_id()
  );

-- ----------------------------------------------------------------------------
-- 10. Policies -- audit_logs (read-only from the API; writes are trigger-only)
-- ----------------------------------------------------------------------------
drop policy if exists "audit_logs tenant_admin read" on public.audit_logs;
create policy "audit_logs tenant_admin read" on public.audit_logs
  for select using (
    tenant_id = current_tenant_id()
    and current_role_claim() = 'tenant_admin'
  );

-- ----------------------------------------------------------------------------
-- 11. Policies -- invites
-- ----------------------------------------------------------------------------
drop policy if exists "invites tenant_admin read" on public.invites;
create policy "invites tenant_admin read" on public.invites
  for select using (
    tenant_id = current_tenant_id()
    and current_role_claim() = 'tenant_admin'
  );

drop policy if exists "invites tenant_admin revoke" on public.invites;
create policy "invites tenant_admin revoke" on public.invites
  for update
  using (
    tenant_id = current_tenant_id()
    and current_role_claim() = 'tenant_admin'
    and status = 'invited'
    and is_current_user_active()
  )
  with check (
    tenant_id = current_tenant_id()
    and status = 'revoked'
  );

-- ----------------------------------------------------------------------------
-- 11b. Policies -- workflow_embeddings (Agentic Designer grounding)
-- ----------------------------------------------------------------------------
-- The agent reads and writes these through PostgREST *as the user*, so these
-- policies, not the agent, keep tenants apart. Verified on the live database
-- (September 27, 2026): a tenant sees only its own rows and search results.
alter table public.workflow_embeddings enable row level security;

drop policy if exists "embeddings tenant read" on public.workflow_embeddings;
create policy "embeddings tenant read" on public.workflow_embeddings
  for select using (tenant_id = current_tenant_id());

drop policy if exists "embeddings designer insert" on public.workflow_embeddings;
create policy "embeddings designer insert" on public.workflow_embeddings
  for insert
  with check (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
    and workflow_id in (select id from public.workflows where tenant_id = current_tenant_id())
  );

drop policy if exists "embeddings designer update" on public.workflow_embeddings;
create policy "embeddings designer update" on public.workflow_embeddings
  for update
  using (
    tenant_id = current_tenant_id()
    and current_role_claim() in ('designer', 'tenant_admin')
    and is_current_user_active()
  )
  with check (
    tenant_id = current_tenant_id()
    and workflow_id in (select id from public.workflows where tenant_id = current_tenant_id())
  );

-- No access without a login (Supabase grants new tables to anon by default).
revoke all on public.workflow_embeddings from anon;

-- Nearest workflows among the caller's tenant's non-archived current
-- versions. SECURITY INVOKER, so the policies above apply to the caller.
create or replace function public.match_workflow_embeddings(
  query_embedding  vector,
  match_spec       text,
  match_model      text,
  match_count      int default 3,
  exclude_workflow uuid default null
)
returns table (workflow_id uuid, workflow_version_id uuid, name text, summary text, similarity double precision)
language sql
stable
security invoker
as $$
  select e.workflow_id, e.workflow_version_id, w.name, e.summary,
         1 - (e.embedding <=> query_embedding) as similarity
  from public.workflow_embeddings e
  join public.workflows w on w.id = e.workflow_id and w.current_version_id = e.workflow_version_id
  where e.spec_type = match_spec
    and e.model = match_model
    and w.status <> 'archived'
    and (exclude_workflow is null or e.workflow_id <> exclude_workflow)
    and vector_dims(e.embedding) = vector_dims(query_embedding)
  order by e.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 10)
$$;

-- ----------------------------------------------------------------------------
-- 12. Audit-trail trigger functions
-- ----------------------------------------------------------------------------
create or replace function public.audit_approval_decision()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
    values (
      new.tenant_id,
      current_user_id(),
      'approval_decided',
      'approval_request',
      new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status, 'comment', new.comment)
    );
  end if;
  return new;
end;
$$;

create or replace function public.audit_profile_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
    values (
      new.tenant_id,
      current_user_id(),
      'profile_status_changed',
      'profile',
      new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create or replace function public.audit_workflow_archive()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.status = 'archived' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
    values (
      new.tenant_id,
      current_user_id(),
      'workflow_archived',
      'workflow',
      new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create or replace function public.audit_workflow_delete()
returns trigger
language plpgsql
as $$
begin
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
  values (
    old.tenant_id,
    current_user_id(),
    'workflow_deleted',
    'workflow',
    old.id,
    jsonb_build_object('name', old.name, 'status', old.status, 'definition_key', old.definition_key),
    null
  );
  return old;
end;
$$;

create or replace function public.sync_workflow_status_from_approval()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.workflows set status = 'pending_approval', updated_at = now()
    where id = new.workflow_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'approved' then
      update public.workflows set status = 'approved', updated_at = now()
      where id = new.workflow_id;
    elsif new.status = 'rejected' then
      update public.workflows set status = 'draft', updated_at = now()
      where id = new.workflow_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.reset_workflow_status_on_new_version()
returns trigger
language plpgsql
as $$
declare
  v_tenant_id uuid;
  v_previous_status text;
begin
  select tenant_id, status into v_tenant_id, v_previous_status
  from public.workflows
  where id = new.workflow_id;

  if v_previous_status = 'approved' then
    update public.workflows
    set status = 'draft', updated_at = now()
    where id = new.workflow_id;

    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before, after)
    values (
      v_tenant_id,
      current_user_id(),
      'workflow_status_reset_on_edit',
      'workflow',
      new.workflow_id,
      jsonb_build_object('status', 'approved'),
      jsonb_build_object('status', 'draft', 'version_id', new.id)
    );
  end if;

  return new;
end;
$$;

-- Keeps profiles.email in sync if the identity provider's email ever
-- changes after initial provisioning. On the live database this trigger
-- lives on auth.users (Supabase-managed); on a portable target, point it
-- at whatever your real identity table's email-change event is instead.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 13. Triggers
-- ----------------------------------------------------------------------------
drop trigger if exists approval_requests_audit_decision on public.approval_requests;
create trigger approval_requests_audit_decision
  after update on public.approval_requests
  for each row execute function public.audit_approval_decision();

drop trigger if exists approval_requests_sync_status on public.approval_requests;
create trigger approval_requests_sync_status
  after insert or update on public.approval_requests
  for each row execute function public.sync_workflow_status_from_approval();

drop trigger if exists profiles_audit_status on public.profiles;
create trigger profiles_audit_status
  after update on public.profiles
  for each row execute function public.audit_profile_status_change();

drop trigger if exists workflow_versions_reset_status_after_approval on public.workflow_versions;
create trigger workflow_versions_reset_status_after_approval
  after insert on public.workflow_versions
  for each row execute function public.reset_workflow_status_on_new_version();

drop trigger if exists workflows_audit_archive on public.workflows;
create trigger workflows_audit_archive
  after update on public.workflows
  for each row execute function public.audit_workflow_archive();

drop trigger if exists workflows_audit_delete on public.workflows;
create trigger workflows_audit_delete
  after delete on public.workflows
  for each row execute function public.audit_workflow_delete();

-- NOTE: sync_profile_email's trigger lives on the identity provider's own
-- users table on the live database (auth.users), not on anything created
-- by schema.sql. If your target's identity table is app_auth.users
-- (this script's stand-in), wire it up like this:
--
-- drop trigger if exists on_auth_user_email_change on app_auth.users;
-- create trigger on_auth_user_email_change
--   after update of email on app_auth.users
--   for each row execute function public.sync_profile_email();

commit;
