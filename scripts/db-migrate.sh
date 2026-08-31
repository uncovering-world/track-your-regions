#!/usr/bin/env bash
# =============================================================================
# Migration runner for Track Your Regions
# =============================================================================
# Applies the numbered files in db/migrations/ to the active database, in
# filename order, and records each one in schema_migrations so the database can
# say what it has been through (#435, ADR-0041).
#
# Usage: ./scripts/db-migrate.sh <command> [options]
#
# Commands:
#   status                 - What is applied, what is pending, what has drifted
#   apply                  - Apply every pending migration, in order
#   baseline               - Record pending migrations as applied WITHOUT
#                            running them (for a database that predates the
#                            ledger, or one just created from the canonical
#                            schema)
#
# Options:
#   --database <name>      - Act on this database instead of the active one
#   --through <NNN>        - baseline only: stop after this migration number
#   --only-if-empty        - baseline only: do nothing unless the ledger is
#                            empty, for a caller that may run more than once
#
# Two things this runner deliberately does not do:
#
#   * It does not wrap a migration in a transaction. Each file decides its own,
#     and 34 of the 40 open one. psql --single-transaction over such a file
#     warns that a transaction is already in progress, and then the file's own
#     COMMIT ends psql's outer one, so everything after it runs unwrapped --
#     the option looks like atomicity and is not, which is worse than not
#     offering it. Only the file knows whether its work is one step or several.
#
#   * It does not record a file it did not see finish. The INSERT into
#     schema_migrations is appended to the migration itself and handed to the
#     same psql invocation under ON_ERROR_STOP=1, so it is reached only when
#     every statement before it succeeded. psql exits 0 on a failed statement
#     in a piped script, which is how a migration that aborts on purpose used
#     to report success to the shell (db/migrations/README.md).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors, repository paths, load_env, get_active_db and the psql wrappers, so
# that this runner and db-cli.sh agree on which database is the active one.
# shellcheck source=scripts/lib/db-env.sh
source "$SCRIPT_DIR/lib/db-env.sh"

# db/migrations/ in every real use. The override exists for the runner's own
# test (scripts/test-db-migrate.sh), which drives it over a handful of fixture
# files -- including one written to fail -- rather than over the catalogue's
# forty.
MIGRATIONS_DIR="${DB_MIGRATIONS_DIR:-$PROJECT_ROOT/db/migrations}"

# A migration filename is three digits, a dash, a lowercase slug, and .sql.
# The runner refuses anything else rather than guessing where it belongs:
# filename order is the order the files are applied in, and a name outside this
# shape has no defined place in it. It is also what makes the name safe to
# embed in SQL below -- it admits no quote.
FILENAME_PATTERN='^[0-9]{3}-[a-z0-9]+(-[a-z0-9]+)*\.sql$'

# Say what went wrong on stderr, and stop.
die() {
    echo -e "${RED}$*${NC}" >&2
    exit 1
}

# Associative arrays and mapfile are bash 4. macOS still ships 3.2 as
# /bin/bash, and file_checksum has a shasum branch precisely because this is
# expected to run there, so say which shell is needed rather than dying on
# "declare: -A: invalid option" before a single command has run.
if [[ ${BASH_VERSINFO[0]} -lt 4 ]]; then
    die "This runner needs bash 4 or newer; ${BASH_VERSION} is running it. On macOS: brew install bash."
fi

# The file handed to psql is a migration with its ledger row appended. Removed
# on the way out however the run ends, including an interrupt mid-migration.
TMP_SQL=""
cleanup() {
    if [[ -n "$TMP_SQL" ]]; then
        rm -f "$TMP_SQL"
    fi
}
trap cleanup EXIT

# =============================================================================
# The files
# =============================================================================

