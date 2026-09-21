#!/usr/bin/env bash
# Generate backend/src/db/schema.generated.ts from a fresh database, or check
# that the committed file matches one (ADR-0064, #792).
#
#   scripts/db-types.sh            regenerate
#   scripts/db-types.sh --check    exit 1 when the committed file and the schema disagree
#
# The database is the one db/init/01-schema.sql builds: the compose file's `db`
# service under a project of its own, so its named volume starts empty and
# docker-entrypoint-initdb.d applies db/init on first start. The image pin stays
# in docker-compose.yml, said once. The container is taken down, volume and all,
# on every exit path: the next run must start from nothing, or the types would
# describe a database that remembered an earlier schema.
#
# Never the developer's catalogue: that database holds whatever branches have
# been applied to it (56 relations on 2026-09-21 against the schema's 45), and
# the generator itself refuses any database not named like a test one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

PROJECT="${DB_TYPES_COMPOSE_PROJECT:-tyr-dbtypes}"
# `cleanup` below runs `down -v` on whatever project this names, before the
# first `up` and on exit, so the name is confined to a namespace of its own:
# pointed at the test stack (`tyr-test`) or any other live project, one run
# would delete that project's volumes.
case "$PROJECT" in
  tyr-dbtypes|tyr-dbtypes-*) ;;
  *)
    echo "Refusing project '$PROJECT': DB_TYPES_COMPOSE_PROJECT must be tyr-dbtypes or tyr-dbtypes-<suffix>." >&2
    exit 1
    ;;
esac
STACK_NAME="$PROJECT"
DB_NAME="track_regions_types_test"
DB_PORT="${DB_TYPES_DB_PORT:-55433}"
READINESS_ATTEMPTS=60

compose() {
  STACK_NAME="$STACK_NAME" DB_NAME="$DB_NAME" DB_PORT="$DB_PORT" DB_USER=postgres DB_PASSWORD=postgres \
    docker compose -p "$PROJECT" -f docker-compose.yml "$@"
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

# `down -v` first as well: a run interrupted before its trap ran would leave a
# volume whose initdb has already happened, and a second `up` would skip the
# schema silently.
cleanup
echo "Starting a fresh database for the schema types (project='$PROJECT', port=$DB_PORT)"
compose up -d db

ready=0
for ((i = 1; i <= READINESS_ATTEMPTS; i++)); do
  # initdb applies db/init on a temporary server that listens on the unix
  # socket only, then stops it and starts the real one; a probe over the
  # socket answers during that first phase, and a host connection through the
  # port dies in the restart that follows. So the probe goes over TCP, which
  # only the final server offers, and the relation count says init finished.
  if compose exec -T db psql -h 127.0.0.1 -U postgres -d "$DB_NAME" -Atc \
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'" 2>/dev/null \
      | grep -qE '^[1-9][0-9]+$'; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "The database never finished applying db/init; last log lines:" >&2
  compose logs --no-color --tail 40 db >&2 || true
  exit 1
fi

DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER=postgres DB_PASSWORD=postgres \
  npm --prefix backend run --silent db:types -- "$@"
