# GADM loader image. The GDAL Python bindings (osgeo) come from the base image;
# we add the Postgres + dotenv + shapely deps via apt (the base image ships no
# pip), so `npm run db:load-gadm` needs no host Python or GDAL at all. The loader
# scripts are bind-mounted at runtime (db-loader service in docker-compose.yml),
# so nothing is COPYed here.
FROM ghcr.io/osgeo/gdal:ubuntu-small-3.9.3

# Installed into the same system interpreter that already holds the GDAL bindings.
# Versions track the pinned GDAL base image's Ubuntu release, so they are not
# individually pinned here.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3-psycopg2 \
        python3-dotenv \
        python3-shapely \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
