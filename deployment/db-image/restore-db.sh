#!/bin/bash
set -e

# Wait for the PostgreSQL server to start
until pg_isready -h localhost -U $POSTGRES_USER -d $POSTGRES_DB; do
  sleep 1
done

# Restore the database from the dump
pg_restore -U $POSTGRES_USER -d $POSTGRES_DB /tmp/db.dump || \
psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/db.dump

# Remove the dump file
rm /tmp/db.dump
