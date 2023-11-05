#!/bin/bash
set -e

if [ "$RUN_INIT" != "true" ]; then
    echo "Skipping init-db.sh"
    exit 0
fi

echo "Creating database..."
python3 -u /tmp/init-regions-table.py /data/gadm/gadm.gpkg
echo "Done."

