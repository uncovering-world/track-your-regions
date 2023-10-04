# Name of the Docker Compose project
PROJECT_NAME = tyr_postgis

include .env

REQUIRED_ENV_VARS = POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD GADM_FILE

check-env:
	@if [ ! -f .env ]; then \
		echo "Error: .env file is missing. Initialize it from .env.example."; \
		exit 1; \
	fi
	@for var in $(REQUIRED_ENV_VARS); do \
		awk -F '=' -v key="$$var" '$$1 == key { if ($$2 == "" || $$2 == "<set_your_db_name>" || $$2 == "<set_your_db_user>" || $$2 == "<set_your_db_password>" || $$2 == "<set_path_to_your_gadm_file>") exit 1 }' .env || { echo "Error: $$var is not set or empty in .env"; exit 1; }; \
	done

# Check the GADM file path
check-gadm-file:
	@if [ ! -f $(GADM_FILE) ]; then \
		echo "Error: GADM file is missing. Set the correct path to the GADM file in .env."; \
		exit 1; \
	fi

# Build the Docker image using docker-compose
build: check-env
	docker-compose build

# Run the Docker container using docker-compose and forward the PostgreSQL port
run:
	docker-compose up -d

# Initialize the PostGIS database and import GPKG file
init-db: check-gadm-file build run
	@echo "Database initialized and GPKG file imported."

# Forcefully re-initialize the database
reinit-db: check-gadm-file clean-volume init-db
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