# Every migration file, in the order they are applied.
#
# Reading it needs no validation of its own: validate_migration_names() runs
# once from main, in the shell itself, because this function is called through
# process substitution and a die() inside one kills the subshell and leaves the
# caller reading a short list as though it were the whole directory.
migration_files() {
    local path
    for path in "$MIGRATIONS_DIR"/*.sql; do
        [[ -e "$path" ]] || continue
        basename "$path"
    done | sort
}

# Refuses a name outside FILENAME_PATTERN and a number used twice, because
# either one makes "the order they are applied in" a guess.
validate_migration_names() {
    local base number previous=""
    local -a bases=()
    mapfile -t bases < <(migration_files)

    [[ ${#bases[@]} -gt 0 ]] || die "No migrations found in $MIGRATIONS_DIR."

    for base in "${bases[@]}"; do
        if [[ ! "$base" =~ $FILENAME_PATTERN ]]; then
            die "Migration name does not fit NNN-slug.sql: $base"
        fi
        number="${base:0:3}"
        if [[ "$number" == "$previous" ]]; then
            die "Two migrations share the number $number; their order is undefined."
        fi
        previous="$number"
    done
}

# SHA-256 of a file, as bare hex. coreutils on Linux, shasum on macOS.
#
# Refuses to answer with anything that is not one. The value is written into the
# ledger and compared against on every later run, so an empty string here would
# record a row nothing can verify and report that file as edited ever after --
# and every caller must assign this to a variable before using it, since a
# command substitution that fails inside a condition or an argument list does
# not stop the command around it.
file_checksum() {
    local path="$1" sum=""
    if command -v sha256sum > /dev/null 2>&1; then
        sum="$(sha256sum "$path" | cut -d' ' -f1)"
    elif command -v shasum > /dev/null 2>&1; then
        sum="$(shasum -a 256 "$path" | cut -d' ' -f1)"
    else
        die "Neither sha256sum nor shasum is available; cannot checksum migrations."
    fi
    if [[ ! "$sum" =~ ^[0-9a-f]{64}$ ]]; then
        die "Could not checksum $path."
    fi
    echo "$sum"
}

# =============================================================================
# The database
# =============================================================================

# The database to act on: --database if given, else the active one.
resolve_database() {
    local db="$OPT_DATABASE"
    if [[ -z "$db" ]]; then
        db="$(get_active_db)"
    fi
    [[ -n "$db" ]] || die "No database to act on. Use 'npm run db:use <name>' or pass --database <name>."
    # The name reaches a SQL string literal in db_exists, so it is held to
    # characters that cannot leave one -- no quote, no backslash, nothing that
    # is not a word character, a dot or a dash. Wide enough for every name
    # db:create can produce and for the hyphenated ones people type by hand;
    # narrow enough that the literal stays a literal.
    if [[ ! "$db" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]]; then
        die "Not a database name: $db"
    fi
    if ! db_exists "$db"; then
        die "Database '$db' does not exist. 'npm run db:list' shows what is there; .active-db may be pointing at a database that has been dropped."
    fi
    echo "$db"
}

# Refuse to guess when the ledger itself is missing: the table belongs to the
# canonical schema, and defining it here as well would make two sources of
# truth out of one.
require_ledger() {
    local present
    present="$(psql_cmd -d "$DB" -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL" | tr -d '[:space:]')"
    if [[ "$present" != "t" ]]; then
        echo -e "${RED}Database '$DB' has no schema_migrations table.${NC}" >&2
        echo "It arrives with the canonical schema. Re-apply it, then try again:" >&2
        # Names the database rather than saying db:run-sql, which is wired to
        # whatever .active-db holds -- and so would apply the schema to a
        # different database than the one being complained about.
        echo "  docker compose exec -T db psql -U $DB_USER -d $DB -v ON_ERROR_STOP=1 < db/init/01-schema.sql" >&2
        exit 1
    fi
}

# Fills RECORDED_CHECKSUM and RECORDED_RAN from the ledger.
#
# The read happens in the shell itself rather than through a pipe or a process
# substitution: a failed query that reached the caller as an empty ledger would
# report every migration as pending, and 'apply' would then run the lot again.
# Under errexit a failure here stops the script instead.
read_ledger() {
    local rows base checksum ran
    RECORDED_CHECKSUM=()
    RECORDED_RAN=()
    rows="$(psql_cmd -d "$DB" -tAF$'\t' -c \
        "SELECT filename, checksum, ran FROM schema_migrations ORDER BY filename")"
    while IFS=$'\t' read -r base checksum ran; do
        [[ -n "$base" ]] || continue
        RECORDED_CHECKSUM["$base"]="$checksum"
        RECORDED_RAN["$base"]="$ran"
    done <<< "$rows"
}

# Record one migration. Values are embedded rather than bound because psql's
# own -v interpolation is unreliable across versions (see db-cli.sh); both are
# safe to embed -- the filename has passed FILENAME_PATTERN, which admits no
# quote, and the checksum is bare hex.
record_sql() {
    local base="$1" checksum="$2" ran="$3"
    printf "INSERT INTO schema_migrations (filename, checksum, ran) VALUES ('%s', '%s', %s);" \
        "$base" "$checksum" "$ran"
}

# Does this database hold rows a backfill could damage?
#
# Asked of `experiences` because that is the table at risk: 015 deletes from the
# catalogue by volume. A database without the table at all is older than it and
# holds no catalogue by definition.
database_holds_catalogue() {
    local present rows
    # Two statements rather than one guarded by CASE: a missing relation fails
    # at parse time, before any guard inside the same query is evaluated.
    present="$(psql_cmd -d "$DB" -tAc "SELECT to_regclass('public.experiences') IS NOT NULL" | tr -d '[:space:]')"
    [[ "$present" == "t" ]] || return 1
    rows="$(psql_cmd -d "$DB" -tAc "SELECT EXISTS (SELECT 1 FROM experiences)" | tr -d '[:space:]')"
    [[ "$rows" == "t" ]]
}

# Fills PENDING with the migrations this database has no record of.
collect_pending() {
    local base
    PENDING=()
    while read -r base; do
        [[ -n "$base" ]] || continue
        [[ -n "${RECORDED_CHECKSUM[$base]+set}" ]] || PENDING+=("$base")
    done < <(migration_files)
}

# =============================================================================
# Commands
# =============================================================================

# What this database has been through: how much is applied, how much of that
# was asserted rather than run, what is still pending, and what no longer
# matches the file it was recorded from.
cmd_status() {
    require_ledger
    read_ledger
    collect_pending

    local base on_disk applied=0 baselined=0
    local -a drifted=() vanished=()

    while read -r base; do
        [[ -n "$base" ]] || continue
        [[ -n "${RECORDED_CHECKSUM[$base]+set}" ]] || continue
        applied=$((applied + 1))
        if [[ "${RECORDED_RAN[$base]}" == "f" ]]; then
            baselined=$((baselined + 1))
        fi
        # Assigned before it is compared: errexit does not reach a command
        # substitution inside a condition, so a failed checksum there would
        # read as a file that no longer matches what was recorded.
        on_disk="$(file_checksum "$MIGRATIONS_DIR/$base")"
        if [[ "${RECORDED_CHECKSUM[$base]}" != "$on_disk" ]]; then
            drifted+=("$base")
        fi
    done < <(migration_files)

    for base in "${!RECORDED_CHECKSUM[@]}"; do
        [[ -f "$MIGRATIONS_DIR/$base" ]] || vanished+=("$base")
    done

    echo -e "${BLUE}Migrations:${NC} $DB"
    echo "  applied: $applied ($baselined of them recorded by baseline, not run here)"
    echo "  pending: ${#PENDING[@]}"
    for base in "${PENDING[@]+"${PENDING[@]}"}"; do
        echo -e "    ${YELLOW}$base${NC}"
    done
    if [[ ${#drifted[@]} -gt 0 ]]; then
        echo -e "  ${YELLOW}edited since it was recorded:${NC}"
        for base in "${drifted[@]}"; do echo "    $base"; done
    fi
    if [[ ${#vanished[@]} -gt 0 ]]; then
        echo -e "  ${YELLOW}recorded but no longer on disk:${NC}"
        while read -r base; do echo "    $base"; done < <(printf '%s\n' "${vanished[@]}" | sort)
    fi
    if [[ ${#PENDING[@]} -eq 0 ]]; then
        echo -e "  ${GREEN}Up to date.${NC}"
    elif [[ $applied -eq 0 ]]; then
        # An empty ledger never means "apply all of them". It means this
        # database has not said what it carries yet -- and every database that
        # has not is one built from the canonical schema (db:create, or Compose
        # through docker-entrypoint-initdb.d) or one older than the ledger.
        # Both already hold what these files do, and 015 deletes rows by volume,
        # so it would take a freshly imported catalogue with it.
        echo -e "  ${YELLOW}This database has no ledger entries at all,${NC}"
        echo -e "  ${YELLOW}so it has not said what it carries rather than being 40 files behind.${NC}"
        echo -e "  Record what it already has with ${BLUE}npm run db:baseline${NC}"
    else
        echo -e "  Apply them with ${BLUE}npm run db:migrate${NC}"
    fi
}

# Apply every pending migration, in filename order, stopping at the first one
# that does not finish.
cmd_apply() {
    require_ledger
    read_ledger
    collect_pending

    if [[ ${#PENDING[@]} -eq 0 ]]; then
        echo -e "${GREEN}Nothing pending on '$DB'.${NC}"
        return 0
    fi

    # Nothing recorded, on a database that already holds a catalogue, is the
    # shape that must not be walked past. It was built from the canonical schema
    # or predates the ledger, so it already carries what these files do -- while
    # 015 deletes rows by volume and would take a freshly imported catalogue
    # with it, its own header saying it is a one-time manual action rather than
    # a repeatable step. The answer is db:baseline; confirmed the way db-cli.sh
    # confirms a drop, and refused outright where nobody is there to confirm.
    #
    # An empty database with an empty ledger is the harmless half of the same
    # shape -- there is nothing for a backfill to damage -- and is left alone.
    if [[ ${#RECORDED_CHECKSUM[@]} -eq 0 ]] && database_holds_catalogue; then
        echo -e "${YELLOW}'$DB' has no ledger entries at all, so it has not said what it carries.${NC}" >&2
        echo -e "${YELLOW}A database built from db/init/01-schema.sql -- by db:create, or by Compose${NC}" >&2
        echo -e "${YELLOW}on first start -- already holds every change these files make, and 015${NC}" >&2
        echo -e "${YELLOW}deletes rows by volume. Record what it has with 'npm run db:baseline'.${NC}" >&2
        if [[ ! -t 0 ]]; then
            die "Refusing to apply ${#PENDING[@]} migration(s) to a database with an empty ledger."
        fi
        read -r -p "Apply all ${#PENDING[@]} anyway? (y/N) " -n 1
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Cancelled."
            return 0
        fi
    fi

    echo -e "${BLUE}Applying ${#PENDING[@]} migration(s) to '$DB'${NC}"

    local base checksum remaining applied=0
    for base in "${PENDING[@]}"; do
        checksum="$(file_checksum "$MIGRATIONS_DIR/$base")"
        echo -e "${BLUE}--> $base${NC}"

        # The file and its own record go to psql together, so the row exists
        # only if psql reached the end of the file. The migration keeps whatever
        # transaction it declares for itself; nothing is wrapped around it.
        TMP_SQL="$(mktemp)"
        cat "$MIGRATIONS_DIR/$base" > "$TMP_SQL"
        printf '\n-- Recorded by scripts/db-migrate.sh\n%s\n' "$(record_sql "$base" "$checksum" TRUE)" >> "$TMP_SQL"

        if psql_cmd -d "$DB" -v ON_ERROR_STOP=1 -f "$TMP_SQL"; then
            cleanup
            applied=$((applied + 1))
            echo -e "${GREEN}    applied and recorded${NC}"
        else
            cleanup
            echo "" >&2
            echo -e "${RED}$base failed. It is NOT recorded as applied.${NC}" >&2
            echo -e "${YELLOW}Whatever it committed before failing is still there; a migration is written to be re-runnable, so fix the cause and run db:migrate again.${NC}" >&2
            remaining=$((${#PENDING[@]} - applied - 1))
            if [[ $remaining -gt 0 ]]; then
                echo -e "${YELLOW}$remaining later migration(s) were not attempted.${NC}" >&2
            fi
            exit 1
        fi
    done

    echo -e "${GREEN}Applied $applied migration(s) to '$DB'.${NC}"
}

# Record pending migrations as applied without running them -- what a database
# older than the ledger, or one just built from the canonical schema, needs in
# order to state what it already carries.
cmd_baseline() {
    require_ledger
    read_ledger

    # A caller that may run more than once -- setup.sh, which the first-run doc
    # says is safe to re-run -- asks for this. Recording every pending file is
    # right exactly while the database has said nothing yet: after that, a file
    # pending here is one genuinely not applied, and writing it down as applied
    # is the failure ADR-0041 calls the expensive one.
    if [[ $OPT_ONLY_IF_EMPTY -eq 1 && ${#RECORDED_CHECKSUM[@]} -gt 0 ]]; then
        echo -e "${GREEN}'$DB' already records ${#RECORDED_CHECKSUM[@]} migration(s); leaving it alone.${NC}"
        return 0
    fi

    collect_pending

    local base checksum
    local -a chosen=()
    for base in "${PENDING[@]+"${PENDING[@]}"}"; do
        # Zero-padded three-digit numbers, so comparing them as strings and as
        # numbers is the same comparison.
        if [[ -n "$OPT_THROUGH" && "${base:0:3}" > "$OPT_THROUGH" ]]; then
            continue
        fi
        chosen+=("$base")
    done

    if [[ ${#chosen[@]} -eq 0 ]]; then
        echo -e "${GREEN}Nothing to baseline on '$DB'.${NC}"
        return 0
    fi

    echo -e "${YELLOW}Recording ${#chosen[@]} migration(s) on '$DB' as applied WITHOUT running them.${NC}"
    echo -e "${YELLOW}This asserts that '$DB' already carries what they do. Nothing verifies it.${NC}"

    # One transaction: a baseline is a single statement about the database, and
    # half of it recorded would be a worse record than none.
    TMP_SQL="$(mktemp)"
    echo "BEGIN;" > "$TMP_SQL"
    for base in "${chosen[@]}"; do
        # Assigned before it is passed on, for the reason cmd_status states: a
        # command substitution that fails in an argument list leaves the command
        # to run without it, and an empty checksum would go into the ledger.
        checksum="$(file_checksum "$MIGRATIONS_DIR/$base")"
        record_sql "$base" "$checksum" FALSE >> "$TMP_SQL"
        echo "" >> "$TMP_SQL"
        echo "    $base"
    done
    echo "COMMIT;" >> "$TMP_SQL"

    if psql_cmd -d "$DB" -v ON_ERROR_STOP=1 -q -f "$TMP_SQL"; then
        cleanup
        echo -e "${GREEN}Recorded ${#chosen[@]} migration(s) as baselined.${NC}"
    else
        cleanup
        die "Baseline failed; nothing was recorded."
    fi
}

# =============================================================================
# Main
# =============================================================================

COMMAND="${1:-help}"
shift || true

OPT_DATABASE=""
OPT_THROUGH=""
OPT_ONLY_IF_EMPTY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --database)
            OPT_DATABASE="${2:-}"
            [[ -n "$OPT_DATABASE" ]] || die "--database needs a name."
            shift 2
            ;;
        --through)
            OPT_THROUGH="${2:-}"
            [[ -n "$OPT_THROUGH" ]] || die "--through needs a migration number."
            shift 2
            ;;
        --only-if-empty)
            OPT_ONLY_IF_EMPTY=1
            shift
            ;;
        *)
            die "Unknown option: $1"
            ;;
    esac
done

if [[ "$COMMAND" == "help" || "$COMMAND" == "--help" || "$COMMAND" == "-h" ]]; then
    echo "Migration runner"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  status      What is applied, what is pending, what has drifted"
    echo "  apply       Apply every pending migration, in filename order"
    echo "  baseline    Record pending migrations as applied without running them"
    echo ""
    echo "Options:"
    echo "  --database <name>   Act on this database instead of the active one"
    echo "  --through <NNN>     baseline only: stop after this migration number"
    echo "  --only-if-empty     baseline only: do nothing unless the ledger is empty"
    echo ""
    exit 0
fi

if [[ $OPT_ONLY_IF_EMPTY -eq 1 && "$COMMAND" != "baseline" ]]; then
    die "--only-if-empty applies to baseline; $COMMAND does not record anything unasked."
fi

if [[ -n "$OPT_THROUGH" ]]; then
    # Refused rather than ignored where it means nothing: an option that is
    # quietly dropped reads, to whoever passed it, as one that was obeyed.
    if [[ "$COMMAND" != "baseline" ]]; then
        die "--through applies to baseline; $COMMAND applies every pending migration."
    fi
    if [[ ! "$OPT_THROUGH" =~ ^[0-9]{3}$ ]]; then
        die "--through takes a three-digit migration number, e.g. --through 040."
    fi
fi

load_env
validate_migration_names

declare -A RECORDED_CHECKSUM=()
declare -A RECORDED_RAN=()
declare -a PENDING=()

DB="$(resolve_database)"

case "$COMMAND" in
    status)
        cmd_status
        ;;
    apply)
        cmd_apply
        ;;
    baseline)
        cmd_baseline
        ;;
    *)
        die "Unknown command: $COMMAND (try '$0 help')"
        ;;
esac
