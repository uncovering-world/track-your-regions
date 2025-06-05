# Deployment Scripts and Configurations for Region Tracker

## Overview

This directory contains scripts and configurations for deploying the Region Tracker service. The primary objectives are:

1. To initialize the Postgres database so that it can be used by the backend service.
2. To initialize all services together for quick setup and testing purposes.

> **Note**: This workflow is designed for quick testing and is not suitable for production deployments.

## Database Initialization

### Features

- Dockerized Postgres service with GDAL
- Automated database initialization based on the GADM file
- Hierarchical data processing for improved performance
- Indexing on critical fields to enhance query speeds
- Includes geometric data in the initial setup

### Usage

1. Copy the `.env.development.example` file to `.env.development` and set the environment variables, including GitHub Container Registry (GHCR) credentials and PostGIS version:

   ```bash
   cp .env.development.example .env.development
   ```

#### Environment Configuration Files

The application supports loading environment variables from several `.env*` files. These files allow you to define environment-specific settings that the application can use. Here is the order of precedence for the environment files:

* `.env` - General defaults: This file contains default environment variables that are common across all environments.
* `.env.development` - Development environment: Contains defaults for the development environment, including GHCR and PostGIS settings.
* `.env.production` - Production environment: Contains defaults for the production environment.
* `.env.local` - Local overrides: This file is intended for environment variables that should not be committed to the version control system, typically used for secrets or local overrides.

2. Initialize the Postgres database with the core hierarchy and geometry:

   ```bash
   make init-db
   ```

3. If you need to re-initialize the database, use:

   ```bash
   make reinit-db
   ```

   This will drop the current database and re-run the initialization process.

## Prepopulated Database Container

We also support the process for creating and using a prepopulated database container. This container can be built
and pushed to the GitHub Container Registry, then pulled and used to initialize the database quickly.

### Usage of Prepopulated Database Container

If you want to use the prepopulated database container, you can use the following command:

```bash
make start-prepopulated-db-container
```

It will pull the prepopulated database image from the GitHub Container Registry and start the container. It
will also initialize the database and create a volume for the database data, so the container can be stopped
and started without losing data.

### Creating the Prepopulated Database Image

To build and push the prepopulated database image, run:

```bash
make push-db-image
```

You can verify the entire cycle of building, pushing and starting the container with:

```bash
make test-prepopulated-db-container-cycle
```

### Flags and Makefile Targets for Prepopulated Database Container

- `FORCE_DUMP`: Forces the creation of a new database dump, even if one already exists.
- `FORCE_PDBI_BUILD`: Forces the build of the prepopulated database image, even if it already exists.
- `LOCAL_IMAGE`: Use a locally available image instead of pulling from the GitHub Container Registry.
- `FORCE_PDBC_INIT`: Forces the re-initialization of the prepopulated database container.

### Additional Makefile Targets

- `make dump-db`: Dump the current database to a file.
- `make build-prepopulated-db-image`: Build the Docker image with the prepopulated database.
- `make push-db-image`: Push the prepopulated database image to the GitHub Container Registry.
- `make test-prepopulated-db-container-cycle`: Test the entire process of building, pushing, and starting the prepopulated database container.

## Quick Setup and Testing of All Services

### Features

- Dockerized backend and frontend services
- Simplified build, run, and clean operations via a Makefile

### Usage

1. Start all services and initialize the database:

   ```bash
   make start-all
   ```

### Running Services Individually

To run the frontend and backend services independently, navigate to their respective directories and use npm commands directly. The Dockerfiles in those directories are intended solely for use by docker-compose.

Remember that if you run the backend independently, you will need to use a prepopulated database container or initialize the database manually. See the [Database Initialization](#database-initialization) and [Prepopulated Database Container](#prepopulated-database-container) sections for more information.

### Additional Makefile Targets

- `make build`: Build all Docker images.
- `make run`: Run all Docker containers.
- `make migrate-db`: Migrate the database.
- `make reinit-db`: Forcefully re-initialize
