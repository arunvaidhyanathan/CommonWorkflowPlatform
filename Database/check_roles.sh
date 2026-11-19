#!/usr/bin/env bash
# Proves the per-service database roles (Database/roles.sql): each role can
# use its own tables and gets "permission denied" on every other service's.
# Pass psql connection arguments for the CWP database, e.g.
#   bash Database/check_roles.sh -d cwp
#   docker compose exec -T runtime-db bash -s -- -d cwp_runtime < Database/check_roles.sh
# Exits non-zero if any check fails.
set -u
conn=("$@")
pass=0; fail=0

# expect <role> <ok|denied> <sql>
expect() {
  local role=$1 want=$2 sql=$3 out got
  out=$(psql "${conn[@]}" -U "$role" -X -q -At -v ON_ERROR_STOP=1 -c "begin; $sql; rollback;" 2>&1)
  if [ $? -eq 0 ]; then got=ok
  elif grep -q 'permission denied' <<<"$out"; then got=denied
  else got="error: $(head -1 <<<"$out")"
  fi
  if [ "$got" == "$want" ]; then echo "PASS $role $want: $sql"; pass=$((pass+1))
  else echo "FAIL $role expected $want, got $got: $sql"; fail=$((fail+1)); fi
}

for t in app_auth.users public.tenants public.profiles public.group_members public.invites; do
  expect cwp_identity ok "select count(*) from $t"
done
for t in public.workflows public.workflow_versions public.approval_requests public.audit_logs; do
  expect cwp_identity denied "select count(*) from $t"
done
expect cwp_identity denied "insert into public.audit_logs (tenant_id, action, entity_type) values (null, 'x', 'x')"
expect cwp_identity denied "create table runtime.cwp_role_probe (id int)"

for t in public.workflows public.workflow_versions public.approval_requests public.audit_logs; do
  expect cwp_design ok "select count(*) from $t"
done
for t in app_auth.users public.tenants public.profiles public.group_members public.invites; do
  expect cwp_design denied "select count(*) from $t"
done
expect cwp_design denied "update public.profiles set role = role"
expect cwp_design denied "create table runtime.cwp_role_probe (id int)"

expect cwp_runtime ok "create table runtime.cwp_role_probe (id int)"
for t in app_auth.users public.profiles public.group_members public.workflows public.audit_logs; do
  expect cwp_runtime denied "select count(*) from $t"
done

echo "---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
