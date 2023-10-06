#!/bin/bash
set -e

echo "Creating database..."
python3 /tmp/init-regions-table.py /tmp/gadm.gpkg

echo "Done."

