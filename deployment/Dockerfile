FROM postgis/postgis:16-3.4

# Prepare apt-get
RUN apt-get update && \
    apt-get install -y python3 python3-pip \
    gdal-bin libgdal-dev \
    locales \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Configure environment variables for GDAL
ENV GDAL_CONFIG=/usr/bin/gdal-config
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# Copy initialization scripts and GPKG file
COPY ./init-db.sh /docker-entrypoint-initdb.d/init-db.sh

# Install python requirements
COPY ./init-db/requirements.txt /tmp/
RUN pip3 install -r /tmp/requirements.txt


# Define a volume
VOLUME /data/gadm

# Run PostgreSQL on default port
EXPOSE 5432

RUN localedef -i en_US -c -f UTF-8 -A /usr/share/locale/locale.alias en_US.UTF-8
ENV LANG en_US.utf8

# Use the .env file to set the environment variables
ENV POSTGRES_DB=$DB_NAME
ENV POSTGRES_USER=$DB_USER
ENV POSTGRES_PASSWORD=$DB_PASSWORD

# Copy the .env file to the container
COPY .env* /

# Copy the init script to the container
COPY ./init-db/init-regions-table.py /tmp/

# Make the init script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh

USER postgres

CMD ["postgres"]
