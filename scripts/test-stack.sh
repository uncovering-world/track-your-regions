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
DATA_DIR="${TEST_DATA_DIR:-./.test-data}"
# Playwright's browser runs inside the `e2e` container (see
# run_e2e_playwright below), on the compose network, not on the host - so
# every URL the *browser itself* resolves must use Docker DNS service names
# and in-container ports, fixed regardless of TEST_BACKEND_PORT/
# TEST_FRONTEND_PORT/TEST_MARTIN_PORT (which only affect the host-side
# mapping), rather than the host-facing "localhost:<port>" URLs the dev
# stack bakes in for a browser running on the developer's own machine:
#  - FRONTEND_API_URL_OVERRIDE / FRONTEND_MARTIN_URL_OVERRIDE: baked into
#    the frontend bundle as VITE_API_URL/VITE_MARTIN_URL (see
#    docker-compose.yml), used by the browser to call the backend/martin
#    directly. Named *_OVERRIDE rather than reused as VITE_API_URL/
#    VITE_MARTIN_URL directly: .env.example shipped fixed values under
#    those exact names until this change, and scripts/setup.sh copied them
#    into every developer's .env, where they remain. Compose treats a value
#    from .env as "set" - so a "${VITE_API_URL:-
#    default}" fallback in the compose file would never reach its default
#    for any dev-stack .env that came from setup.sh, regardless of what
#    this script exports.
#  - FRONTEND_URL: read by the backend for its CORS/CSRF origin check
#    (backend/src/index.ts) and for building user-facing links (email
#    verification, OAuth redirects). It must equal the *frontend's* origin
#    as the browser sees it - "http://frontend:5173" here - or the backend
#    rejects every cross-origin request with a CORS/Origin mismatch. curl
#    doesn't enforce CORS, so this class of bug is invisible to curl-based
#    smoke-checks and only shows up in an actual browser. (This one isn't
#    nested behind a nested default in the compose file, so unlike the two
#    above it doesn't strictly need the *_OVERRIDE treatment - a plain
#    shell-exported FRONTEND_URL already wins over .env - but the value
#    itself still has to change for the test stack.)
FRONTEND_URL="http://frontend:5173"
FRONTEND_API_URL_OVERRIDE="http://backend:3001"
FRONTEND_MARTIN_URL_OVERRIDE="http://martin:3000"
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

# Hard safety rail: never allow test commands to bind-mount the dev
# stack's data directory (docker-compose.yml's `${DATA_DIR:-./data}`).
# realpath -m needs no existing target, so `./data`, `data`, and an
# absolute path all resolve the same way.
RESOLVED_DATA_DIR="$(realpath -m "$DATA_DIR")"
if [ "$RESOLVED_DATA_DIR" = "$(realpath -m "$PROJECT_ROOT/data")" ]; then
  echo "Refusing to run: test environment data dir must not be the dev stack's data dir." >&2
  echo "Current value: TEST_DATA_DIR resolves to '$RESOLVED_DATA_DIR'; set it to something else." >&2
  exit 1
fi

# Pre-create DATA_DIR unconditionally, before any code path can bring up a
# container that bind-mounts it - not just the common ensure_up path: with
# TEST_STACK_SKIP_UP=1, ensure_e2e_runner reaches compose_test_profile
# without ever running ensure_up's body. Left to the bind mount, an absent
# host path gets auto-created owned by root, and the backend/cv-python
# containers run as a fixed uid baked into their images (1000 for
# backend's `node` user, node:22-alpine's default) with no reason to match
# whichever uid runs this script. This is throwaway test data, so make it
# world-writable rather than try to match uids: GitHub-hosted runners use
# uid 1001, so a fix that merely matched this developer's uid (1000) would
# pass here and still fail in CI.
#
# chmod only the two paths mkdir just touched - deliberately not -R.
# test-report.mjs re-execs this whole script per test step plus once more
# for `down`, so this block runs repeatedly against a tree the backend
# container is actively writing into (data/images/experiences, data/cache,
# data/cv-debug, ...). Those entries end up owned by the container's uid,
# not this script's; a recursive chmod would try to change permissions on
# them too and die with "Operation not permitted" on the first one it
# doesn't own - including on the `down` invocation that's supposed to
# tear the stack back down. It doesn't need to: once DATA_DIR/images
# themselves are world-writable, the container can freely create its own
# subdirectories inside them, and it will always own whatever it creates,
# so it can always write there again later. Nothing under this script's
# control ever needs its permissions changed twice.
mkdir -p "$DATA_DIR/images"
chmod a+rwX "$DATA_DIR" "$DATA_DIR/images"

