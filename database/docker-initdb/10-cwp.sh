#!/bin/bash
# docker compose `postgres`, first start only (empty volume): roles, schemas,
# identity and design tables, and the local seed users. /cwp-sql is the
# repo's database/ folder, mounted read-only by docker-compose.yml.
set -euo pipefail
CWP_IDENTITY_DB_PASSWORD="$CWP_IDENTITY_DB_PASSWORD" CWP_DESIGN_DB_PASSWORD="$CWP_DESIGN_DB_PASSWORD" \
CWP_RUNTIME_DB_PASSWORD="$CWP_RUNTIME_DB_PASSWORD" CWP_SPEND_DB_PASSWORD="$CWP_SPEND_DB_PASSWORD" \
  bash /cwp-sql/apply.sh --seed-local -- -U "$POSTGRES_USER" -d "$POSTGRES_DB"
