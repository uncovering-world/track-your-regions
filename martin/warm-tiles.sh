#!/bin/bash
# Pre-warm PostGIS tile cache for custom world views
#
# This script curls z=0-2 tiles for all custom world views to warm the
# database buffer cache. This reduces cold tile request times from ~1200ms
# to ~2ms for subsequent requests.
#
# Usage: ./warm-tiles.sh [martin_url] [backend_url]
#   martin_url:  Martin tile server URL (default: http://localhost:3000)
#   backend_url: Backend API URL (default: http://localhost:3001)

MARTIN_URL="${1:-http://localhost:3000}"
BACKEND_URL="${2:-http://localhost:3001}"

echo "Warming tile cache..."
echo "  Martin URL:  $MARTIN_URL"
echo "  Backend URL: $BACKEND_URL"

# Wait for Martin to be ready
echo "Waiting for Martin to be ready..."
until curl -s "${MARTIN_URL}/health" > /dev/null 2>&1; do
  sleep 1
done
echo "Martin is ready."

# Wait for backend to be ready
echo "Waiting for backend to be ready..."
until curl -s "${BACKEND_URL}/api/world-views" > /dev/null 2>&1; do
  sleep 1
done
echo "Backend is ready."

# Get custom world view IDs from API (non-default world views)
WORLD_VIEWS=$(curl -s "${BACKEND_URL}/api/world-views" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    for w in data:
        if not w.get('isDefault', False):
            print(w['id'])
except Exception as e:
    print(f'Error parsing world views: {e}', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null)

if [ -z "$WORLD_VIEWS" ]; then
  echo "No custom world views found. Nothing to warm."
  exit 0
fi

echo "Found custom world views: $(echo $WORLD_VIEWS | tr '\n' ' ')"

# Pre-warm z=0-2 tiles for each custom world view
# These are the zoom levels visible on initial page load
TOTAL=0
for wv in $WORLD_VIEWS; do
  echo "Warming tiles for world view $wv..."
  for z in 0 1 2; do
    max=$((1 << z))
    for x in $(seq 0 $((max - 1))); do
      for y in $(seq 0 $((max - 1))); do
        curl -s "${MARTIN_URL}/tile_world_view_all_leaf_regions/${z}/${x}/${y}?world_view_id=${wv}" > /dev/null &
        TOTAL=$((TOTAL + 1))
      done
    done
  done
done

# Wait for all background requests to complete
wait

echo "Tile cache warmed! ($TOTAL tiles)"
