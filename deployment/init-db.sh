#!/bin/bash
set -e

# Connect to the PostgreSQL database and create the 'gadm' schema if it doesn't exist
echo "Creating gadm schema..."
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE SCHEMA IF NOT EXISTS gadm;"

# Import GPKG file into PostGIS, specify the schema as 'gadm'
echo "Importing GPKG file into PostGIS..."
ogr2ogr -f "PostgreSQL" PG:"dbname=$POSTGRES_DB user=$POSTGRES_USER password=$POSTGRES_PASSWORD" "/tmp/gadm.gpkg" -lco SCHEMA=gadm

echo "Done."

