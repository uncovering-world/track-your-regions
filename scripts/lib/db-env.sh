#!/usr/bin/env bash
# =============================================================================
# Shared database environment for the repository's shell tools
# =============================================================================
# Sourced, never executed. It answers the three questions every script that
# talks to the database has to answer the same way: what the connection is
# (.env), which database is active (.active-db), and how psql is invoked.
#
# db-cli.sh and db-migrate.sh both read it, so "the active database" means one
# thing across the two — a migration is recorded against the database the shell
# is pointed at, not against whichever one a second copy of these defaults
# happened to name.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/db-env.sh"
#   load_env
# =============================================================================

# Colors for output. Each of the three below is used only by the scripts that
# source this file, which is what its directive says; YELLOW and NC are used
# just underneath.
# shellcheck disable=SC2034
RED='\033[0;31m'
# Used by the sourcing script, not here.
# shellcheck disable=SC2034
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
# Used by the sourcing script, not here.
# shellcheck disable=SC2034
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# File paths. Resolved from this file's own location rather than from the
# caller's, so a script one directory deeper still finds the repository root.
DB_ENV_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$DB_ENV_LIB_DIR")")"
ACTIVE_DB_FILE="$PROJECT_ROOT/.active-db"
ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

# Load environment variables
load_env() {
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        # Reason: $ENV_FILE is resolved at runtime, so there is no fixed file
        # to follow.
        # shellcheck source=/dev/null
        source "$ENV_FILE"
        set +a
    elif [[ -f "$ENV_EXAMPLE" ]]; then
        echo -e "${YELLOW}Warning: .env not found, using .env.example defaults${NC}"
        set -a
        # Reason: $ENV_EXAMPLE is likewise resolved at runtime.
        # shellcheck source=/dev/null
        source "$ENV_EXAMPLE"
        set +a
    fi

    # Defaults
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_USER="${DB_USER:-postgres}"
    DB_PASSWORD="${DB_PASSWORD:-postgres}"
}

# Get current active database name.
# Falls back to DB_NAME from .env (the single source of truth when there is no
# .active-db pointer, e.g. a Docker-Compose-provisioned DB on a fresh clone).
get_active_db() {
    if [[ -f "$ACTIVE_DB_FILE" ]]; then
        cat "$ACTIVE_DB_FILE"
    else
        echo "${DB_NAME:-track_regions}"
    fi
}

# Execute psql command
psql_cmd() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@"
}

# Execute psql command on postgres database (for admin operations)
psql_admin() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres "$@"
}

# psql, wherever this machine keeps it.
#
# A fresh clone is documented as needing Docker and Node and nothing else
# (README), so a host psql cannot be assumed: when there is none, go through the
# db container the way db:run-sql does. Callers that want to send a file must
# redirect it on stdin rather than pass -f, since a host path does not exist
# inside the container.
db_psql() {
    if command -v psql > /dev/null 2>&1; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@"
    else
        (cd "$PROJECT_ROOT" && docker compose exec -T db psql -U "$DB_USER" "$@")
    fi
}

# The same, against the postgres database, for questions about databases.
db_psql_admin() {
    db_psql -d postgres "$@"
}

# Check if database exists.
#
# The name is an operator's argument -- db-cli.sh hands `use`, `drop` and
# `create` theirs straight from the command line -- and it lands inside a SQL
# string literal, so the quotes in it are doubled first, the way cmd_make_admin
# already does with an email. Every caller is covered by escaping here rather
# than by each of them checking: the runner's own stricter rule about what a
# database name may look like is a property of the runner, not of this lookup.
db_exists() {
    local db_name="$1"
    local escaped="${db_name//\'/\'\'}"
    db_psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$escaped'" 2>/dev/null | grep -q 1
}
