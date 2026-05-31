#!/usr/bin/env bash
# =============================================================================
# Database Management CLI for Track Your Regions
# =============================================================================
# Usage: ./scripts/db-cli.sh <command> [args]
#
# Commands:
#   create [name]     - Create new database and switch to it
#   list              - List all databases
#   use <name>        - Switch to a different database
#   drop <name>       - Drop a database (fails if golden)
#   mark-golden       - Mark current DB as protected
#   unmark-golden     - Remove golden protection
#   load-gadm         - Load GADM data into current DB
#   shell             - Open psql to current DB
#   status            - Show current DB info and row counts
#   dump [file]       - Dump current DB to file
#   restore <file>    - Restore DB from dump file
#   up                - Start the PostgreSQL container
#   down              - Stop the PostgreSQL container
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# File paths (relative to project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ACTIVE_DB_FILE="$PROJECT_ROOT/.active-db"
GOLDEN_DB_FILE="$PROJECT_ROOT/.golden-db"
ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

# GADM 4.1 world GeoPackage (zipped). Landing page:
# https://gadm.org/download_world.html . Update here if GADM moves the file.
GADM_DOWNLOAD_URL="https://geodata.ucdavis.edu/gadm/gadm4.1/gadm_410-gpkg.zip"

# Load environment variables
load_env() {
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        # shellcheck source=/dev/null
        source "$ENV_FILE"
        set +a
    elif [[ -f "$ENV_EXAMPLE" ]]; then
        echo -e "${YELLOW}Warning: .env not found, using .env.example defaults${NC}"
        set -a
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

# Get golden database name (if set)
get_golden_db() {
    if [[ -f "$GOLDEN_DB_FILE" ]]; then
        cat "$GOLDEN_DB_FILE"
    else
        echo ""
    fi
}

# Check if a database is the golden one
is_golden() {
    local db_name="$1"
    local golden
    golden=$(get_golden_db)
    [[ -n "$golden" && "$golden" == "$db_name" ]]
}

# Update DB_NAME in .env file
update_env_db_name() {
    local db_name="$1"

    if [[ ! -f "$ENV_FILE" ]]; then
        # Create .env from example if it doesn't exist
        if [[ -f "$ENV_EXAMPLE" ]]; then
            cp "$ENV_EXAMPLE" "$ENV_FILE"
        else
            echo "DB_NAME=$db_name" > "$ENV_FILE"
            return
        fi
    fi

    # Update or add DB_NAME in .env
    if grep -q "^DB_NAME=" "$ENV_FILE"; then
        # Replace existing DB_NAME
        sed -i "s/^DB_NAME=.*/DB_NAME=$db_name/" "$ENV_FILE"
    else
        # Add DB_NAME if not present
        echo "DB_NAME=$db_name" >> "$ENV_FILE"
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

# Check if database exists
db_exists() {
    local db_name="$1"
    psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$db_name'" 2>/dev/null | grep -q 1
}

table_exists() {
    local db_name="$1"
    local table_name="$2"
    local exists
    exists=$(psql_cmd -d "$db_name" -tAc "SELECT to_regclass('public.${table_name}') IS NOT NULL" 2>/dev/null | tr -d '[:space:]')
    [[ "$exists" == "t" ]]
}

table_count() {
    local db_name="$1"
    local table_name="$2"
    if table_exists "$db_name" "$table_name"; then
        psql_cmd -d "$db_name" -tAc "SELECT COUNT(*) FROM ${table_name}" 2>/dev/null || echo "0"
    else
        echo "n/a"
    fi
}

table_count_where() {
    local db_name="$1"
    local table_name="$2"
    local where_clause="$3"
    if table_exists "$db_name" "$table_name"; then
        psql_cmd -d "$db_name" -tAc "SELECT COUNT(*) FROM ${table_name} WHERE ${where_clause}" 2>/dev/null || echo "0"
    else
        echo "n/a"
    fi
}

# =============================================================================
# Commands
# =============================================================================

cmd_up() {
    echo -e "${BLUE}Starting PostgreSQL container...${NC}"
    cd "$PROJECT_ROOT"
    docker compose up -d db
    echo -e "${GREEN}PostgreSQL is running.${NC}"
}

cmd_down() {
    echo -e "${BLUE}Stopping PostgreSQL container...${NC}"
    cd "$PROJECT_ROOT"
    docker compose down
    echo -e "${GREEN}PostgreSQL stopped.${NC}"
}

cmd_create() {
    local db_name="$1"

    # Generate name if not provided
    if [[ -z "$db_name" ]]; then
        db_name="track_regions_$(date +%Y%m%d_%H%M)"
    fi

    echo -e "${BLUE}Creating database: ${NC}$db_name"

    if db_exists "$db_name"; then
        echo -e "${RED}Error: Database '$db_name' already exists.${NC}"
        exit 1
    fi

    # Create database
    psql_admin -c "CREATE DATABASE \"$db_name\"" || {
        echo -e "${RED}Error: Failed to create database.${NC}"
        exit 1
    }

    # Enable PostGIS and run schema
    echo -e "${BLUE}Initializing schema...${NC}"
    psql_cmd -d "$db_name" -f "$PROJECT_ROOT/db/init/01-schema.sql" > /dev/null

    # Switch to this database
    echo "$db_name" > "$ACTIVE_DB_FILE"
    update_env_db_name "$db_name"

    echo -e "${GREEN}Created and switched to database: $db_name${NC}"
    echo -e "${YELLOW}Next step: npm run db:load-gadm${NC}"
}

cmd_list() {
    echo -e "${BLUE}Databases:${NC}"
    echo ""

    local active golden
    active=$(get_active_db)
    golden=$(get_golden_db)

    # List all non-system databases (exclude postgres, template0, template1)
    psql_admin -tAc "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres', 'template0', 'template1') ORDER BY datname" | while read -r db; do
        local marker=""
        if [[ "$db" == "$active" ]]; then
            marker="${GREEN}* (active)${NC}"
        fi
        if [[ "$db" == "$golden" ]]; then
            marker="$marker ${YELLOW}[GOLDEN]${NC}"
        fi
        echo -e "  $db $marker"
    done

    echo ""
    if [[ -z "$active" ]]; then
        echo -e "${YELLOW}No active database set. Use 'npm run db:use <name>' or 'npm run db:create'${NC}"
    fi
}

cmd_use() {
    local db_name="$1"

    if [[ -z "$db_name" ]]; then
        echo -e "${RED}Error: Database name required.${NC}"
        echo "Usage: npm run db:use <name>"
        exit 1
    fi

    if ! db_exists "$db_name"; then
        echo -e "${RED}Error: Database '$db_name' does not exist.${NC}"
        echo "Use 'npm run db:list' to see available databases."
        exit 1
    fi

    echo "$db_name" > "$ACTIVE_DB_FILE"
    update_env_db_name "$db_name"
    echo -e "${GREEN}Switched to database: $db_name${NC}"

    if is_golden "$db_name"; then
        echo -e "${YELLOW}Note: This is the golden (protected) database.${NC}"
    fi

    # Restart Martin container if it's running (so it picks up the new DB)
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "tyr-ng-martin"; then
        echo -e "${BLUE}Restarting Martin tile server...${NC}"
        cd "$PROJECT_ROOT"
        docker compose restart martin > /dev/null 2>&1
        echo -e "${GREEN}Martin restarted with new database.${NC}"
    fi
}

cmd_drop() {
    local db_name="$1"

    if [[ -z "$db_name" ]]; then
        echo -e "${RED}Error: Database name required.${NC}"
        echo "Usage: npm run db:drop <name>"
        exit 1
    fi

    # Check if golden
    if is_golden "$db_name"; then
        echo -e "${RED}Error: Cannot drop golden database '$db_name'.${NC}"
        echo "Use 'npm run db:unmark-golden' first if you really want to drop it."
        exit 1
    fi

    if ! db_exists "$db_name"; then
        echo -e "${RED}Error: Database '$db_name' does not exist.${NC}"
        exit 1
    fi

    # Confirm
    echo -e "${YELLOW}Warning: This will permanently delete database '$db_name'.${NC}"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi

    # Terminate connections
    psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db_name'" > /dev/null 2>&1 || true

    # Drop database
    psql_admin -c "DROP DATABASE \"$db_name\"" || {
        echo -e "${RED}Error: Failed to drop database.${NC}"
        exit 1
    }

    # Clear active if it was the dropped one
    local active
    active=$(get_active_db)
    if [[ "$active" == "$db_name" ]]; then
        rm -f "$ACTIVE_DB_FILE"
        # Reset DB_NAME in .env to default
        update_env_db_name "track_regions"
        echo -e "${YELLOW}Note: Active database was unset. DB_NAME reset to 'track_regions'.${NC}"
        echo -e "${YELLOW}Use 'npm run db:use <name>' to set a new one.${NC}"
    fi

    echo -e "${GREEN}Dropped database: $db_name${NC}"
}

cmd_mark_golden() {
    local active
    active=$(get_active_db)

    if [[ -z "$active" ]]; then
        echo -e "${RED}Error: No active database. Use 'npm run db:use <name>' first.${NC}"
        exit 1
    fi

    echo "$active" > "$GOLDEN_DB_FILE"
    echo -e "${GREEN}Marked '$active' as golden (protected).${NC}"
}

cmd_unmark_golden() {
    local golden
    golden=$(get_golden_db)

    if [[ -z "$golden" ]]; then
        echo -e "${YELLOW}No golden database is currently set.${NC}"
        exit 0
    fi

    rm -f "$GOLDEN_DB_FILE"
    echo -e "${GREEN}Removed golden protection from '$golden'.${NC}"
}

# Download + unzip a GADM gpkg into deployment/. Echoes the resulting path on
# stdout; all progress goes to stderr so the captured path stays clean.
download_gadm() {
    local url="$1"
    local dest_dir="$PROJECT_ROOT/deployment"
    local zip="$dest_dir/gadm_410-gpkg.zip"
    mkdir -p "$dest_dir"
    echo -e "${BLUE}Downloading GADM from: $url${NC}" >&2
    if ! curl -fSL --retry 2 -o "$zip" "$url"; then
        echo -e "${RED}Download failed from: $url${NC}" >&2
        return 1
    fi
    echo -e "${BLUE}Unzipping...${NC}" >&2
    if ! unzip -o "$zip" -d "$dest_dir" >&2; then
        echo -e "${RED}Unzip failed (not a valid zip?).${NC}" >&2
        return 1
    fi
    rm -f "$zip"
    local gpkg
    gpkg="$(find "$dest_dir" -maxdepth 1 -name 'gadm_410*.gpkg' | head -1)"
    if [[ -z "$gpkg" || ! -s "$gpkg" ]]; then
        echo -e "${RED}No non-empty gadm_410*.gpkg found after unzip.${NC}" >&2
        return 1
    fi
    echo "$gpkg"
}

cmd_load_gadm() {
    local active
    active=$(get_active_db)

    if [[ -z "$active" ]]; then
        echo -e "${RED}Error: No active database. Use 'npm run db:use <name>' or 'npm run db:create' first.${NC}"
        exit 1
    fi

    echo -e "${BLUE}Loading GADM data into: $active${NC}"

    # Find GADM file
    local gadm_file=""
    for path in "$PROJECT_ROOT/deployment/gadm_410.gpkg" "$HOME/gadm_410.gpkg"; do
        if [[ -f "$path" ]]; then
            gadm_file="$path"
            break
        fi
    done

    if [[ -z "$gadm_file" ]]; then
        # Interactive: offer the known URL, then prompt for a custom one.
        if [[ -t 0 ]]; then
            echo -e "${YELLOW}GADM file not found in ./deployment/ or ~/.${NC}"
            read -r -p "Download it now from the known location? [Y/n]: " ans
            if [[ ! "$ans" =~ ^[Nn] ]]; then
                gadm_file="$(download_gadm "$GADM_DOWNLOAD_URL" || true)"
            fi
            if [[ -z "$gadm_file" ]]; then
                read -r -p "Enter a GADM .zip URL (blank to abort): " custom_url
                if [[ -n "$custom_url" ]]; then
                    gadm_file="$(download_gadm "$custom_url" || true)"
                fi
            fi
        fi
        if [[ -z "$gadm_file" ]]; then
            echo -e "${RED}Error: GADM file not found.${NC}"
            echo "Download gadm_410.gpkg (see https://gadm.org/download_world.html)"
            echo "into ./deployment/ or ~/, or set GADM_DOWNLOAD_URL, then re-run:"
            echo "  npm run db:load-gadm"
            exit 1
        fi
    fi

    echo -e "${BLUE}Using GADM file: $gadm_file${NC}"
    echo -e "${YELLOW}This will take approximately 30 minutes...${NC}"
    echo ""

    # The loaders run inside the db-loader container (GDAL + psycopg2 + dotenv +
    # shapely), so the host needs no Python or GDAL. The gpkg is mounted in, and
    # DB_HOST=db reaches the Postgres service over the compose network.
    cd "$PROJECT_ROOT"
    echo -e "${BLUE}Building the loader image (first run only)...${NC}"
    docker compose build db-loader

    # Step 1: Load leaf division geometries from GADM
    echo -e "${BLUE}Step 1/2: Loading leaf division geometries from GADM...${NC}"
    docker compose run --rm -T \
        -e DB_NAME="$active" -e DB_HOST=db -e DB_PORT=5432 \
        -v "$gadm_file:/data/gadm_410.gpkg:ro,z" \
        db-loader python3 /app/db/init-db.py -s /data/gadm_410.gpkg -g --skip-schema

    # Step 2: Compute parent geometries (countries, continents, etc.)
    echo ""
    echo -e "${BLUE}Step 2/2: Computing geometries for all GADM levels...${NC}"
    echo -e "${YELLOW}Merging child geometries into parents (continents, countries, states...)${NC}"
    docker compose run --rm -T \
        -e DB_NAME="$active" -e DB_HOST=db -e DB_PORT=5432 \
        db-loader python3 /app/db/precalculate-geometries.py

    echo ""
    echo -e "${GREEN}GADM data loaded successfully!${NC}"
    echo -e "${GREEN}All division levels now have geometry.${NC}"
}

cmd_shell() {
    local active
    active=$(get_active_db)

    if [[ -z "$active" ]]; then
        echo -e "${RED}Error: No active database. Use 'npm run db:use <name>' first.${NC}"
        exit 1
    fi

    echo -e "${BLUE}Connecting to: $active${NC}"
    psql_cmd -d "$active" "$@"
}

cmd_make_admin() {
    local active email
    active=$(get_active_db)
    email="$1"

    if [[ -z "$active" ]]; then
        echo -e "${RED}Error: No active database. Use 'npm run db:use <name>' first.${NC}"
        exit 1
    fi

    if [[ -z "$email" ]]; then
        echo -e "${RED}Usage: npm run db:make-admin <email>${NC}"
        exit 1
    fi

    # Run inside the db container so no host psql is required. SQL-escape the
    # operator-supplied email by doubling single quotes, then embed it directly
    # (psql variable interpolation via -c proved unreliable across versions).
    local esc_email result
    esc_email="${email//\'/\'\'}"
    result=$(docker compose exec -T db psql -U "$DB_USER" -d "$active" -t -A -v ON_ERROR_STOP=1 \
        -c "UPDATE users SET role = 'admin' WHERE email = '${esc_email}' RETURNING email, display_name;")

    if [[ -z "$result" ]]; then
        echo -e "${RED}No user found with email: $email${NC}"
        exit 1
    fi

    echo -e "${GREEN}Promoted to admin: $result${NC}"
}

cmd_dump() {
    local active dump_file
    active=$(get_active_db)
    dump_file="$1"

    if [[ -z "$active" ]]; then
        echo -e "${RED}Error: No active database. Use 'npm run db:use <name>' first.${NC}"
        exit 1
    fi

    # Generate filename if not provided
    if [[ -z "$dump_file" ]]; then
        dump_file="${active}_$(date +%Y%m%d_%H%M%S).dump"
    fi

    # Get container name
    local container="tyr-ng-db"

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "${RED}Error: Database container '$container' is not running.${NC}"
        echo "Start it with: npm run db:up"
        exit 1
    fi

    echo -e "${BLUE}Dumping database '$active' to: $dump_file${NC}"
    echo -e "${YELLOW}This may take a while for large databases...${NC}"

    # Run pg_dump inside container, output to host
    docker exec "$container" pg_dump \
        -U "$DB_USER" \
        -d "$active" \
        -Fc \
        > "$dump_file" || {
        rm -f "$dump_file"
        echo -e "${RED}Error: Failed to dump database.${NC}"
        exit 1
    }

    local size
    size=$(du -h "$dump_file" | cut -f1)
    echo -e "${GREEN}Dump complete: $dump_file ($size)${NC}"
}

cmd_restore() {
    local dump_file active
    dump_file="$1"
    active=$(get_active_db)

    if [[ -z "$dump_file" ]]; then
        echo -e "${RED}Error: Dump file required.${NC}"
        echo "Usage: npm run db:restore <file.dump>"
        exit 1
    fi

    if [[ ! -f "$dump_file" ]]; then
        echo -e "${RED}Error: File not found: $dump_file${NC}"
        exit 1
    fi

    if [[ -z "$active" ]]; then
        echo -e "${RED}Error: No active database. Use 'npm run db:use <name>' first.${NC}"
        exit 1
    fi

    # Safety check for golden
    if is_golden "$active"; then
        echo -e "${RED}Error: Cannot restore into golden database '$active'.${NC}"
        echo "Use 'npm run db:unmark-golden' first if you really want to overwrite it."
        exit 1
    fi

    # Get container name
    local container="tyr-ng-db"

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "${RED}Error: Database container '$container' is not running.${NC}"
        echo "Start it with: npm run db:up"
        exit 1
    fi

    echo -e "${YELLOW}Warning: This will REPLACE all data in '$active' with the dump.${NC}"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi

    echo -e "${BLUE}Restoring $dump_file into '$active'...${NC}"
    echo -e "${YELLOW}This may take a while for large databases...${NC}"

    # Drop and recreate database for a clean restore (avoids FK dependency issues with --clean)
    echo -e "${BLUE}Preparing clean database...${NC}"
    docker exec -i "$container" psql -U "$DB_USER" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$active' AND pid <> pg_backend_pid();" \
        > /dev/null 2>&1 || true
    docker exec -i "$container" psql -U "$DB_USER" -d postgres -c \
        "DROP DATABASE \"$active\";" > /dev/null 2>&1
    docker exec -i "$container" psql -U "$DB_USER" -d postgres -c \
        "CREATE DATABASE \"$active\";" > /dev/null 2>&1

    # Restore into the clean database
    docker exec -i "$container" pg_restore \
        -U "$DB_USER" \
        -d "$active" \
        --no-owner \
        --no-acl \
        < "$dump_file" 2>&1 | grep -v "does not exist, skipping" || true

    echo -e "${GREEN}Restore complete!${NC}"
}

cmd_status() {
    local active golden env_db
    active=$(get_active_db)
    golden=$(get_golden_db)
    env_db=""

    # Read DB_NAME from .env
    if [[ -f "$ENV_FILE" ]]; then
        env_db=$(grep "^DB_NAME=" "$ENV_FILE" 2>/dev/null | cut -d= -f2)
    fi

    echo -e "${BLUE}Database Status${NC}"
    echo "==============="
    echo ""

    if [[ -z "$active" ]]; then
        echo -e "Active DB:   ${YELLOW}(not set)${NC}"
    else
        echo -e "Active DB:   ${GREEN}$active${NC}"
    fi

    if [[ -n "$env_db" ]]; then
        if [[ "$env_db" == "$active" ]]; then
            echo -e ".env DB_NAME: $env_db ${GREEN}(synced)${NC}"
        else
            echo -e ".env DB_NAME: $env_db ${RED}(out of sync!)${NC}"
        fi
    fi

    if [[ -z "$golden" ]]; then
        echo -e "Golden DB:   ${YELLOW}(not set)${NC}"
    else
        echo -e "Golden DB:   ${YELLOW}$golden${NC}"
    fi

    echo ""

    if [[ -n "$active" ]] && db_exists "$active"; then
        echo -e "${BLUE}Core entities:${NC}"

        local div_count div_geom wv_count reg_count reg_leaf reg_geom view_count
        div_count=$(table_count "$active" "administrative_divisions")
        div_geom=$(table_count_where "$active" "administrative_divisions" "geom IS NOT NULL")
        wv_count=$(table_count "$active" "world_views")
        reg_count=$(table_count "$active" "regions")
        reg_leaf=$(table_count_where "$active" "regions" "is_leaf = true")
        reg_geom=$(table_count_where "$active" "regions" "geom IS NOT NULL")
        view_count=$(table_count "$active" "views")

        echo "  administrative_divisions: $div_count (with geometry: $div_geom)"
        echo "  world_views:              $wv_count"
        echo "  regions:                  $reg_count (leaf: $reg_leaf, with geometry: $reg_geom)"
        echo "  views:                    $view_count"

        if table_exists "$active" "world_views" && table_exists "$active" "regions"; then
            echo ""
            echo -e "${BLUE}Regions by world view:${NC}"
            local wv_breakdown
            wv_breakdown=$(psql_cmd -d "$active" -tAc "
                SELECT w.id, w.name, COUNT(r.id)
                FROM world_views w
                LEFT JOIN regions r ON r.world_view_id = w.id
                GROUP BY w.id, w.name
                ORDER BY w.id
            " 2>/dev/null || true)
            if [[ -n "$wv_breakdown" ]]; then
                while IFS='|' read -r wv_id wv_name wv_regions; do
                    [[ -z "$wv_id" ]] && continue
                    echo "  - [$wv_id] $wv_name: $wv_regions regions"
                done <<< "$wv_breakdown"
            fi
        fi

        echo ""
        echo -e "${BLUE}Experience data:${NC}"
        local exp_count exp_loc_count exp_reg_count exp_content_count exp_treasure_link_count exp_reject_count exp_curation_count
        exp_count=$(table_count "$active" "experiences")
        exp_loc_count=$(table_count "$active" "experience_locations")
        exp_reg_count=$(table_count "$active" "experience_regions")
        exp_content_count=$(table_count "$active" "treasures")
        exp_treasure_link_count=$(table_count "$active" "experience_treasures")
        exp_reject_count=$(table_count "$active" "experience_rejections")
        exp_curation_count=$(table_count "$active" "experience_curation_log")

        echo "  experiences:              $exp_count"
        echo "  experience_locations:     $exp_loc_count"
        echo "  experience_regions:       $exp_reg_count"
        echo "  treasures:                $exp_content_count"
        echo "  experience_treasures:     $exp_treasure_link_count"
        echo "  experience_rejections:    $exp_reject_count"
        echo "  experience_curation_log:  $exp_curation_count"

        if table_exists "$active" "experience_categories" && table_exists "$active" "experiences"; then
            local category_breakdown
            category_breakdown=$(psql_cmd -d "$active" -tAc "
                SELECT c.name, COUNT(e.id)
                FROM experience_categories c
                LEFT JOIN experiences e ON e.category_id = c.id
                GROUP BY c.id, c.name, c.display_priority
                ORDER BY c.display_priority, c.id
            " 2>/dev/null || true)

            if [[ -n "$category_breakdown" ]]; then
                echo "  by category:"
                while IFS='|' read -r category_name category_count; do
                    [[ -z "$category_name" ]] && continue
                    echo "    - $category_name: $category_count"
                done <<< "$category_breakdown"
            fi
        fi

        echo ""
        echo -e "${BLUE}Users & activity:${NC}"
        local user_count visited_regions_count visited_exp_count visited_loc_count viewed_content_count curator_assignment_count
        user_count=$(table_count "$active" "users")
        visited_regions_count=$(table_count "$active" "user_visited_regions")
        visited_exp_count=$(table_count "$active" "user_visited_experiences")
        visited_loc_count=$(table_count "$active" "user_visited_locations")
        viewed_content_count=$(table_count "$active" "user_viewed_treasures")
        curator_assignment_count=$(table_count "$active" "curator_assignments")

        echo "  users:                    $user_count"
        echo "  curator_assignments:      $curator_assignment_count"
        echo "  user_visited_regions:     $visited_regions_count"
        echo "  user_visited_experiences: $visited_exp_count"
        echo "  user_visited_locations:   $visited_loc_count"
        echo "  user_viewed_treasures:    $viewed_content_count"

        if table_exists "$active" "users"; then
            local role_breakdown
            role_breakdown=$(psql_cmd -d "$active" -tAc "
                SELECT role::text, COUNT(*)
                FROM users
                GROUP BY role
                ORDER BY role::text
            " 2>/dev/null || true)
            if [[ -n "$role_breakdown" ]]; then
                echo "  users by role:"
                while IFS='|' read -r role_name role_count; do
                    [[ -z "$role_name" ]] && continue
                    echo "    - $role_name: $role_count"
                done <<< "$role_breakdown"
            fi
        fi
    fi
}

# =============================================================================
# Main
# =============================================================================

load_env

command="${1:-help}"
shift || true

case "$command" in
    up)
        cmd_up
        ;;
    down)
        cmd_down
        ;;
    create)
        cmd_create "$@"
        ;;
    list)
        cmd_list
        ;;
    use)
        cmd_use "$@"
        ;;
    drop)
        cmd_drop "$@"
        ;;
    mark-golden)
        cmd_mark_golden
        ;;
    unmark-golden)
        cmd_unmark_golden
        ;;
    load-gadm)
        cmd_load_gadm
        ;;
    shell)
        cmd_shell "$@"
        ;;
    make-admin)
        cmd_make_admin "$@"
        ;;
    status)
        cmd_status
        ;;
    dump)
        cmd_dump "$@"
        ;;
    restore)
        cmd_restore "$@"
        ;;
    help|--help|-h)
        echo "Database Management CLI"
        echo ""
        echo "Usage: $0 <command> [args]"
        echo ""
        echo "Commands:"
        echo "  up              Start the PostgreSQL container"
        echo "  down            Stop the PostgreSQL container"
        echo "  create [name]   Create new database and switch to it"
        echo "  list            List all databases"
        echo "  use <name>      Switch to a different database"
        echo "  drop <name>     Drop a database (fails if golden)"
        echo "  mark-golden     Mark current DB as protected"
        echo "  unmark-golden   Remove golden protection"
        echo "  load-gadm       Load GADM data into current DB"
        echo "  make-admin <email>  Promote a user to admin"
        echo "  shell           Open psql to current DB"
        echo "  status          Show current DB info and row counts"
        echo "  dump [file]     Dump current DB to file (default: dbname_timestamp.dump)"
        echo "  restore <file>  Restore DB from dump file (replaces all data)"
        echo ""
        ;;
    *)
        echo -e "${RED}Unknown command: $command${NC}"
        echo "Use '$0 help' for usage."
        exit 1
        ;;
esac
