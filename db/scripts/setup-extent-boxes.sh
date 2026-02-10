#!/bin/bash
# Setup script for extent boxes feature
# Usage: ./setup-extent-boxes.sh [world-view-id]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$DB_DIR/migrations"
TESTS_DIR="$DB_DIR/tests"

# Load environment variables if .env exists
if [ -f "$DB_DIR/../.env" ]; then
    source "$DB_DIR/../.env"
fi

# Default database connection (can be overridden by environment)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-track_regions}"
DB_USER="${DB_USER:-postgres}"

echo "=== Extent Boxes Setup ==="
echo "Database: $DB_NAME@$DB_HOST:$DB_PORT"
echo ""

# Step 1: Run migration
echo "Step 1: Running migration 005-extent-boxes.sql..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -f "$MIGRATIONS_DIR/005-extent-boxes.sql"
echo "Migration complete."
echo ""

# Step 2: Generate extent boxes
echo "Step 2: Generating extent boxes..."
if [ -n "$1" ]; then
    echo "Processing world view ID: $1"
    python3 "$SCRIPT_DIR/generate_extent_boxes.py" --world-view-id="$1"
else
    echo "Processing all archipelago regions..."
    python3 "$SCRIPT_DIR/generate_extent_boxes.py" --all
fi
echo ""

# Step 3: Run validation tests
echo "Step 3: Running validation tests..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -f "$TESTS_DIR/extent-box-invariants.sql"
echo ""

echo "=== Setup Complete ==="
