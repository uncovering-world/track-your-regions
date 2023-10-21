# Deployment Scripts and Configurations for Region Tracker

## Overview

This directory contains scripts and configurations for deploying the Region Tracker service. The primary objectives are:

1. To initialize the Postgres database so that it can be used by the backend service.
2. To initialize all services together for quick setup and testing purposes.

> **Note**: This workflow is designed for quick testing and is not suitable for production deployments.

## Database Initialization

### Features

- Dockerized Postgres service with GDAL
- Automated database initialization based on a GADM file

### Usage

1. Copy the `.env.example` file to `.env` and set the environment variables:

   ```bash
   cp .env.example .env
   ```

2. Initialize the Postgres database:

   ```bash
   make init-db
   ```

3. If you need to re-initialize the database, use:

   ```bash
   make reinit-db
   ```

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

### Additional Makefile Targets

- `make build`: Build all Docker images.
- `make run`: Run all Docker containers.
- `make migrate-db`: Migrate the database.
- `make reinit-db`: Forcefully re-initialize the database.
- `make clean-container`: Stop and remove all Docker containers.
- `make clean-image`: Remove all Docker images.
- `make clean-volume`: Remove all Docker volumes.
- `make clean-all`: Perform a complete cleanup.
