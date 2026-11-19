#!/usr/bin/env bash
# Runs every CWP service natively against a local PostgreSQL (no containers),
# with the Vite dev server on http://localhost:5173 proxying /api/* to them.
#
# One-time setup (database `cwp`, one schema and role per service, seed users):
#   createdb cwp
#   database/apply.sh --seed-local -- -d cwp
# Then: ./run-local.sh   (users admin / designer / approver, password "password")
# Logs go to ./.local-logs/; mail tasks land in .local-logs/mailbox.txt. Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")"

# identity-service (:8082) issues RS256 login tokens; every other service
# verifies them against its key set. Locally it makes a throwaway key per
# start (restarting it logs everyone out).
export CWP_JWT_ALLOW_EPHEMERAL_KEY="${CWP_JWT_ALLOW_EPHEMERAL_KEY:-true}"
export IDENTITY_SERVICE_URL="${IDENTITY_SERVICE_URL:-http://localhost:8082}"
export DESIGN_SERVICE_URL="${DESIGN_SERVICE_URL:-http://localhost:8083}"
export IDENTITY_JWKS_URL="${IDENTITY_JWKS_URL:-$IDENTITY_SERVICE_URL/.well-known/jwks.json}"
# Shared by the services that call each other's /internal API.
export CWP_INTERNAL_TOKEN="${CWP_INTERNAL_TOKEN:-local-dev-internal-token}"
export SPEND_INGEST_TOKEN="${SPEND_INGEST_TOKEN:-local-dev-ingest-token}"
# spend-tracker: schema spend in the same database, as role cwp_spend.
export SPEND_DATABASE_URL="${SPEND_DATABASE_URL:-postgresql://cwp_spend@localhost:5432/cwp?options=-csearch_path%3Dspend}"
export SPEND_TRACKER_URL="${SPEND_TRACKER_URL:-http://localhost:8095}"
# Local only: allow script tasks (they run inside the engine JVM) and send mail to the dev mailbox.
export CWP_SCRIPTS_ENABLED="${CWP_SCRIPTS_ENABLED:-true}"
export CWP_MAIL_PORT="${CWP_MAIL_PORT:-2525}"
# Keep every variable change, so instance timelines show them.
export CWP_HISTORY_LEVEL="${CWP_HISTORY_LEVEL:-full}"

mkdir -p .local-logs
pids=()
trap 'kill "${pids[@]}" 2>/dev/null' EXIT

python3 -I services/flowable-wrapper/e2e/smtp_sink.py "$CWP_MAIL_PORT" .local-logs/mailbox.txt > .local-logs/smtp.log 2>&1 & pids+=($!)
(cd services/identity-service && mvn -q spring-boot:run) > .local-logs/identity-service.log 2>&1 & pids+=($!)
(cd services/design-service && mvn -q spring-boot:run) > .local-logs/design-service.log 2>&1 & pids+=($!)
(cd services/flowable-wrapper && mvn -q spring-boot:run) > .local-logs/flowable-wrapper.log 2>&1 & pids+=($!)
(cd services/spend-tracker && uv run uvicorn spend_tracker.app:create_app --factory --port 8095) > .local-logs/spend-tracker.log 2>&1 & pids+=($!)
(cd services/agentic-designer && uv run uvicorn agentic_designer.app:create_app --factory --port 8091) > .local-logs/agentic-designer.log 2>&1 & pids+=($!)
(cd services/web-app && VITE_API_BASE_URL=/api npm run dev -- --port 5173 --strictPort) > .local-logs/web-app.log 2>&1 & pids+=($!)

echo "Starting... logs in .local-logs/. Open http://localhost:5173 once the services are up."
wait
