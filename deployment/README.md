# Deployment Scripts and Configurations for Region Tracker

## Overview

This directory includes scripts for deploying the service, managing configurations, and orchestrating various components
of the Region Tracker service. It now also includes a Dockerized PostGIS setup with automated database initialization
based on a GADM file.

## Guidelines

- Ensure that all deployment scripts are well-documented and easy to understand.
- Follow best practices for security and scalability when writing deployment scripts.
- Adhere to the established coding standards and naming conventions for consistency.
- Test all deployment procedures thoroughly before executing them on production systems.

## Dockerized Postgres Setup

### Features

- Dockerized Postgres service with GDAL
- Automated database initialization based on a GADM file
- Simplified build, run, and clean operations via a Makefile

### Requirements

- Docker
- docker-compose
- A GADM file (GeoPackage format)

### Usage

1. Copy the `.env.example` file to `.env` and set the environment variables:

   ```bash
   cp .env.example .env
   ```

2. Initialize the Postgres database and import the GADM file:

   ```bash
   make init-db
   ```

### Additional Makefile Targets

- `make build`: Build the Docker image.
- `make run`: Run the Docker container.
- `make reinit-db`: Forcefully re-initialize the database.
- `make clean-container`: Stop and remove the Docker container.
- `make clean-image`: Remove the Docker image.
- `make clean-all`: Remove the Docker container, image, and volume.
- `make clean-volume`: Remove the Docker volume.

### Troubleshooting

If you encounter issues related to Docker or database initialization, you can force re-initialization using:

```bash
make reinit-db
```
