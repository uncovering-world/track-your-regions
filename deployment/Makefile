-include .env
-include .env.development
-include .env.production
-include .env.local

# Name of the Docker Compose project
PROJECT_NAME = tyr

# Default environment file
ENV_FILE = .env.development

# Docker Compose command with default environment file
DC = docker-compose --env-file $(ENV_FILE)

# Required environment variables
REQUIRED_ENV_VARS = DB_NAME DB_USER DB_PASSWORD GADM_FILE

# ---- Environment Checks ----
check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "Error: .env file is missing. Initialize it from .env.example."; \
		exit 1; \
	fi
	@for var in $(REQUIRED_ENV_VARS); do \
    	awk -F '=' -v key="$$var" '$$1 == key { if ($$2 == "" || $$2 == " ") exit 1 }' $(ENV_FILE) || { echo "Error: $$var is not set or empty in .env"; exit 1; }; \
    done

check-gadm-file:
	@if [ ! -f $(GADM_FILE) ]; then \
		echo "Error: GADM file is missing. Set the correct path to the GADM file in .env."; \
		exit 1; \
	fi

# ---- Docker Database Commands ----
build-db: check-env
	# Check if the database is already built
	@$(DC) images | grep db >/dev/null || $(DC) build db

run-db: build-db
	export RUN_INIT=true && $(DC) up -d db

just-run-db: build-db
	export RUN_INIT=false && $(DC) up -d db

db-shell:
	$(DC) exec -it db /bin/bash

init-db: check-gadm-file run-db
	@echo "Database initialized and GPKG file imported."
	# Check if the database is ready and has the required tables
	@until $(DC) exec -T db pg_isready -U $(DB_USER) -d $(DB_NAME) > /dev/null 2>&1 && \
	       $(DC) exec -T db psql -U $(DB_USER) -d $(DB_NAME) -c "\dt" 2>&1 | grep regions >/dev/null; do \
		sleep 1; \
	done

# ---- Migrations ----
migrate-db: init-db
	$(DC) exec backend npm run migrate

# ---- Cleanup Commands ----
clean-container:
	$(DC) down

clean-volume:
	$(DC) down -v

clean-image:
	$(DC) down --rmi all

clean-all: clean-container clean-image clean-volume

# ---- Re-initialize DB ----
reinit-db: check-gadm-file clean-volume init-db
	@echo "Database forcefully re-initialized."

# ---- Miscellaneous ----
stop:
	$(DC) stop

build: check-env
	$(DC) build

run: check-env
	$(DC) up -d

start-all: init-db build run migrate-db
	@echo "Database is running on host port ${HOST_DB_PORT}"
	@echo "Backend is running on host port ${HOST_BACKEND_PORT}"
	@echo "Frontend is running on host port ${HOST_FRONTEND_PORT}"
	@echo "All services are up and the database is initialized and migrated."

.PHONY: build run init-db clean-container clean-image clean-all reinit-db clean-volume migrate start-all just-run-db
