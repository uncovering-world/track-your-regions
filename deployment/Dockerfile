# First stage: Use Ubuntu to install GDAL, it's used by Fiona
FROM ubuntu:22.04 AS gdal-stage
RUN apt-get update && \
    apt-get install -y gdal-bin libgdal-dev libarmadillo10

# Second stage: Use PostgreSQL image
FROM postgres:16.0

# Copy GDAL files from first stage, and set GDAL environment variables
COPY --from=gdal-stage /usr/bin/gdal* /usr/bin/
COPY --from=gdal-stage /usr/lib/libgdal* /usr/lib/
COPY --from=gdal-stage /usr/include/gdal /usr/include/gdal
ENV GDAL_CONFIG=/usr/bin/gdal-config
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# Copy other libraries from first stage, also needed by Fiona
COPY --from=gdal-stage /usr/lib/libarmadillo.so.10 /usr/lib/
COPY --from=gdal-stage /usr/lib/x86_64-linux-gnu/libpoppler.so.118 /usr/lib/x86_64-linux-gnu/

# Install python3 and pip3
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv libpq-dev libheif1 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy initialization scripts and GPKG file
COPY ./init-db.sh /docker-entrypoint-initdb.d/init-db.sh

# Copy the init script to the container
COPY ./init-db/* /tmp/


# Create a virtual environment and activate it
RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"

# Install python requirements
RUN pip3 install -r /tmp/requirements.txt
RUN pip install GDAL==`gdal-config --version`

# Make the init script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh

# Copy the GADM file to the container
ARG GADM_FILE
COPY $GADM_FILE /tmp/gadm.gpkg

# Run PostgreSQL on default port
EXPOSE 5432

RUN apt-get update && apt-get install -y locales && \
    localedef -i en_US -c -f UTF-8 -A /usr/share/locale/locale.alias en_US.UTF-8
ENV LANG en_US.utf8


# Use the .env file to set the environment variables
ENV POSTGRES_DB=$DB_NAME
ENV POSTGRES_USER=$DB_USER
ENV POSTGRES_PASSWORD=$DB_PASSWORD

# Copy the .env file to the container
COPY .env /tmp/.env

USER postgres

CMD ["postgres"]