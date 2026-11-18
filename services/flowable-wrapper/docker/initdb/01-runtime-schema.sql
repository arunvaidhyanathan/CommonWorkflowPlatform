-- Local runtime-db only (docker-compose.yml). Liquibase's tracking tables
-- live in `runtime` (liquibase-schema in application.yml), so the schema must
-- exist before the first changeset runs. Changeset 001 uses
-- `create schema if not exists`, so this doesn't conflict with it.
create schema if not exists runtime authorization current_user;
