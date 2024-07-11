-include .env
-include .env.development
-include .env.production
-include .env.local
export

# Name of the Docker Compose project
PROJECT_NAME = tyr

# Default environment file
ENV_FILE = .env.development

# Determine the Docker Compose command based on the Docker version
export DC := $(shell command -v docker >/dev/null && docker --version | awk '{print $$3}' | cut -d'.' -f1,2 | sed 's/,//g' | (read v; if [ $$(echo "$$v >= 20.10" | bc -l) -eq 1 ]; then echo "docker compose --env-file $(ENV_FILE)"; else echo "docker-compose --env-file $(ENV_FILE)"; command -v docker-compose >/dev/null || { echo "Error: Docker Compose is not installed." >&2; exit 1; }; fi))

# Required environment variables
REQUIRED_ENV_VARS = DB_NAME DB_USER DB_PASSWORD GADM_FILE POSTGIS_VERSION

# ---- Environment Checks ----
check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "Error: .env.development file is missing. Initialize it from .env.development.example."; \
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
	# If FORCE is set, force the rebuild of the database image, check if the image exists otherwise
	@if [ -z "$(FORCE)" ]; then \
		$(DC) images | grep db >/dev/null || $(DC) build db; \
	else \
		$(DC) build db; \
	fi

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

init-alt-table: init-db
	@echo "Initialize alternative hierarchy table."
	$(DC) exec -T db python3 -u /tmp/init-regions-table.py -o

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

# ---- Common Variable Declarations ----
DB_DUMP_DIR = ./db-dump
DB_IMAGE_NAME = tyr-db
GIT_COMMIT_HASH = $(shell git rev-parse --short HEAD)
DB_IMAGE_TAG = $(GIT_COMMIT_HASH)
GHCR_IMAGE_NAME = ghcr.io/ohmspectator/tyr-db
GHCR_IMAGE_TAG = $(DB_IMAGE_TAG)
PREPOPULATED_DB_CONTAINER_NAME = prep-tyr-db-container
DB_VOLUME_NAME = prep-tyr-db-data

setup-db-dump-dir:
	@if [ -d $(DB_DUMP_DIR) ]; then \
		echo "Directory $(DB_DUMP_DIR) already exists."; \
	else \
		echo "Creating directory for database dumps..."; \
		mkdir -p $(DB_DUMP_DIR) ; \
		echo "Directory created at ./db-dump/" ; \
	fi

dump-db: init-db setup-db-dump-dir
	@set -e; \
	if [ -n "$(FORCE_DUMP)" ] || [ -z "$$(ls -A $(DB_DUMP_DIR))" ]; then \
		echo "Creating database dump..."; \
		DUMP_FILE="$(DB_DUMP_DIR)/db-dump-$$(date +%Y-%m-%d-%H-%M-%S).dump"; \
		$(DC) exec -T db pg_dump -U $(DB_USER) -d $(DB_NAME) -v --no-owner --no-acl -F c -Z 9  > $$DUMP_FILE; \
		echo "Database dump created: $$DUMP_FILE"; \
	else \
		echo "Dump file(s) already exist in $(DB_DUMP_DIR). Use FORCE=1 to override."; \
	fi

build-prepopulated-db-image: dump-db check-env
	if [ -n "$(FORCE_PDBI_BUILD)" ]; then \
		echo "Forcing build of prepopulated database image..."; \
		echo "Removing image $(DB_IMAGE_NAME):$(DB_IMAGE_TAG) if exists"; \
		docker rmi -f $(DB_IMAGE_NAME):$(DB_IMAGE_TAG) || true; \
	fi
	@IMAGE_EXISTS=$$(docker images -q $(DB_IMAGE_NAME):$(DB_IMAGE_TAG)); \
	if [ -z "$$IMAGE_EXISTS" ]; then \
		echo "Building  image $(DB_IMAGE_NAME):$(DB_IMAGE_TAG)..."; \
		DB_DUMP_FILE=$(DB_DUMP_DIR)/$$(ls -t $(DB_DUMP_DIR) | head -1); \
		docker build -f ./db-image/Dockerfile \
		       --build-arg DB_DUMP_FILE=$$DB_DUMP_FILE \
		       --build-arg POSTGIS_VERSION=$(POSTGIS_VERSION) \
		       -t $(DB_IMAGE_NAME):$(DB_IMAGE_TAG) .; \
		echo "Docker image built successfully."; \
	else \
		echo "Docker image $(DB_IMAGE_NAME):$(DB_IMAGE_TAG) already exists. Skipping build."; \
	fi

# Login to GitHub Container Registry
login-ghcr: check-env
	@echo "Logging into GitHub Container Registry..."
	@GITHUB_USERNAME=$$(gh api user --jq .login 2>/dev/null || echo $$GH_USERNAME); \
	if [ -z "$$GITHUB_USERNAME" ]; then \
		echo "Error: Could not determine GitHub username. Set GH_USERNAME environment variable."; \
		exit 1; \
	fi; \
	if [ -z "$(GHCR_PAT)" ]; then \
		echo "Error: GHCR_PAT environment variable not set."; \
		exit 1; \
	fi; \
	echo $(GHCR_PAT) | docker login ghcr.io -u $$GITHUB_USERNAME --password-stdin


