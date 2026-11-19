-- ============================================================================
-- Bootstrap a tenant and its first tenant admin (any environment).
-- ============================================================================
-- After this, the admin signs in and creates every other user from the
-- Administration page. Run once per tenant, after 02-identity.sql:
--
--   psql -d cwp -v tenant_name='Acme Bank' -v tenant_slug=acme \
--        -v admin_username=acme-admin -v admin_password='<from a Secret>' \
--        -f 91-bootstrap-tenant.sql
--
-- Pass the password from a Secret or a prompt, never on a shared command
-- line or in shell history. Fails (and changes nothing) if the slug or the
-- username already exists.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

with tenant as (
  insert into identity.tenants (name, slug) values (:'tenant_name', :'tenant_slug') returning id
), account as (
  insert into identity.users (username, email, password_hash)
  values (:'admin_username', :'admin_username', crypt(:'admin_password', gen_salt('bf', 10)))
  returning id
)
insert into identity.profiles (id, tenant_id, role, display_name, email)
select account.id, tenant.id, 'tenant_admin', :'admin_username', :'admin_username' from account, tenant;

commit;