# Same reasoning, for the `e2e` service's playwright-report/test-results
# bind mounts (added in docker-compose.test.yml so Playwright's HTML
# report, screenshots, videos and traces survive the container being torn
# down - see run_e2e_playwright). frontend/Dockerfile.e2e's base image
# (mcr.microsoft.com/playwright) runs as root with no USER override, so an
# absent host path would be auto-created root-owned; pre-creating and
# opening it up avoids relying on root's umask happening to leave it
# readable.
mkdir -p frontend/playwright-report frontend/test-results frontend/lighthouse-report
chmod a+rwX frontend/playwright-report frontend/test-results frontend/lighthouse-report

compose() {
  STACK_NAME="$STACK_NAME" \
  DB_NAME="$DB_NAME" \
  DB_PORT="$DB_PORT" \
  BACKEND_PORT="$BACKEND_PORT" \
  FRONTEND_PORT="$FRONTEND_PORT" \
  MARTIN_PORT="$MARTIN_PORT" \
  FRONTEND_URL="$FRONTEND_URL" \
  FRONTEND_API_URL_OVERRIDE="$FRONTEND_API_URL_OVERRIDE" \
  FRONTEND_MARTIN_URL_OVERRIDE="$FRONTEND_MARTIN_URL_OVERRIDE" \
  DATA_DIR="$DATA_DIR" \
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
  FRONTEND_API_URL_OVERRIDE="$FRONTEND_API_URL_OVERRIDE" \
  FRONTEND_MARTIN_URL_OVERRIDE="$FRONTEND_MARTIN_URL_OVERRIDE" \
  DATA_DIR="$DATA_DIR" \
    docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"
}

# 90 attempts x 2s = 180s per service. Measured against a stack whose images
# are already built - what both the pre-push gate and CI's e2e job face, since
# `compose up --build` builds before the wait starts - readiness costs seconds:
# db healthy at 36s from cold, backend and frontend answering ~20s after their
# containers start. The window is not the constraint and is left where it is;
# what a timeout here lacked was any account of what went wrong (#447).
# Overridable so the failure path can be exercised in seconds instead of three
# minutes, and so a box slower than either of the two above has a lever.
READINESS_ATTEMPTS="${TEST_READINESS_ATTEMPTS:-90}"
READINESS_LOG_LINES=200

# The one value here that comes from outside, and it is spent in an arithmetic
# context (`for ((i = 1; i <= attempts; i++))`), where bash re-evaluates a
# name it finds - so a value that is not a number is a way to be evaluated,
# not merely a wrong count. Refused up front, in the same shape as the rails
# above.
#
# A leading zero is refused with the rest, because bash reads one as octal:
# `08` is "value too great for base 8" and kills the run mid-wait with that
# as its only explanation, and `00` is zero, which polls nothing and reports
# a timeout the service never had. Measured, both.
case "$READINESS_ATTEMPTS" in
  *[!0-9]*|0*)
    echo "Refusing to run: TEST_READINESS_ATTEMPTS must be a positive integer without a leading zero." >&2
    echo "Current value: '$READINESS_ATTEMPTS'" >&2
    exit 1
    ;;
esac

