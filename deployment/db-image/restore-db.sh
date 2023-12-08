#!/bin/bash
set -e

# Restore the database from the dump
pg_restore -v -U $POSTGRES_USER -d $POSTGRES_DB /tmp/db.dump

# Remove the dump file
rm /tmp/db.dump
