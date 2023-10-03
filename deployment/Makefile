# Name of the Docker Compose project
PROJECT_NAME = tyr_postgis

# Build the Docker image using docker-compose
build:
	docker-compose build

# Run the Docker container using docker-compose and forward the PostgreSQL port
run:
	docker-compose up -d

# Initialize the PostGIS database and import GPKG file
init-db: build run
	@echo "Database initialized and GPKG file imported."

# Forcefully re-initialize the database
reinit-db: clean-volume init-db
	@echo "Database forcefully re-initialized."

# Stop and remove the Docker container
clean-container:
	docker-compose down

clean-volume:
	docker-compose down -v

# Remove the Docker image
clean-image:
	docker-compose down --rmi all

# Remove the Docker container and image
clean-all: clean-container clean-image clean-volume

stop:
	docker-compose stop

start: init-db

.PHONY: build run init-db init-force clean-container clean-image clean-all reinit-db clean-volume
