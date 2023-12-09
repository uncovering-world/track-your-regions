#!/bin/bash
# Restore the database from the dump
echo ">>>>> restore-db.sh: Restoring the database from the dump"
# -v is for verbose
# -c is for clean (drop database objects before recreating them: overwriting)
# --if-exists is to avoid errors if the objects on overwrite don't exist
pg_restore -v -c --if-exists -U $POSTGRES_USER -d $POSTGRES_DB /tmp/db.dump
echo ">>>>> restore-db.sh: Database restored from the dump"

# Remove the dump file
echo ">>>>> restore-db.sh: Removing the dump file"
rm /tmp/db.dump
echo ">>>>> restore-db.sh: Dump file removed"

