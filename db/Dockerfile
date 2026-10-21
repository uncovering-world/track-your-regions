# GADM loader image. The GDAL Python bindings (osgeo) come from the base image;
# we add the Postgres and shapely deps via apt (the base image ships no pip), so
# `npm run db:load-gadm` needs no host Python or GDAL at all. No python-dotenv:
# the compose service passes the database settings as environment variables, and
# the loaders read a .env only where the package is installed (#1782). The loader
# scripts are bind-mounted at runtime (db-loader service in docker-compose.yml),
# so they are not COPYed here; only the version check below is.
FROM ghcr.io/osgeo/gdal:ubuntu-small-3.13.3

# Installed into the same system interpreter that already holds the GDAL bindings.
# Versions track the pinned GDAL base image's Ubuntu release, so they are not
# individually pinned here; db/requirements.txt states them, for the audit
# (`npm run security:py:deps`), and moves with this base image.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3-psycopg2 \
        python3-shapely \
 && rm -rf /var/lib/apt/lists/*

# The versions the audit reads must be the ones installed: the build fails where
# db/requirements.txt and the image disagree, as after a base-image bump.
COPY requirements.txt check_image_versions.py /tmp/image-pins/
RUN python3 /tmp/image-pins/check_image_versions.py /tmp/image-pins/requirements.txt \
 && rm -rf /tmp/image-pins

WORKDIR /app
