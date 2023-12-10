ARG POSTGIS_VERSION

# Start from the PostGIS image
FROM postgis/postgis:$POSTGIS_VERSION

ARG DB_DUMP_FILE

LABEL org.opencontainers.image.source=https://github.com/ohmspectator/track-your-regions
LABEL org.opencontainers.image.description="Track Your Regions database image"
LABEL org.opencontainers.image.licenses=Apache-2.0

# Copy the database dump file into the container
COPY --chown=postgres:postgres $DB_DUMP_FILE /tmp/db.dump

# Volume to store the database data
VOLUME /var/lib/postgresql/data

# Use a custom script to initialize the database
COPY ./db-image/restore-db.sh /docker-entrypoint-initdb.d/

# Expose the PostgreSQL port
EXPOSE 5432
