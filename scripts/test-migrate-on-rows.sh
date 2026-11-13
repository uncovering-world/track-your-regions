#!/usr/bin/env bash
# =============================================================================
# Tests for the migration-on-rows gate (scripts/migrate-on-rows.mjs, #2464)
# =============================================================================
# Drives the gate over migrations written for the occasion, the way
# scripts/test-db-migrate.sh drives the runner: each case is a directory of
# files the gate applies instead of the ones the change adds
# (MIGRATE_ON_ROWS_MIGRATIONS_DIR), against this checkout's HEAD as the base,
# so the base's schema and fixture are this commit's.
#
# The case the gate exists for is 232's shape (#2462): a backfill that updates
# rows of source_records, whose deferred crowding triggers queue an event per
# row, followed by an ALTER TABLE on the same table in the same transaction.
# The smoke fixture holds source_records rows, so Postgres refuses it. Beside
# it: the same backfill alone passes, and a migration that leaves a constraint
# 01-schema.sql does not declare fails the comparison.
#
# Each case stands a throwaway Postgres up and takes it down (about a minute
# each), so this is a local test, like test:db-migrate, outside the gate map.
# Needs Docker and the backend's installed modules (the fixture runs on tsx).
#
#   npm run test:migrate-on-rows
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/migrate-on-rows.mjs"
FIXTURES="$(mktemp -d)"
FAILURES=0
CHECKS=0

trap 'rm -rf "$FIXTURES"' EXIT

pass() {
    CHECKS=$((CHECKS + 1))
    echo "  ok   $1"
}

fail() {
    CHECKS=$((CHECKS + 1))
    FAILURES=$((FAILURES + 1))
    echo "  FAIL $1"
    [[ $# -gt 1 ]] && echo "       $2"
}

check_contains() {
    local haystack="$1" needle="$2" what="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        pass "$what"
    else
        fail "$what" "[$needle] is not in the output"
    fi
}

# The gate's output, indented under the case it belongs to.
show() {
    local line
    while IFS= read -r line; do
        echo "    | $line"
    done <<< "$1"
}

# Assert the gate's exit code was zero, or was not.
check_code() {
    local want="$1" code="$2"
    if [[ "$want" == "zero" ]]; then
        if [[ $code -eq 0 ]]; then pass "it exits 0"; else fail "it exits 0" "exit $code"; fi
    elif [[ $code -ne 0 ]]; then
        pass "it exits non-zero"
    else
        fail "it exits non-zero" "it exited 0"
    fi
}

# The gate over one case's directory, its output kept for the checks and
# printed for the reader. Never fails the script: each case asserts the code.
run_gate() {
    local dir="$1"
    GATES_BASE=HEAD MIGRATE_ON_ROWS_MIGRATIONS_DIR="$dir" node "$GATE" 2>&1
}

# One case's directory, holding the file the heredoc on stdin gives.
case_dir() {
    local name="$1" file="$2"
    mkdir -p "$FIXTURES/$name"
    cat > "$FIXTURES/$name/$file"
    echo "$FIXTURES/$name"
}

# A backfill that changes every record's type and so fires
# crowding_follows_membership_change for each: an event queued until COMMIT.
BACKFILL="UPDATE source_records SET type = CASE WHEN type IS NULL THEN 'probe' ELSE NULL END;"

echo "Migration-on-rows gate tests"

echo ""
echo "nothing added is a no-op that says so"
mkdir -p "$FIXTURES/empty"
out="$(run_gate "$FIXTURES/empty")" && code=0 || code=$?
show "$out"
check_code zero "$code"
check_contains "$out" "nothing to apply on rows" "it says there is nothing to apply"

echo ""
echo "a row write before an ALTER TABLE on a table with deferred triggers fails, naming the file"
dir="$(case_dir rows-before-shape 900-rows-before-shape.sql <<SQL
BEGIN;
$BACKFILL
ALTER TABLE source_records ADD CONSTRAINT migrate_on_rows_probe CHECK (true);
COMMIT;
SQL
)"
out="$(run_gate "$dir")" && code=0 || code=$?
show "$out"
check_code non-zero "$code"
check_contains "$out" "900-rows-before-shape.sql failed on a database that holds rows" "it names the file"
check_contains "$out" "pending trigger events" "it carries Postgres's error"
check_contains "$out" "writes and alters source_records: held" "it says how many rows the table held"

echo ""
echo "the same backfill alone passes, and the schema stays the fresh one's"
dir="$(case_dir clean-backfill 901-a-clean-backfill.sql <<SQL
BEGIN;
$BACKFILL
COMMIT;
SQL
)"
out="$(run_gate "$dir")" && code=0 || code=$?
show "$out"
check_code zero "$code"
check_contains "$out" "applied in" "it applied the file"
check_contains "$out" "is a fresh one's" "it says the schemas agree"

echo ""
echo "a migration that leaves what 01-schema.sql does not declare fails the comparison"
dir="$(case_dir shape-left-behind 902-a-constraint-the-schema-lacks.sql <<SQL
BEGIN;
ALTER TABLE source_records ADD CONSTRAINT migrate_on_rows_probe CHECK (true);
$BACKFILL
COMMIT;
SQL
)"
out="$(run_gate "$dir")" && code=0 || code=$?
show "$out"
check_code non-zero "$code"
check_contains "$out" "is not the schema a fresh database gets" "it says the schemas differ"
check_contains "$out" "- constraint public.source_records migrate_on_rows_probe" "it names the constraint"

echo ""
if [[ $FAILURES -eq 0 ]]; then
    echo "All $CHECKS checks passed."
else
    echo "$FAILURES of $CHECKS checks failed."
    exit 1
fi
