#!/usr/bin/env bash

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Please create .env file in the root directory"
  exit 1
fi

# Load environment variables
source .env

# Check the required environment variables
REQUIRED_VARIABLES=(DB_NAME DB_USER DB_PASSWORD)
for VARIABLE in "${REQUIRED_VARIABLES[@]}"; do
  if [ -z "${!VARIABLE}" ]; then
    echo "Please set $VARIABLE in .env file"
    exit 1
  fi
done

sequelize-auto -o './src/models' -d "$DB_NAME" -h localhost -u "$DB_USER" -x "$DB_PASSWORD" -p 5432 -e postgres --schema gadm
