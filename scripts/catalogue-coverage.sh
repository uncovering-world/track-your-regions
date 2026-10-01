#!/usr/bin/env bash
# The catalogue-coverage commands, run against the active database (ADR-0081).
#
#   scripts/catalogue-coverage.sh load [--dir <path>]
#       read db/catalogue-coverage/, refuse a wrong line, and replace the four
#       coverage tables with it in one transaction
#   scripts/catalogue-coverage.sh report [--region <slug>]... [--json]
#       print what the catalogue holds of what is expected, which proposed kind
#       the surveys ask for most, and what each live kind lacks
#   scripts/catalogue-coverage.sh lookup wikivoyage <Title>... [--save <dir>]
#   scripts/catalogue-coverage.sh lookup search <phrase>...
#   scripts/catalogue-coverage.sh lookup facts <lat> <lon> <Qid>...
#       what a survey looks up while a list is compiled: what Wikivoyage names,
#       which Wikidata items a name could be, what Wikidata holds about an item.
#       It reads the web and prints; it touches no database
#
# The backend's own scripts read the connection from the environment and
# nothing loads .env for them, so this sets it the way db-migrate.sh does: the
# connection from .env, the database from .active-db.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/db-env.sh
source "$SCRIPT_DIR/lib/db-env.sh"
load_env
DB_NAME="$(get_active_db)"
export DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME

usage() {
    echo "Usage: scripts/catalogue-coverage.sh load [--dir <path>] | report [--region <slug>]... [--json] | lookup wikivoyage|search|facts ..." >&2
}

case "${1:-}" in
    load)
        shift
        exec npm --prefix "$PROJECT_ROOT/backend" run --silent catalogue:coverage:load -- "$@"
        ;;
    report)
        shift
        exec npm --prefix "$PROJECT_ROOT/backend" run --silent catalogue:coverage -- "$@"
        ;;
    lookup)
        shift
        exec npm --prefix "$PROJECT_ROOT/backend" run --silent catalogue:coverage:lookup -- "$@"
        ;;
    *)
        usage
        exit 2
        ;;
esac
