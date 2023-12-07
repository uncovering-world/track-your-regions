# Start from the PostGIS image
FROM postgis/postgis:latest

LABEL org.opencontainers.image.source=https://github.com/ohmspectator/track-your-regions
LABEL org.opencontainers.image.description="Track Your Regions database image"
LABEL org.opencontainers.image.licenses=Apache-2.0

# Set environment variables if needed
ENV POSTGRES_DB your_db_name
ENV POSTGRES_USER your_db_user
ENV POSTGRES_PASSWORD your_db_password

ARG DB_DUMP_FILE

# Copy the database dump file into the container
COPY $DB_DUMP_FILE /tmp/db.dump

# Volume to store the database data
VOLUME /var/lib/postgresql/data

# Use a custom script to initialize the database
COPY ./db-image/restore-db.sh /docker-entrypoint-initdb.d/

# Expose the PostgreSQL port
EXPOSE 5432
