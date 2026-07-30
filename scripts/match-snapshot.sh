#!/usr/bin/env bash
# =============================================================================
# Match outcome snapshot — per-region, for scoring matcher changes
# =============================================================================
# Usage: ./scripts/match-snapshot.sh <world_view_id> [output_file]
#
# Writes one line per region:
#
#   <region_id>|<match_status>|<division_ids>|<region_name>
#
# sorted by region_id, so two snapshots are directly comparable with `diff`.
# `division_ids` is a comma-separated, ascending list of the divisions bound in
# region_members ("-" when none), which keeps the format honest for sources
# whose regions legitimately span several divisions.
#
# Why per-region rather than a count: a single total (e.g. "2372 of 3831") is
# too coarse to review a matcher change, because two different defects can
# produce the same total. The line-level diff distinguishes an improvement
# (no_candidates -> auto_matched) from a regression (the reverse) and from the
# class that hides real damage — an auto_matched region whose division_ids
# changed while its status did not.
#
# Companion summary is printed to stderr so it never pollutes the diffable file.
# =============================================================================

set -euo pipefail

WORLD_VIEW_ID="${1:-}"
OUTPUT_FILE="${2:-}"
CONTAINER="${TYR_DB_CONTAINER:-tyr-ng-db}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolve the database the same way db-cli.sh does, because that is where the repo
# records which one is active: the .active-db pointer written by `npm run db:use`,
# then DB_NAME from .env, then the literal. Reading an exported DB_NAME is not
# enough — .env is a file, not an environment — so after `npm run db:use scratch`
# a snapshot would silently describe track_regions under the scratch DB's name,
# which is exactly the quiet-wrong-answer this script exists to prevent.
resolve_db_name() {
  if [ -n "${TYR_DB_NAME:-}" ]; then
    printf '%s' "$TYR_DB_NAME"
    return
  fi
  if [ -f "$PROJECT_ROOT/.active-db" ]; then
    tr -d '[:space:]' < "$PROJECT_ROOT/.active-db"
    return
  fi
  if [ -f "$PROJECT_ROOT/.env" ]; then
    local line value
    line="$(grep -E '^[[:space:]]*DB_NAME=' "$PROJECT_ROOT/.env" | tail -1)"
    if [ -n "$line" ]; then
      value="${line#*=}"
      value="${value%%#*}"
      value="$(printf '%s' "$value" | tr -d "[:space:]\"'")"
      if [ -n "$value" ]; then
        printf '%s' "$value"
        return
      fi
    fi
  fi
  printf '%s' "${DB_NAME:-track_regions}"
}

DB_NAME="$(resolve_db_name)"

if [ -z "$WORLD_VIEW_ID" ]; then
  echo "Usage: $0 <world_view_id> [output_file]" >&2
  exit 1
fi

if ! [[ "$WORLD_VIEW_ID" =~ ^[0-9]+$ ]]; then
  echo "Error: world_view_id must be a number, got '$WORLD_VIEW_ID'" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Error: database container '$CONTAINER' is not running." >&2
  echo "Start the stack with 'npm run dev', or set TYR_DB_CONTAINER." >&2
  exit 1
fi

# -A unaligned, -t tuples only, -F| explicit separator: stable, diffable output.
# The name is escaped, not trusted: it is admin-supplied, and a region called
# "Foo|Bar" or one carrying a newline would otherwise split a record or break the
# one-line-per-region format the diff depends on. Backslash first, so the escape
# character itself round-trips.
snapshot_sql="
SELECT r.id
       || '|' || COALESCE(ris.match_status, '-')
       || '|' || COALESCE((
            SELECT string_agg(rm.division_id::text, ',' ORDER BY rm.division_id)
            FROM region_members rm WHERE rm.region_id = r.id
          ), '-')
       || '|' || replace(replace(replace(replace(
            r.name, '\\', '\\\\'), '|', '\\|'), E'\n', '\\n'), E'\r', '\\r')
FROM regions r
LEFT JOIN region_import_state ris ON ris.region_id = r.id
WHERE r.world_view_id = ${WORLD_VIEW_ID}
ORDER BY r.id;
"

summary_sql="
SELECT COALESCE(ris.match_status, '-') AS match_status,
       count(*) AS regions,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM region_members rm WHERE rm.region_id = r.id
       )) AS with_member
FROM regions r
LEFT JOIN region_import_state ris ON ris.region_id = r.id
WHERE r.world_view_id = ${WORLD_VIEW_ID}
GROUP BY 1
ORDER BY 2 DESC;
"

snapshot=$(docker exec -i "$CONTAINER" psql -U postgres -d "$DB_NAME" -A -t -F'|' -c "$snapshot_sql")

if [ -z "$snapshot" ]; then
  echo "Error: world view ${WORLD_VIEW_ID} has no regions (does it exist?)." >&2
  exit 1
fi

if [ -n "$OUTPUT_FILE" ]; then
  printf '%s\n' "$snapshot" > "$OUTPUT_FILE"
  echo "Snapshot of world view ${WORLD_VIEW_ID}: $(printf '%s\n' "$snapshot" | wc -l) regions -> ${OUTPUT_FILE}" >&2
else
  printf '%s\n' "$snapshot"
fi

{
  echo
  echo "World view ${WORLD_VIEW_ID} summary:"
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB_NAME" -c "$summary_sql"
} >&2