# Push image to GitHub Container Registry
push-db-image: build-prepopulated-db-image login-ghcr
	@echo "Tagging and pushing Docker image to GitHub Container Registry..."
	@docker tag $(DB_IMAGE_NAME):$(DB_IMAGE_TAG) $(GHCR_IMAGE_NAME):$(GHCR_IMAGE_TAG)
	@docker tag $(DB_IMAGE_NAME):$(DB_IMAGE_TAG) $(GHCR_IMAGE_NAME):latest
	@echo "Pushing image $(GHCR_IMAGE_NAME):$(GHCR_IMAGE_TAG)..."
	@docker push $(GHCR_IMAGE_NAME):$(GHCR_IMAGE_TAG)
	@echo "Image pushed successfully to GitHub Container Registry."
	@echo "Pushing image $(GHCR_IMAGE_NAME):latest..."
	@docker push $(GHCR_IMAGE_NAME):latest
	@echo "Image pushed successfully to GitHub Container Registry."

get-prepopulated-db-image:
	@if [ -n "$(LOCAL_IMAGE)" ]; then \
		echo "Using local image $(DB_IMAGE_NAME):$(DB_IMAGE_TAG)"; \
		if [ -z "$$(docker images -q $(DB_IMAGE_NAME):$(DB_IMAGE_TAG))" ]; then \
			echo "Error: Local image $(DB_IMAGE_NAME):$(DB_IMAGE_TAG) does not exist."; \
			exit 1; \
		fi; \
	else \
		if [ -n "$$(docker images -q $(GHCR_IMAGE_NAME):latest)" ]; then \
  			echo "Docker image $(GHCR_IMAGE_NAME):latest already exists."; \
		else \
			echo "Pulling Docker image ($(GHCR_IMAGE_NAME):latest) from GitHub Container Registry..." ; \
			docker pull $(GHCR_IMAGE_NAME):latest; \
		fi; \
		echo "Docker image $(GHCR_IMAGE_NAME):latest is ready to use."; \
	fi

stop-prepopulated-db-container:
	@if [ -z "$$(docker ps -aq -f name=$(PREPOPULATED_DB_CONTAINER_NAME))" ]; then \
  		echo "Database container $(PREPOPULATED_DB_CONTAINER_NAME) does not exist, skipping stop."; \
	else \
		echo "Stopping database container $(PREPOPULATED_DB_CONTAINER_NAME)..."; \
		docker stop $(PREPOPULATED_DB_CONTAINER_NAME); \
		until [ "$$(docker inspect -f '{{.State.Running}}' $(PREPOPULATED_DB_CONTAINER_NAME))" = "false" ]; do \
			sleep 1; \
		done; \
		echo "Database container stopped."; \
	fi

clean-prepopulated-db-container: stop-prepopulated-db-container
	@echo "Removing database container..."
	@docker rm -f $(PREPOPULATED_DB_CONTAINER_NAME) || true
	@echo "Database container removed."
	@echo "Removing volume $(DB_VOLUME_NAME)..."
	@docker volume rm -f $(DB_VOLUME_NAME) || true
	@echo "Volume removed."

init-prepopulated-db-container: get-prepopulated-db-image
	@if [ -n "$(FORCE_PDBC_INIT)" ]; then \
  		echo "Forcing re-initialization of database from Docker image..."; \
		make clean-prepopulated-db-container; \
	fi
	@echo "Creating prepopulated database volume..."
	@if [ -z "$$(docker volume ls -q -f name=$(DB_VOLUME_NAME))" ]; then \
		echo "Creating Docker volume $(DB_VOLUME_NAME)..."; \
		docker volume create $(DB_VOLUME_NAME); \
		echo "Docker volume $(DB_VOLUME_NAME) created."; \
	fi
	@echo "Prepopulated database volume created."
	@echo "Initializing database from Docker image..."
	@if [ -n "$(FORCE_PDBC_INIT)" ] || [ -z "$$(docker ps -aq -f name=$(PREPOPULATED_DB_CONTAINER_NAME))" ]; then \
  		echo "Creating database container..."; \
  		if [ -n "$(LOCAL_IMAGE)" ]; then \
  			echo "Using local image $(DB_IMAGE_NAME):$(DB_IMAGE_TAG)"; \
  			IMAGE_NAME=$(DB_IMAGE_NAME) IMAGE_TAG=$(DB_IMAGE_TAG) ; \
  		else \
  			echo "Using image $(GHCR_IMAGE_NAME):latest"; \
  			IMAGE_NAME=$(GHCR_IMAGE_NAME) IMAGE_TAG=latest ; \
  		fi; \
	    docker run -d --name $(PREPOPULATED_DB_CONTAINER_NAME) \
			   -e POSTGRES_USER=$(DB_USER) \
			   -e POSTGRES_PASSWORD=$(DB_PASSWORD) \
			   -e POSTGRES_DB=$(DB_NAME) \
	           -p $(HOST_DB_PORT):5432 \
	    	   -v $(DB_VOLUME_NAME):/var/lib/postgresql/data \
	      	   $$IMAGE_NAME:$$IMAGE_TAG ;\
	    echo "Database container created."; \
	fi

# Run database from Docker image
start-prepopulated-db-container: init-prepopulated-db-container
	@docker start $(PREPOPULATED_DB_CONTAINER_NAME)
	@echo "Database is running on host port $(HOST_DB_PORT)"

test-prepopulated-db-container-cycle:
	@echo "Testing database container cycle..."
	@make build-prepopulated-db-image
	@make stop
	@make start-prepopulated-db-container LOCAL_IMAGE=$(LOCAL_IMAGE)
	@echo "Database container cycle test passed."

.PHONY: build run init-db clean-container clean-image clean-all reinit-db clean-volume migrate start-all just-run-db
.PHONY: dump-db check-env
