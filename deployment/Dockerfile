FROM postgis/postgis:latest

# Read the .env file
ARG POSTGRES_DB
ARG POSTGRES_USER
ARG POSTGRES_PASSWORD
ARG GADM_FILE

# Copy initialization scripts and GPKG file
COPY ./init-db.sh /docker-entrypoint-initdb.d/init-db.sh

# Copy the GADM file to the container
COPY $GADM_FILE /tmp/gadm.gpkg

# Make the init script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh

# Install GDAL
RUN apt-get update && apt-get install -y gdal-bin

# Run PostgreSQL on default port
EXPOSE 5432

# Use the .env file to set the environment variables
ENV POSTGRES_DB=$POSTGRES_DB
ENV POSTGRES_USER=$POSTGRES_USER
ENV POSTGRES_PASSWORD=$POSTGRES_PASSWORD

CMD ["postgres"]