# What a readiness timeout has to leave behind. Waiting used to print one line
# and return 1; under `set -e` the run ended there, before a single spec, so
# CI's "Upload Playwright report" step found no files and the job log said only
# that the frontend had not answered - never whether the container was slow,
# crashed, or never bound the port. Printed rather than left to be fetched,
# for two reasons: on CI nobody can fetch it, the runner being discarded with
# the containers on it; and printing puts the state *at the moment of the
# timeout* in the record, rather than whatever the container drifted to
# afterwards. A local run does keep the stack - scripts/test-report.mjs exits
# on this path before its cleanup step - so `compose logs` there still has
# more than the 200 lines below.
#
# One function rather than a poll and a dump that a caller could pair up
# wrongly: waiting for a service and saying what happened when it never came
# are the same act.
wait_for_service() {
  local name="$1"
  local url="$2"
  local service="$3"
  local i

  for ((i = 1; i <= READINESS_ATTEMPTS; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready: $url"
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for $name at $url"
  echo "--- $service never answered; container state (docker compose ps) ---"
  # Best-effort throughout: this runs on the failure path, and a diagnostic
  # that dies takes the diagnosis with it. The non-zero return below is what
  # fails the run, not these.
  compose ps || true
  echo "--- last $READINESS_LOG_LINES log lines: $service ---"
  compose logs --no-color --tail "$READINESS_LOG_LINES" "$service" || true
  echo "--- end $service evidence ---"
  return 1
}

ensure_up() {
  if [ "${TEST_STACK_SKIP_UP:-0}" = "1" ]; then
    return 0
  fi

  echo "Starting test environment project='$PROJECT' stack='$STACK_NAME' db='$DB_NAME'"
  compose up -d --build db backend frontend martin
  wait_for_service "Backend" "http://localhost:${BACKEND_PORT}/health" backend
  wait_for_service "Frontend" "http://localhost:${FRONTEND_PORT}" frontend

  echo "Seeding E2E fixture into db='$DB_NAME'"
  compose exec -T backend npm run seed:e2e
}

# --no-deps on the runner's `up`: without it, `--build` also rebuilds the
# services e2e depends on (frontend, and backend through it) and recreates
# their containers when the fresh image differs - which ensure_up has just
# brought up and waited for. A restart there is short enough to hide
# behind Playwright's retries in dev mode; a frontend that has to build
# first would not be. Either way the runner has no business restarting
# what it is about to test.
ensure_e2e_runner() {
  ensure_up
  compose_test_profile up -d --build --no-deps e2e
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
  local playwright_rc=0

  ensure_e2e_runner
  # Under `set -e`, a bare failing command here would abort the script
  # before the `cat` below ever runs - losing the JSON report (which
  # test-report.mjs needs to print pass/fail counts) on every single test
  # failure, i.e. on exactly the runs anyone would want it for. `|| rc=$?`
  # captures the exit code without tripping errexit, so the `cat` always
  # runs and the caller still sees the real Playwright exit status.
  #
  # --reporter on the CLI *replaces* playwright.config.ts's `reporter:`
  # array rather than adding to it, so the config's `html` entry is
  # otherwise silently dropped and playwright-report/ stays empty forever
  # regardless of how the volume mount is wired up - listing it here is
  # what actually makes the html reporter run. No explicit output-folder
  # option needed: CI=1 (set on the e2e service) already makes the html
  # reporter default open:'never', matching the config's explicit setting.
  compose_test_profile exec -T e2e sh -lc "E2E_BASE_URL='http://frontend:5173' PLAYWRIGHT_JSON_OUTPUT_FILE='${report_path}' npx playwright test --project='${project_name}' --reporter=list,json,html --config=playwright.config.ts" || playwright_rc=$?
  # The e2e image runs as root (no USER in frontend/Dockerfile.e2e), so
  # playwright-report/ and test-results/ - bind-mounted host directories -
  # come out root-owned. Reading them back (e.g. actions/upload-artifact)
  # works fine either way, but a GitHub-hosted CI runner throws the whole
  # VM away after the job, so nothing there ever needs to delete these
  # files - a persistent host does: without this, a later `git clean -fdx`
  # or plain `rm -rf` on a developer's own machine hits "Permission
  # denied" partway through, because deleting a file needs write access to
  # its *parent* directory, and Playwright's per-test subdirectories are
  # root-owned at their default 755. Best-effort (`|| true`): must never
  # turn a real test failure captured in $playwright_rc into a script
  # abort.
  # Ordered before the `cat` below deliberately: that read is not guarded,
  # so when Playwright dies before writing the json report (config error,
  # a stray test.only tripping forbidOnly, container OOM) it exits non-zero
  # and `set -e` unwinds this function - leaving the artifacts Playwright
  # *did* write root-owned, which is the very case this prevents.
  compose_test_profile exec -T e2e sh -lc "chmod -R a+rwX /app/playwright-report /app/test-results" || true
  compose_test_profile exec -T e2e sh -lc "cat '${report_path}'" > "$out_path"
  return "$playwright_rc"
}

# The performance lane measures the production build, so the frontend
# service comes up in preview mode (frontend/docker-entrypoint.sh) - a
# `vite build` followed by `vite preview`, on the same port and hostname
# the dev server uses, so the backend's CORS origin and the browser's URLs
# do not change with the mode. Exported rather than passed inline: compose
# reads FRONTEND_MODE straight from the environment
# (docker-compose.yml's `${FRONTEND_MODE:-dev}`), and ensure_up brings the
# stack up with the plain `compose` wrapper, which does not list it.
# `compose up` recreates a container whose environment changed, so a stack
# left up by the smoke lane switches shape here instead of being reused.
ensure_perf_runner() {
  export FRONTEND_MODE=preview
  ensure_up
  compose_test_profile up -d --build --no-deps e2e
}

run_perf() {
  local out_path="$1"
  local lighthouse_rc=0
  # The runner (frontend/perf/lighthouse.mjs) writes its verdicts beside the
  # reports, in the bind-mounted lighthouse-report/; copied out through the
  # container anyway, like the Playwright report, so the caller's JSON path
  # is served the same way whichever lane ran.
  local assertions_path="/app/lighthouse-report/assertion-results.json"

  ensure_perf_runner
  # lighthouse-report/ is a bind mount that outlives the container, so last
  # run's verdicts are still there when this one starts. The runner clears
  # them itself, but only once it is running - a budgets file that does not
  # parse, or a container that never starts, would leave last run's passing
  # rows for the `cat` below to copy out as this run's. Cleared here first,
  # so a run that never judged anything has nothing to hand back.
  compose_test_profile exec -T e2e sh -lc "rm -f /app/lighthouse-report/assertion-results.json /app/lighthouse-report/manifest.json" || true
  # Lighthouse drives the Playwright image's own Chromium - the same pinned
  # build the smoke lane's browser is - rather than downloading one, so the
  # numbers do not move with whatever Chrome a developer or runner has
  # installed. Resolved at run time because the path carries Playwright's
  # build number and platform directory (chromium-1208/chrome-linux64 for
  # v1.58.2), both of which a Playwright bump can change.
  # Same `|| rc=$?` shape as run_e2e_playwright: a failed assertion must not
  # abort this function before the results and the report are copied out.
  compose_test_profile exec -T e2e sh -lc "CHROME_PATH=\$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -n 1) && export CHROME_PATH && npm run lighthouse" || lighthouse_rc=$?
  # Root-owned bind-mount output, as for the Playwright artifacts above.
  compose_test_profile exec -T e2e sh -lc "chmod -R a+rwX /app/lighthouse-report" || true
  compose_test_profile exec -T e2e sh -lc "cat '${assertions_path}'" > "$out_path"
  return "$lighthouse_rc"
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
  run-perf                Internal: run the Lighthouse lane against the production build
  help                    Show this help

Environment overrides:
  TEST_COMPOSE_PROJECT (default: tyr-test)
  TEST_STACK_NAME      (default: value of TEST_COMPOSE_PROJECT)
  TEST_DB_NAME         (default: track_regions_test)
  TEST_DB_PORT         (default: 55432)
  TEST_BACKEND_PORT    (default: 5301)
  TEST_FRONTEND_PORT   (default: 5174)
  TEST_MARTIN_PORT     (default: 5300)
  TEST_DATA_DIR        (default: ./.test-data)
  TEST_READINESS_ATTEMPTS (default: 90, x 2s sleep = 180s per service)
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
  run-perf)
    require_output_path "${2:-}"
    run_perf "$2"
    ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "Unknown command: $1" >&2
    cmd_help
    exit 1
    ;;
esac
