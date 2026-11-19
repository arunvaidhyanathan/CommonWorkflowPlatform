#!/usr/bin/env bash
# Applies the CWP database scripts in order. Every script is safe to re-run.
#
#   database/apply.sh [--seed-local] -- <psql connection args>
#
# Examples:
#   database/apply.sh --seed-local -- -d cwp                          # local dev
#   database/apply.sh -- -h postgres.cwp.svc -U postgres -d cwp       # OpenShift (PGPASSWORD from a Secret)
#
# Role passwords: set CWP_IDENTITY_DB_PASSWORD, CWP_DESIGN_DB_PASSWORD,
# CWP_RUNTIME_DB_PASSWORD, CWP_SPEND_DB_PASSWORD in the environment (from a
# Secret) to set them; unset means "leave as is".
set -euo pipefail
cd "$(dirname "$0")"

seed=false
while [ $# -gt 0 ]; do
  case "$1" in
    --seed-local) seed=true; shift ;;
    --) shift; break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

pw_args=()
[ -n "${CWP_IDENTITY_DB_PASSWORD:-}" ] && pw_args+=(-v "identity_password=$CWP_IDENTITY_DB_PASSWORD")
[ -n "${CWP_DESIGN_DB_PASSWORD:-}" ] && pw_args+=(-v "design_password=$CWP_DESIGN_DB_PASSWORD")
[ -n "${CWP_RUNTIME_DB_PASSWORD:-}" ] && pw_args+=(-v "runtime_password=$CWP_RUNTIME_DB_PASSWORD")
[ -n "${CWP_SPEND_DB_PASSWORD:-}" ] && pw_args+=(-v "spend_password=$CWP_SPEND_DB_PASSWORD")

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
run() { echo "-> $1"; shift; psql -X -q -v ON_ERROR_STOP=1 "$@"; }

run 00-roles.sql "${pw_args[@]+"${pw_args[@]}"}" "$@" -f 00-roles.sql
for f in 01-schemas.sql 02-identity.sql 03-design.sql; do
  run "$f" "$@" -f "$f"
done
if $seed; then
  run 90-seed-local.sql "$@" -f 90-seed-local.sql
fi
echo "Database ready. Next: start the services (runtime and spend tables are created by flowable-wrapper and spend-tracker on first start)."
