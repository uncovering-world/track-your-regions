#!/bin/bash
set -e

echo "Creating database..."
python3 -u /tmp/init-regions-table.py /data/gadm/gadm.gpkg

echo "Done."

