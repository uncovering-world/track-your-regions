#!/bin/bash
set -e

# Import GPKG file into PostGIS
ogr2ogr -f "PostgreSQL" PG:"dbname=$POSTGRES_DB user=$POSTGRES_USER password=$POSTGRES_PASSWORD" "/tmp/gadm.gpkg"
