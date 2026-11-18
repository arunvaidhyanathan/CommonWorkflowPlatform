#!/usr/bin/env bash
# Runs CWP natively against a local Postgres (no Docker, no Supabase).
# One-time setup:
#   createdb cwp && createdb cwp_spend
#   psql -d cwp -f Database/schema.sql -f Database/policies.sql -f Database/local.sql
# Then: ./run-local.sh   -> http://localhost:5173  (users admin / designer / approver, password "password")
# Logs go to ./.local-logs/; mail tasks land in .local-logs/mailbox.txt. Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")"

# identity-service (:8082) issues RS256 login tokens; every other service
# verifies them against its key set. With no CWP_JWT_PRIVATE_KEY it makes a
# throwaway key, so restarting it logs everyone out.
export IDENTITY_SERVICE_URL="${IDENTITY_SERVICE_URL:-http://localhost:8082}"
export IDENTITY_JWKS_URL="${IDENTITY_JWKS_URL:-$IDENTITY_SERVICE_URL/.well-known/jwks.json}"
# The Python services still read their verification settings under the old name.
export SUPABASE_JWKS_URL="$IDENTITY_JWKS_URL"
# flowable-wrapper presents this to identity-service's /internal API.
export CWP_INTERNAL_TOKEN="${CWP_INTERNAL_TOKEN:-local-dev-internal-token}"
export SPEND_INGEST_TOKEN="${SPEND_INGEST_TOKEN:-local-dev-ingest-token}"
export SPEND_DATABASE_URL="${SPEND_DATABASE_URL:-postgresql://localhost:5432/cwp_spend}"
export SPEND_TRACKER_URL="${SPEND_TRACKER_URL:-http://localhost:8095}"
# Local only: allow script tasks (they run inside the runtime JVM) and send mail to the dev mailbox.
export CWP_SCRIPTS_ENABLED="${CWP_SCRIPTS_ENABLED:-true}"
export CWP_MAIL_PORT="${CWP_MAIL_PORT:-2525}"
# Keep every variable change, so instance timelines show them.
export CWP_HISTORY_LEVEL="${CWP_HISTORY_LEVEL:-full}"

mkdir -p .local-logs
pids=()
trap 'kill "${pids[@]}" 2>/dev/null' EXIT

python3 -I services/flowable-wrapper/e2e/smtp_sink.py "$CWP_MAIL_PORT" .local-logs/mailbox.txt > .local-logs/smtp.log 2>&1 & pids+=($!)
(cd services/identity-service && mvn -q spring-boot:run) > .local-logs/identity-service.log 2>&1 & pids+=($!)
(cd services/flowable-wrapper && mvn -q spring-boot:run) > .local-logs/flowable-wrapper.log 2>&1 & pids+=($!)
(cd services/spend-tracker && uv run uvicorn spend_tracker.app:create_app --factory --port 8095) > .local-logs/spend-tracker.log 2>&1 & pids+=($!)
(cd services/agentic-designer && uv run uvicorn agentic_designer.app:create_app --factory --port 8091) > .local-logs/agentic-designer.log 2>&1 & pids+=($!)
(cd Designer && VITE_API_BASE_URL=/api npm run dev -- --port 5173 --strictPort) > .local-logs/designer.log 2>&1 & pids+=($!)

echo "Starting... logs in .local-logs/. Open http://localhost:5173 once flowable-wrapper is up."
wait
