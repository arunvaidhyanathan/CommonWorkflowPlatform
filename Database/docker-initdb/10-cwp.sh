#!/bin/sh
# docker compose runtime-db, first start only (empty volume): builds the CWP
# schema with the local seed users, then one login role per service
# (Database/roles.sql). /cwp-sql is the repo's Database/ folder, mounted
# read-only by docker-compose.yml.
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f /cwp-sql/schema.sql -f /cwp-sql/policies.sql -f /cwp-sql/local.sql
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v identity_password="$CWP_IDENTITY_DB_PASSWORD" \
  -v design_password="$CWP_DESIGN_DB_PASSWORD" \
  -v runtime_password="$CWP_RUNTIME_DB_PASSWORD" \
  -f /cwp-sql/roles.sql
