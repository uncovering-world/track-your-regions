#!/usr/bin/env bash
# =============================================================================
# Tests for the migration runner (scripts/db-migrate.sh)
# =============================================================================
# Drives the runner against a throwaway database and a handful of fixture
# migrations written for the occasion -- including one written to fail, because
# the case this ledger exists for is the one where a migration does not finish
# and must not be recorded as though it had (#435, ADR-0041).
#
# Needs a running Postgres (npm run db:up), and a host psql for its own setup --
# it builds throwaway databases from the canonical schema by path. The runner
# under test needs neither: it falls back to the db container. So this is a
# local gate rather than a CI one, like the E2E smoke lane.
#
#   npm run test:db-migrate
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors and the psql wrappers, so these tests reach the same server the runner
# under test reaches.
# shellcheck source=scripts/lib/db-env.sh
source "$SCRIPT_DIR/lib/db-env.sh"

RUNNER="$SCRIPT_DIR/db-migrate.sh"
TEST_DB="tyr_migrate_test_$$"
FIXTURES=""
FAILURES=0
CHECKS=0

load_env

# Take the fixtures and the throwaway database away, however the run ends.
cleanup() {
    if [[ -n "$FIXTURES" && -d "$FIXTURES" ]]; then
        rm -rf "$FIXTURES"
    fi
    psql_admin -q -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# Record a check that held.
pass() {
    CHECKS=$((CHECKS + 1))
    echo -e "  ${GREEN}ok${NC}   $1"
}

# Record a check that did not, with what was expected where that helps.
fail() {
    CHECKS=$((CHECKS + 1))
    FAILURES=$((FAILURES + 1))
    echo -e "  ${RED}FAIL${NC} $1"
    [[ $# -gt 1 ]] && echo "       $2"
}

# Assert two values are the same.
check_eq() {
    local expected="$1" actual="$2" what="$3"
    if [[ "$expected" == "$actual" ]]; then
        pass "$what"
    else
        fail "$what" "expected [$expected], got [$actual]"
    fi
}

# Assert some output says a particular thing.
check_contains() {
    local haystack="$1" needle="$2" what="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        pass "$what"
    else
        fail "$what" "[$needle] is not in the output"
    fi
}

# The runner, over the fixtures, against the test database. Never fails the
# script itself: every case here asserts on the exit code it gets back.
run_migrate() {
    DB_MIGRATIONS_DIR="$FIXTURES" "$RUNNER" "$@" --database "$TEST_DB" 2>&1
}

# One scalar out of the test database, whitespace stripped.
q() {
    psql_cmd -d "$TEST_DB" -tAc "$1" | tr -d '[:space:]'
}

# =============================================================================
# Fixtures
# =============================================================================

# Three migrations that each create a table, in a directory of their own.
write_fixtures() {
    FIXTURES="$(mktemp -d)"

    cat > "$FIXTURES/001-first-table.sql" <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS migrate_test_first (id INTEGER PRIMARY KEY);
COMMIT;
SQL

    cat > "$FIXTURES/002-second-table.sql" <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS migrate_test_second (id INTEGER PRIMARY KEY);
COMMIT;
SQL

    cat > "$FIXTURES/003-third-table.sql" <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS migrate_test_third (id INTEGER PRIMARY KEY);
COMMIT;
SQL
}

# A migration that aborts on purpose, in the shape 006 uses: it decides the
# database is not in a state it can work on and raises. Numbered 002 so there
# is a later file to leave unattempted.
write_failing_second() {
    cat > "$FIXTURES/002-second-table.sql" <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS migrate_test_second (id INTEGER PRIMARY KEY);
DO $$ BEGIN
    RAISE EXCEPTION 'refusing to run: this database is not in the expected state';
END $$;
COMMIT;
SQL
}

# =============================================================================
# The test database
# =============================================================================

echo -e "${BLUE}Migration runner tests${NC}"
echo ""

if ! psql_admin -tAc "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}Cannot reach Postgres at $DB_HOST:$DB_PORT. Start it with 'npm run db:up'.${NC}" >&2
    exit 1
fi

echo -e "${BLUE}Building $TEST_DB from the canonical schema...${NC}"
psql_admin -q -c "CREATE DATABASE \"$TEST_DB\"" > /dev/null
psql_cmd -d "$TEST_DB" -q -v ON_ERROR_STOP=1 -f "$PROJECT_ROOT/db/init/01-schema.sql" > /dev/null
write_fixtures
echo ""

# =============================================================================
# Cases
# =============================================================================

echo "the ledger comes from the canonical schema"
check_eq "t" "$(q "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" \
    "01-schema.sql creates schema_migrations"
check_eq "0" "$(q "SELECT count(*) FROM schema_migrations")" \
    "a database built from it records nothing yet"

echo ""
echo "status names what is pending"
out="$(run_migrate status)" || true
check_contains "$out" "pending: 3" "three fixture migrations are pending"
check_contains "$out" "001-first-table.sql" "and they are listed by name"

echo ""
echo "apply runs them in order and records each one"
out="$(run_migrate apply)" || fail "apply exits 0" "$out"
check_eq "3" "$(q "SELECT count(*) FROM schema_migrations")" "three rows recorded"
check_eq "3" "$(q "SELECT count(*) FROM schema_migrations WHERE ran")" "recorded as run, not baselined"
check_eq "t" "$(q "SELECT to_regclass('public.migrate_test_third') IS NOT NULL")" "the last migration took effect"
check_eq "64" "$(q "SELECT length(checksum) FROM schema_migrations WHERE filename = '001-first-table.sql'")" \
    "the checksum is a SHA-256"

echo ""
echo "a second run is inert"
out="$(run_migrate apply)" || fail "a second apply exits 0" "$out"
check_contains "$out" "Nothing pending" "it says there is nothing to do"
check_eq "3" "$(q "SELECT count(*) FROM schema_migrations")" "and records nothing further"

echo ""
echo "a migration that fails is not recorded"
# Rebuild the database so 002 is pending again, this time in its failing shape.
psql_admin -q -c "DROP DATABASE \"$TEST_DB\"" > /dev/null
psql_admin -q -c "CREATE DATABASE \"$TEST_DB\"" > /dev/null
psql_cmd -d "$TEST_DB" -q -v ON_ERROR_STOP=1 -f "$PROJECT_ROOT/db/init/01-schema.sql" > /dev/null
write_failing_second

if out="$(run_migrate apply)"; then
    fail "apply exits non-zero when a migration fails" "it exited 0"
else
    pass "apply exits non-zero when a migration fails"
fi
check_contains "$out" "is NOT recorded as applied" "it says the migration was not recorded"
check_eq "1" "$(q "SELECT count(*) FROM schema_migrations")" "only the migration before it is recorded"
check_eq "0" "$(q "SELECT count(*) FROM schema_migrations WHERE filename = '002-second-table.sql'")" \
    "the failed migration has no ledger row"
check_eq "f" "$(q "SELECT to_regclass('public.migrate_test_third') IS NOT NULL")" \
    "the migration after it was not attempted"
check_contains "$out" "1 later migration(s) were not attempted" "and it says so"

echo ""
echo "baseline records without running"
write_fixtures
out="$(run_migrate baseline --through 002)" || fail "baseline exits 0" "$out"
check_eq "2" "$(q "SELECT count(*) FROM schema_migrations")" "--through 002 stops at 002"
check_eq "1" "$(q "SELECT count(*) FROM schema_migrations WHERE NOT ran")" \
    "the baselined row is marked as not run here"
check_eq "f" "$(q "SELECT to_regclass('public.migrate_test_third') IS NOT NULL")" \
    "003 was neither run nor recorded"
out="$(run_migrate status)" || true
check_contains "$out" "pending: 1" "status still reports 003 as pending"

echo ""
echo "a file edited after it was recorded is reported"
echo "-- a later edit" >> "$FIXTURES/001-first-table.sql"
out="$(run_migrate status)" || true
check_contains "$out" "edited since it was recorded" "status reports the drift"
check_contains "$out" "001-first-table.sql" "and names the file"

echo ""
echo "a checksum that cannot be taken stops the run"
# Root reads a file whatever its mode, so there is no way to make the checksum
# fail for it; the case is skipped rather than passed on a run that never
# exercised it.
if [[ $EUID -eq 0 ]]; then
    echo "  skip  running as root: a mode of 000 would still be readable"
else
    chmod 000 "$FIXTURES/001-first-table.sql"
    if out="$(run_migrate status)"; then
        fail "status stops rather than calling it drift" "it exited 0"
    else
        check_contains "$out" "Could not checksum" "status stops rather than calling it drift"
    fi
    chmod 644 "$FIXTURES/001-first-table.sql"

    chmod 000 "$FIXTURES/003-third-table.sql"
    if out="$(run_migrate baseline)"; then
        fail "baseline stops rather than recording an empty checksum" "it exited 0"
    else
        check_contains "$out" "Could not checksum" "baseline stops rather than recording an empty checksum"
    fi
    chmod 644 "$FIXTURES/003-third-table.sql"
    check_eq "2" "$(q "SELECT count(*) FROM schema_migrations")" "and nothing was recorded"
    check_eq "0" "$(q "SELECT count(*) FROM schema_migrations WHERE checksum !~ '^[0-9a-f]{64}\$'")" \
        "every recorded checksum is a SHA-256"
fi

echo ""
echo "an empty ledger on a database that holds a catalogue is refused, not applied"
# The shape a Compose-provisioned database is in after a first import: built
# from the canonical schema, so it already carries what the migrations do, and
# now holding rows that 015 would delete by volume.
psql_cmd -d "$TEST_DB" -q -c "DELETE FROM schema_migrations" > /dev/null
psql_cmd -d "$TEST_DB" -q -c "
    INSERT INTO experiences (category_id, external_id, name, location)
    VALUES (1, 'migrate-test-1', 'A place', ST_SetSRID(ST_MakePoint(0, 0), 4326))
    ON CONFLICT DO NOTHING" > /dev/null
if out="$(run_migrate apply < /dev/null)"; then
    fail "apply refuses a database with an empty ledger and a catalogue" "it exited 0"
else
    check_contains "$out" "has no ledger entries at all" "apply refuses a database with an empty ledger and a catalogue"
    check_contains "$out" "npm run db:baseline" "and it names the answer"
fi
out="$(run_migrate status)" || true
check_contains "$out" "Record what it already has" "status advises baseline, never migrate, on an empty ledger"
psql_cmd -d "$TEST_DB" -q -c "DELETE FROM experiences WHERE external_id = 'migrate-test-1'" > /dev/null

echo ""
echo "--only-if-empty leaves a database that has already spoken alone"
out="$(run_migrate baseline --through 001)" || fail "baseline --through 001 exits 0" "$out"
check_eq "1" "$(q "SELECT count(*) FROM schema_migrations")" "one migration recorded"
out="$(run_migrate baseline --only-if-empty)" || fail "--only-if-empty exits 0" "$out"
check_contains "$out" "leaving it alone" "it declines to add to a ledger that is not empty"
check_eq "1" "$(q "SELECT count(*) FROM schema_migrations")" "and records nothing further"
psql_cmd -d "$TEST_DB" -q -c "DELETE FROM schema_migrations" > /dev/null
out="$(run_migrate baseline --only-if-empty)" || fail "--only-if-empty on an empty ledger exits 0" "$out"
check_eq "3" "$(q "SELECT count(*) FROM schema_migrations")" "on an empty ledger it records every pending file"
if out="$(run_migrate apply --only-if-empty)"; then
    fail "--only-if-empty on apply is refused, not ignored" "it exited 0"
else
    check_contains "$out" "--only-if-empty applies to baseline" "--only-if-empty on apply is refused, not ignored"
fi

echo ""
echo "the runner refuses what it cannot order"
mv "$FIXTURES/003-third-table.sql" "$FIXTURES/3-third-table.sql"
if out="$(run_migrate status)"; then
    fail "a name outside NNN-slug.sql is refused" "it exited 0"
else
    check_contains "$out" "does not fit NNN-slug.sql" "a name outside NNN-slug.sql is refused"
fi
mv "$FIXTURES/3-third-table.sql" "$FIXTURES/003-third-table.sql"

cp "$FIXTURES/003-third-table.sql" "$FIXTURES/003-third-table-again.sql"
if out="$(run_migrate status)"; then
    fail "two migrations sharing a number are refused" "it exited 0"
else
    check_contains "$out" "share the number 003" "two migrations sharing a number are refused"
fi
rm "$FIXTURES/003-third-table-again.sql"

if out="$(run_migrate apply --through 002)"; then
    fail "--through on apply is refused, not ignored" "it exited 0"
else
    check_contains "$out" "--through applies to baseline" "--through on apply is refused, not ignored"
fi

if out="$(run_migrate baseline --through 2)"; then
    fail "--through takes a three-digit number" "it exited 0"
else
    check_contains "$out" "three-digit migration number" "--through takes a three-digit number"
fi

echo ""
echo "the runner refuses a database it cannot record against"
psql_cmd -d "$TEST_DB" -q -c "DROP TABLE schema_migrations" > /dev/null
if out="$(run_migrate status)"; then
    fail "a database without the ledger is refused" "it exited 0"
else
    check_contains "$out" "has no schema_migrations table" "a database without the ledger is refused"
    check_contains "$out" "01-schema.sql" "and it says how to get one"
fi

if out="$(DB_MIGRATIONS_DIR="$FIXTURES" "$RUNNER" status --database "no_such_database_here" 2>&1)"; then
    fail "a database that does not exist is refused" "it exited 0"
else
    check_contains "$out" "does not exist" "a database that does not exist is refused"
fi

# The name reaches a SQL string in db_exists, so it is held to the shape of an
# unquoted identifier before it gets there.
if out="$(DB_MIGRATIONS_DIR="$FIXTURES" "$RUNNER" status --database "x'; DROP DATABASE y; --" 2>&1)"; then
    fail "a name that is not an identifier is refused" "it exited 0"
else
    check_contains "$out" "Not a database name" "a name that is not an identifier is refused"
fi

# =============================================================================
# Result
# =============================================================================

echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GREEN}All $CHECKS checks passed.${NC}"
else
    echo -e "${RED}$FAILURES of $CHECKS checks failed.${NC}"
    exit 1
fi
