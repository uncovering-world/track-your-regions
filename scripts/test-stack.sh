#!/usr/bin/env bash
# Test environment runner.
# Provides shared stack lifecycle commands and internal test execution commands
# used by scripts/test-report.mjs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

PROJECT="${TEST_COMPOSE_PROJECT:-tyr-test}"
STACK_NAME="${TEST_STACK_NAME:-$PROJECT}"
DB_NAME="${TEST_DB_NAME:-track_regions_test}"
DB_PORT="${TEST_DB_PORT:-55432}"
BACKEND_PORT="${TEST_BACKEND_PORT:-5301}"
FRONTEND_PORT="${TEST_FRONTEND_PORT:-5174}"
MARTIN_PORT="${TEST_MARTIN_PORT:-5300}"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.test.yml)
GOLDEN_DB_FILE="$PROJECT_ROOT/.golden-db"

# Hard safety rail: never allow test commands to operate on the dev stack.
if [ "$PROJECT" = "track-your-regions" ] || [ "$STACK_NAME" = "tyr-ng" ]; then
  echo "Refusing to run: test environment must not target dev stack." >&2
  echo "Current values: TEST_COMPOSE_PROJECT='$PROJECT', TEST_STACK_NAME='$STACK_NAME'" >&2
  exit 1
fi

# Hard safety rail: never allow test commands to target the golden database.
if [ -f "$GOLDEN_DB_FILE" ]; then
  GOLDEN_DB="$(cat "$GOLDEN_DB_FILE")"
  if [ -n "$GOLDEN_DB" ] && [ "$DB_NAME" = "$GOLDEN_DB" ]; then
    echo "Refusing to run: test environment DB matches golden DB '$GOLDEN_DB'." >&2
    echo "Set TEST_DB_NAME to a non-golden database (default is track_regions_test)." >&2
    exit 1
  fi
fi

compose() {
  STACK_NAME="$STACK_NAME" \
  DB_NAME="$DB_NAME" \
  DB_PORT="$DB_PORT" \
  BACKEND_PORT="$BACKEND_PORT" \
  FRONTEND_PORT="$FRONTEND_PORT" \
  MARTIN_PORT="$MARTIN_PORT" \
  FRONTEND_URL="$FRONTEND_URL" \
    docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"
}

compose_test_profile() {
  COMPOSE_PROFILES=test \
  STACK_NAME="$STACK_NAME" \
  DB_NAME="$DB_NAME" \
  DB_PORT="$DB_PORT" \
  BACKEND_PORT="$BACKEND_PORT" \
  FRONTEND_PORT="$FRONTEND_PORT" \
  MARTIN_PORT="$MARTIN_PORT" \
  FRONTEND_URL="$FRONTEND_URL" \
    docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempts="${3:-90}"
  local i

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready: $url"
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for $name at $url"
  return 1
}

ensure_up() {
  if [ "${TEST_STACK_SKIP_UP:-0}" = "1" ]; then
    return 0
  fi

  echo "Starting test environment project='$PROJECT' stack='$STACK_NAME' db='$DB_NAME'"
  compose up -d --build db backend frontend martin
  wait_for_url "Backend" "http://localhost:${BACKEND_PORT}/health"
  wait_for_url "Frontend" "http://localhost:${FRONTEND_PORT}"
}

ensure_e2e_runner() {
  ensure_up
  compose_test_profile up -d --build e2e
}

require_output_path() {
  if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
    echo "Missing output JSON path argument" >&2
    exit 1
  fi
}

run_backend_vitest() {
  local out_path="$1"
  local coverage_flag="${2:-}"
  local report_path="/tmp/backend-vitest-report.json"

  ensure_up
  compose exec -T backend sh -lc "npx vitest run --reporter=default --reporter=json --outputFile='${report_path}' ${coverage_flag}"
  compose exec -T backend sh -lc "cat '${report_path}'" > "$out_path"
}

run_frontend_vitest() {
  local out_path="$1"
  local coverage_flag="${2:-}"
  local report_path="/tmp/frontend-vitest-report.json"

  ensure_up
  compose exec -T frontend sh -lc "npx vitest run --reporter=default --reporter=json --outputFile='${report_path}' ${coverage_flag}"
  compose exec -T frontend sh -lc "cat '${report_path}'" > "$out_path"
}

run_e2e_playwright() {
  local project_name="$1"
  local out_path="$2"
  local report_path="/tmp/playwright-${project_name}-report.json"

  ensure_e2e_runner
  compose_test_profile exec -T e2e sh -lc "E2E_BASE_URL='http://frontend:5173' PLAYWRIGHT_JSON_OUTPUT_FILE='${report_path}' npx playwright test --project='${project_name}' --reporter=list,json --config=playwright.config.ts"
  compose_test_profile exec -T e2e sh -lc "cat '${report_path}'" > "$out_path"
}

cmd_up() {
  ensure_up
  cmd_status
}

cmd_down() {
  echo "Stopping test environment project='$PROJECT'"
  compose_test_profile down -v --remove-orphans
}

cmd_status() {
  echo "Test environment config:"
  echo "  project=$PROJECT"
  echo "  stack_name=$STACK_NAME"
  echo "  db_name=$DB_NAME"
  echo "  ports: frontend=$FRONTEND_PORT backend=$BACKEND_PORT martin=$MARTIN_PORT db=$DB_PORT"
  compose ps
}

cmd_smoke() {
  npm run test:e2e:smoke
}

cmd_full() {
  npm run test:fast
  npm run test:e2e:full
}

cmd_help() {
  cat <<EOF
Usage: scripts/test-stack.sh <command>

Commands:
  up                      Start test environment and wait for readiness
  down                    Stop test environment and remove its volumes
  status                  Show environment config and container status
  smoke                   Run smoke tests
  full                    Run fast tests + full E2E suite
  run-backend-unit        Internal: run backend unit/integration tests
  run-backend-coverage    Internal: run backend unit/integration tests with coverage
  run-frontend-unit       Internal: run frontend unit/integration tests
  run-frontend-coverage   Internal: run frontend unit/integration tests with coverage
  run-e2e-smoke           Internal: run smoke E2E tests
  run-e2e-full            Internal: run full E2E tests
  help                    Show this help

Environment overrides:
  TEST_COMPOSE_PROJECT (default: tyr-test)
  TEST_STACK_NAME      (default: value of TEST_COMPOSE_PROJECT)
  TEST_DB_NAME         (default: track_regions_test)
  TEST_DB_PORT         (default: 55432)
  TEST_BACKEND_PORT    (default: 5301)
  TEST_FRONTEND_PORT   (default: 5174)
  TEST_MARTIN_PORT     (default: 5300)
EOF
}

case "${1:-help}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  smoke) cmd_smoke ;;
  full) cmd_full ;;
  run-backend-unit)
    require_output_path "${2:-}"
    run_backend_vitest "$2"
    ;;
  run-backend-coverage)
    require_output_path "${2:-}"
    run_backend_vitest "$2" "--coverage"
    ;;
  run-frontend-unit)
    require_output_path "${2:-}"
    run_frontend_vitest "$2"
    ;;
  run-frontend-coverage)
    require_output_path "${2:-}"
    run_frontend_vitest "$2" "--coverage"
    ;;
  run-e2e-smoke)
    require_output_path "${2:-}"
    run_e2e_playwright "smoke" "$2"
    ;;
  run-e2e-full)
    require_output_path "${2:-}"
    run_e2e_playwright "full" "$2"
    ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "Unknown command: $1" >&2
    cmd_help
    exit 1
    ;;
esac
