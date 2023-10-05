#!/usr/bin/env bash

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Please create .env file in the root directory"
  exit 1
fi

# Load environment variables
source .env

OUTPUT_DIR='./src/models/generated'

# Check if output directory exists, if not create it
if [ ! -d "$OUTPUT_DIR" ]; then
  mkdir -p "$OUTPUT_DIR"
fi

# Check the required environment variables
REQUIRED_VARIABLES=(DB_NAME DB_USER DB_PASSWORD)
for VARIABLE in "${REQUIRED_VARIABLES[@]}"; do
  if [ -z "${!VARIABLE}" ]; then
    echo "Please set $VARIABLE in .env file"
    exit 1
  fi
done

sequelize-auto -o $OUTPUT_DIR -d "$DB_NAME" -h localhost -u "$DB_USER" -x "$DB_PASSWORD" -p 5432 -e postgres --schema gadm > generate-models.log

if [ $? -eq 0 ]; then
  echo "Models generated successfully"
  rm generate-models.log
else
  echo "Error generating models"
fi
