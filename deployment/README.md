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
- Option to toggle the inclusion of geometric data for faster initial setup

### Usage

1. Copy the `.env.example` file to `.env` and set the environment variables:

   ```bash
   cp .env.example .env
   ```
#### Environment Configuration Files

The application supports loading environment variables from several `.env*` files. These files allow you to define
environment-specific settings that the application can use. Here is the order of precedence for the environment files:

* `.env` - General defaults: This file contains default environment variables that are common across all environments.
* `.env.development` - Development environment: Contains defaults for the development environment.
* `.env.production` - Production environment: Contains defaults for the production environment.
* `.env.local` - Local overrides: This file is intended for environment variables that should not be committed to the
   version control system, typically used for secrets or local overrides.

The application will load these files and use the environment variables defined within them. If multiple files define
the same variable, the last one loaded will take precedence. Typically, `.env.local` is used for secrets and should not
be checked into version control, while the others can be used for shared environment configurations.

2. Initialize the Postgres database with the core hierarchy:

   ```bash
   make init-db
   ```

   This will exclude geometric data by default for a quicker setup.

3. To include geometric data after the hierarchy is established, run:

   ```bash
   make init-db-geom
   ```

4. If you need to re-initialize the database, use:

   ```bash
   make reinit-db
   ```

   This will drop the current database and re-run the initialization process.

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

To run the frontend and backend services independently, navigate to their respective directories and use npm commands
directly. The Dockerfiles in those directories are intended solely for use by docker-compose.

### Additional Makefile Targets

- `make build`: Build all Docker images.
- `make run`: Run all Docker containers.
- `make migrate-db`: Migrate the database.
- `make reinit-db`: Forcefully re-initialize the database.
- `make db-shell`: Access the database command line interface.
- `make clean-container`: Stop and remove all Docker containers.
- `make clean-image`: Remove all Docker images.
- `make clean-volume`: Remove all Docker volumes.
- `make clean-all`: Perform a complete cleanup.

## `init-regions-table` Script Parameters and Docker Execution

The `init-regions-table` script is a Python script intended to run within a Docker container to initialize an empty
database. The script has options to customize the initialization process based on the requirements of the current
environment.

### Script Options

The `init-regions-table` Python script supports the following command-line options:

- `--fast`: Runs the initialization script in 'fast' mode, skipping the postprocessing for a quicker setup. This is
  especially useful for debugging and development purposes when the full dataset is not required.

- `--geometry`: Includes geometric data during the initialization. This option increases the initialization time but is
  necessary for environments where spatial data is essential. It's set by default.

### Setting Script Parameters in Docker

These options are passed to the `init-regions-table` script from the `init-db.sh` shell script, which is the Docker
container's entry point. To set these options, you need to modify the `init-db.sh` script as follows:

1. Open the `init-db.sh` file in a text editor.
2. Locate the line where `init-regions-table.py` is called.
3. Add the desired options to this command.

Here's an example snippet from `init-db.sh` that includes both options:

```bash
# Inside init-db.sh
python init-regions-table.py --fast --geometry
```

Make sure to include only the options relevant to your deployment. For instance, to enable fast initialization without
geometry data, you would only include `--fast`:

```bash
# Inside init-db.sh for fast initialization without geometry
python init-regions-table.py --fast
```

### Note on Usage

- The `--fast` option is recommended for development and testing environments where speed is preferred over data
  completeness.
- The `--geometry` option should be used when the geometrical integrity of the data is important for the application's
  functionality.

Remember to rebuild your Docker image if you make changes to the `init-db.sh` script to ensure that the container runs
with the updated initialization parameters.

