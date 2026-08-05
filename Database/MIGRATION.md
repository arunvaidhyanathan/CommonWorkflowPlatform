# Schema Export &amp; Migration Plan

Companion to `Database/schema.sql` and `Database/policies.sql`. Read
`Documents/DataArchitecture.html` first for the full data catalog and
process-flow context -- this file is the "how to actually move it"
checklist.

## Scope

This plan covers the **design-time schema** (the `public` schema: `tenants`,
`profiles`, `workflows`, `workflow_versions`, `deployments`, `form_schemas`,
`approval_requests`, `audit_logs`, `invites`) -- the tables in the pasted
schema-visualizer export this plan was built from.

It does **not** cover:

- **The `runtime` schema** (Runtime Gateway's own `runtime.deployments`
  table). That schema is Liquibase-managed by the Java service itself
  (`WaaS/Workflow-Wrapper/src/main/resources/db/changelog/`) -- provision it
  by running that service's migrations against the new database
  (`flowable.database-schema-update=true` also lets Flowable create its own
  `ACT_*` tables on first boot), not by hand-copying SQL. Hand-authoring it
  here would create a second, driftable source of truth.
- **Flowable's own `ACT_*` engine tables.** Same reasoning -- Flowable
  creates and versions these itself.
- **Identity/auth data** (see "The Hard Part" below).

## Prerequisites

- `psql` and `pg_dump` (same major version as, or newer than, the source
  and target Postgres) -- official Postgres client tools, not a
  third-party tool.
- A connection string for the source database (the live project) and the
  target database (wherever you're moving to).
- Confirm the target is Postgres 14+ (this schema uses nothing newer, but
  hasn't been tested below 14).

## Step 1 -- Provision the target schema

```bash
psql "$TARGET_DATABASE_URL" -f Database/schema.sql
psql "$TARGET_DATABASE_URL" -f Database/policies.sql
```

This creates every design-time table, index, constraint, RLS policy,
helper function, and audit trigger -- but zero rows of data.

## Step 2 -- The hard part: identity

`profiles.id` is a foreign key to whatever issues your users their JWTs.
On the live database that's Supabase Auth's `auth.users(id)` -- a schema
Supabase owns and manages, not exported by a plain `pg_dump` of `public`
(and not something you'd want to hand-copy even if you could, since it
holds password hashes and Supabase-internal auth state).

Three realistic paths, in order of how much they disturb existing users:

1. **Keep Supabase Auth as the identity provider, move only the `public`
   schema.** The new database's Postgres role validates JWTs against the
   same Supabase Auth JWKS endpoint it always has; `profiles.id` values
   stay valid because the user IDs they reference don't change. This is
   the least disruptive option if the goal is "move the data, not the
   login system."
2. **Migrate to a new identity provider and remap user IDs.** Export
   `auth.users` (email, and whatever your new provider needs) via the
   Supabase dashboard or Admin API (not a raw table dump -- Supabase
   doesn't expose the `auth` schema over the same `pg_dump`-able
   connection your other tables use), create equivalent accounts in the
   new provider, then build an `old_user_id -> new_user_id` mapping table
   and `UPDATE` every FK column that points at a user id (`profiles.id`,
   `profiles.created_by`/`locked_by` indirectly via `profiles`,
   `workflows.created_by`, `workflows.locked_by`,
   `workflow_versions.created_by`, `deployments.deployed_by`,
   `approval_requests.requested_by`/`approver_id`, `audit_logs.actor_id`,
   `invites.invited_by`) using that mapping before loading each table.
3. **Stand up `app_auth.users`** (the placeholder table `schema.sql`
   creates) as a real, minimal auth table of your own, with your own
   JWT-issuing service in front of it. Same remapping requirement as
   option 2, since these are new UUIDs.

**Decide this before Step 3** -- the FK constraints in `schema.sql` will
reject any row whose `id`/`*_by`/`actor_id` doesn't exist in whichever
users table you land on.

## Step 3 -- Export data from the source

Dump `public` schema data only (structure was already created in Step 1,
so `--data-only` avoids fighting the RLS-policy-owning roles Supabase
sets up on `CREATE TABLE`):

```bash
pg_dump "$SOURCE_DATABASE_URL" \
  --schema=public \
  --data-only \
  --no-owner \
  --disable-triggers \
  --table=public.tenants \
  --table=public.profiles \
  --table=public.workflows \
  --table=public.workflow_versions \
  --table=public.deployments \
  --table=public.form_schemas \
  --table=public.approval_requests \
  --table=public.audit_logs \
  --table=public.invites \
  -f cwp_data.sql
```

`--disable-triggers` matters here: without it, restoring `approval_requests`
rows would re-fire `sync_workflow_status_from_approval` and re-derive
`workflows.status` from scratch, and restoring `workflow_versions` would
re-fire the stale-status-reset trigger -- both are meant to react to new
application activity, not replay history during a data load.

If you're on migration path 2 or 3 above, edit `cwp_data.sql` (or better,
write a small script) to apply the user-id remapping to every `INSERT`
before proceeding -- doing this as a text transform on the dump file is
usually easier than remapping post-load with `UPDATE`s across nine
tables.

## Step 4 -- Load into the target, in FK-safe order

`pg_dump`'s `INSERT`s are already ordered correctly if you dumped all
tables in one command (it topologically sorts by dependency), but if you
split the dump per table, load in this order -- it matches the FK
dependency chain in `schema.sql`:

```
tenants -> profiles -> workflows -> workflow_versions
        -> deployments -> form_schemas -> approval_requests
        -> audit_logs -> invites
```

```bash
psql "$TARGET_DATABASE_URL" -f cwp_data.sql
```

## Step 5 -- Re-enable triggers and verify

```sql
-- If you used --disable-triggers, confirm triggers are back on
-- (pg_dump's --disable-triggers only disables them for the duration of
-- the restore transaction, so this is usually a no-op check, not a fix):
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.workflows'::regclass;
```

Then, functionally verify rather than just row-counting:

- [ ] `select count(*) from public.workflows` matches the source.
- [ ] Every `workflows.current_version_id` resolves to a real
      `workflow_versions.id` (the circular FK from `schema.sql` Section 5
      would have rejected orphans on load, but confirm nothing was
      silently skipped by a partial dump).
- [ ] Pick one tenant, log in as a `designer` and as a `tenant_admin`, and
      confirm RLS actually scopes what each sees -- a schema-only test
      (does the policy exist?) is not the same as a behavioral test (does
      it actually filter?).
- [ ] Trigger a real approval decision end-to-end and confirm a new
      `audit_logs` row appears -- proves the trigger reattachment worked,
      not just that the function exists.

## Known gap surfaced while building this plan

A live security-advisor check found **`runtime.deployments` has Row-Level
Security disabled** on the current database -- it's fully readable/writable
by any authenticated (and possibly anon) API caller, unlike every `public`
schema table. This wasn't introduced by this migration work; it's a
pre-existing gap in the Runtime Gateway's own schema. Recommended fix,
**not applied automatically**:

```sql
alter table runtime.deployments enable row level security;
-- then add a tenant-scoped policy before anyone relies on this table
-- being protected -- enabling RLS with zero policies blocks ALL access,
-- including the Runtime Gateway's own reads, unless it connects as a
-- role that bypasses RLS (verify which role Workflow-Wrapper's
-- datasource actually authenticates as before flipping this switch).
```

See `Documents/DataArchitecture.html` Section 7 for the full writeup.
