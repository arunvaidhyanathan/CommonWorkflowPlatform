#!/usr/bin/env bash
# Proves the per-service database roles: each role can use its own schema
# and gets "permission denied" on every other service's. Pass psql
# connection arguments for the CWP database, e.g.
#   bash database/check_roles.sh -d cwp
#   oc exec -i <postgres-pod> -- bash -s -- -d cwp < database/check_roles.sh
# Exits non-zero if any check fails. Needs the tables from 02/03 to exist.
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

identity_tables=(identity.users identity.tenants identity.profiles identity.group_members identity.invites)
design_tables=(design.workflows design.workflow_versions design.approval_requests design.audit_logs)

for t in "${identity_tables[@]}"; do expect cwp_identity ok "select count(*) from $t"; done
for t in "${design_tables[@]}"; do expect cwp_identity denied "select count(*) from $t"; done
expect cwp_identity denied "create table runtime.cwp_role_probe (id int)"
expect cwp_identity denied "create table spend.cwp_role_probe (id int)"

for t in "${design_tables[@]}"; do expect cwp_design ok "select count(*) from $t"; done
for t in "${identity_tables[@]}"; do expect cwp_design denied "select count(*) from $t"; done
expect cwp_design denied "create table runtime.cwp_role_probe (id int)"

expect cwp_runtime ok "create table runtime.cwp_role_probe (id int)"
for t in identity.users identity.profiles design.workflows design.audit_logs; do expect cwp_runtime denied "select count(*) from $t"; done
expect cwp_runtime denied "create table spend.cwp_role_probe (id int)"

expect cwp_spend ok "create table spend.cwp_role_probe (id int)"
for t in identity.users design.workflows; do expect cwp_spend denied "select count(*) from $t"; done
expect cwp_spend denied "create table runtime.cwp_role_probe (id int)"

for r in cwp_identity cwp_design cwp_runtime cwp_spend; do expect "$r" denied "create table public.cwp_role_probe (id int)"; done

echo "---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
