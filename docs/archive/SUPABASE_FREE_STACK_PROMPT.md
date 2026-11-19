# Implementation Prompt: Supabase-Free Auth + Data API on PostgreSQL 16

Paste this whole file into a new session (or hand it to whoever builds this)
to implement a fully custom, zero-Supabase-code replacement for the current
auth + REST stack, while keeping every existing frontend network call
working unchanged.

---

## Context

The Common Workflow Platform (CWP) currently runs against Supabase: GoTrue
(auth) issues JWTs, PostgREST (auto-generated REST API) serves
`/rest/v1/*` with row-level security enforcing tenant isolation, and two
Supabase Edge Functions (`admin-set-role`, `invite-user`) handle privileged
writes. Confirmed from a live network trace: `POST
.../auth/v1/token?grant_type=password`, `GET .../rest/v1/approval_requests`,
`GET .../rest/v1/workflows`, `GET .../rest/v1/profiles`.

Two portable artifacts already exist and should be used as-is, not
rewritten:

- `Database/schema.sql` -- every table, constraint, and index, already
  vendor-neutral.
- `Database/policies.sql` -- every RLS policy and the four auth-claim
  helper functions (`current_tenant_id()`, `current_role_claim()`,
  `current_user_id()`, `is_current_user_active()`), already reimplemented
  using the underlying PostgREST mechanism
  (`current_setting('request.jwt.claims', true)`) instead of Supabase's
  `auth.jwt()`/`auth.uid()` wrappers. Confirmed against PostgREST's own
  docs (docs.postgrest.org/en/latest/references/auth.html): PostgREST
  exposes validated JWT claims to Postgres via exactly that session
  variable, and RLS is genuinely how Supabase enforces authorization too
  -- this isn't a reinterpretation, it's the same mechanism Supabase's
  own PostgREST fork uses under the hood.

## Goal

Replace GoTrue + Supabase's PostgREST + Supabase Edge Functions with:

1. **Self-hosted, official PostgREST** (github.com/PostgREST/postgrest) in
   front of a plain PostgreSQL 16 instance -- not a Supabase fork, the
   upstream project.
2. **A custom-built auth microservice** (your language/framework choice --
   pick whatever the team already operates) implementing only the
   endpoints this app actually calls, matching the request/response shape
   the frontend already expects.
3. **A custom-built admin service** (can be the same process as #2)
   replacing `admin-set-role` and `invite-user`.

Zero Supabase-authored software anywhere in the resulting stack.

## PostgREST role model (read this before writing the auth service)

PostgREST's authorization model, per its own docs, is: an `authenticator`
Postgres role (used for the DB connection itself, `NOLOGIN`-incapable,
very limited privileges) impersonates a target role per-request via `SET
ROLE`, chosen from the JWT's top-level `role` claim. Supabase's own setup
does **not** mint one Postgres role per application user -- it mints
exactly two (`anon` for unauthenticated requests, `authenticated` for
everyone with a valid JWT) and does the real per-user, per-tenant
authorization entirely inside RLS policies, reading custom claims out of
`app_metadata`. Replicate that exact split:

```sql
create role authenticator noinherit login password '...';
create role anon nologin;
create role authenticated nologin;
grant anon to authenticator;
grant authenticated to authenticator;
-- grant authenticated the same table-level SELECT/INSERT/UPDATE/DELETE
-- privileges Supabase's authenticated role has -- RLS policies (already
-- in policies.sql) are the real gate, table grants are just the outer
-- permission RLS operates within.
```

**JWT contract -- this must match exactly, both claims are used differently:**

```json
{
  "role": "authenticated",
  "sub": "7c1e...user-uuid",
  "email": "designer@tenant-a.com",
  "app_metadata": {
    "tenant_id": "a2f4...tenant-uuid",
    "role": "designer"
  },
  "exp": 1234567890,
  "iat": 1234567890
}
```

- Top-level `role: "authenticated"` -- this is what PostgREST reads to
  pick the Postgres role to impersonate. It is **not** the user's
  application role.
- `app_metadata.role` -- the actual application role (`designer` /
  `tenant_admin` / `approver` / `viewer`), read by
  `current_role_claim()` inside RLS policies, never by PostgREST itself.
- `sub` -- the user id, read by `current_user_id()`.
- Sign with HS256 and a shared secret; configure the identical secret in
  the auth service (signing) and PostgREST's `PGRST_JWT_SECRET`
  (verification).

## Endpoints to build (auth/admin service)

Match these exactly -- the frontend's network calls (confirmed from a live
trace) don't need to change beyond the base URL if the shape matches:

| Endpoint | Replaces | Behavior |
|---|---|---|
| `POST /auth/v1/token?grant_type=password` | GoTrue password grant | Verify email+password (bcrypt/argon2id hash comparison against `app_auth.users`), return `{access_token, refresh_token, expires_in, token_type, user}` |
| `POST /auth/v1/token?grant_type=refresh_token` | GoTrue refresh | Rotate and return a new access/refresh token pair; invalidate the old refresh token |
| `POST /auth/v1/logout` | GoTrue logout | Invalidate the refresh token server-side |
| `POST /admin/invite-user` (internal, service-role only) | `invite-user` edge function | Create an `app_auth.users` row + `profiles` row (status pending until accepted), generate a signed invite token, send an email with a signup link. Requires picking a transactional email provider -- this is real, non-trivial scope GoTrue previously handled for free; budget time for it. |
| `POST /admin/set-role` (internal, service-role only) | `admin-set-role` edge function | Verify caller's JWT shows `app_metadata.role = tenant_admin`, update the target user's `app_metadata` claims (requires re-issuing that user's tokens or having them re-authenticate to pick up the change, same as today) |

## Data layer

1. Run `Database/schema.sql` then `Database/policies.sql` against the
   target Postgres 16 instance as-is.
2. Point the auth service at `app_auth.users` (already scaffolded in
   `schema.sql`) -- add whatever columns your auth service needs
   (`password_hash`, `refresh_token_hash`, `email_confirmed_at`,
   `invite_token`, `invite_expires_at`) via a small additive migration;
   don't modify the tables `schema.sql` already owns.
3. Wire `sync_profile_email()`'s trigger (currently commented out in
   `policies.sql`, since it lived on Supabase's `auth.users` on the live
   database) onto `app_auth.users` for real:
   ```sql
   create trigger on_auth_user_email_change
     after update of email on app_auth.users
     for each row execute function public.sync_profile_email();
   ```

## Frontend changes

`Designer/src/lib/supabaseClient.ts` (real file, still Supabase-branded
today) needs to become a thin client that:

- Calls the new auth service's `/auth/v1/token` endpoints directly (or a
  minimal wrapper around `fetch`, since there's no `@supabase/supabase-js`
  equivalent library for a hand-rolled backend -- don't reach for a
  third-party PostgREST client unless one's already trusted; raw `fetch`
  against PostgREST's REST conventions is a few dozen lines).
- Stores the access/refresh token pair (memory + secure storage, same
  session-persistence behavior as today).
- Sends `Authorization: Bearer <access_token>` on every PostgREST call,
  identical to today.
- Every `data/*.ts` file's actual query-building code (the `?select=...`
  query-string shape) does not need to change -- that's PostgREST's own
  REST conventions, which this new deployment speaks identically, since
  it's the same upstream project.

## Acceptance criteria

Reproduce this exact trace (from a real session against the current
Supabase-hosted instance) against the new stack, same shapes, same status
codes:

```
POST /auth/v1/token?grant_type=password                    -> 200
GET  /rest/v1/approval_requests?select=...&tenant_id=eq.<id>&status=eq.pending&order=requested_at.asc  -> 200
GET  /rest/v1/workflows?select=...&tenant_id=eq.<id>&order=updated_at.desc  -> 200
GET  /rest/v1/profiles?select=id,display_name,onboarding_dismissed_at&id=eq.<id>  -> 200
```

Plus, behaviorally (not just schema-deep) verify RLS actually filters: log
in as users in two different tenants and confirm each only ever sees their
own tenant's rows across all nine tables.

## Explicitly out of scope for this prompt

- The `runtime` schema and Flowable's `ACT_*` tables (Liquibase-managed by
  the Runtime Gateway itself -- see `Database/MIGRATION.md`).
- Data migration from the live Supabase project (see
  `Database/MIGRATION.md` Step 2 for the identity-remapping decision this
  work depends on).
- Password-reset email flow, MFA, and social login -- none of these are
  used by the current app; don't build them speculatively.
