#!/bin/bash
set -e

if [ "$RUN_INIT" != "true" ]; then
  echo "Skipping init-db.sh"
  exit 0
fi

echo "Running init-db.sh..."
python3 -u /tmp/init-regions-table.py -s /data/gadm/gadm.gpkg --geometry
echo "init-db.sh complete"
