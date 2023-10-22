#!/bin/bash
set -e

echo "Creating database..."
python3 /tmp/init-regions-table.py /data/gadm/gadm.gpkg

echo "Done."

