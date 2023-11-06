FROM postgis/postgis:16-3.4

# Prepare apt-get
RUN apt-get update

# Install python3 and pip3
RUN apt-get install -y python3 python3-pip

# Copy initialization scripts and GPKG file
COPY ./init-db.sh /docker-entrypoint-initdb.d/init-db.sh

# Copy the init script to the container
COPY ./init-db/* /tmp/

# Install GDAL
RUN apt-get install -y gdal-bin libgdal-dev

ENV GDAL_CONFIG=/usr/bin/gdal-config
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# Install python requirements
RUN pip3 install -r /tmp/requirements.txt

# Make the init script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh

# Define a volume
VOLUME /data/gadm

# Run PostgreSQL on default port
EXPOSE 5432

# Set the locale
RUN apt-get install -y locales
RUN localedef -i en_US -c -f UTF-8 -A /usr/share/locale/locale.alias en_US.UTF-8
ENV LANG en_US.utf8

# Clean up
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Use the .env file to set the environment variables
ENV POSTGRES_DB=$DB_NAME
ENV POSTGRES_USER=$DB_USER
ENV POSTGRES_PASSWORD=$DB_PASSWORD

# Copy the .env file to the container
COPY .env* /

USER postgres

CMD ["postgres"]
