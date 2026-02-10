# Database Migrations

This directory is empty because no production release exists yet.

All schema changes have been consolidated into the init scripts:
- `db/init/01-schema.sql` - Tables, indexes, triggers, and auth system
- `db/init/02-martin-functions.sql` - Martin vector tile functions
- `db/init/03-geom-3857-columns.sql` - SRID 3857 columns and simplification

For new databases, run the init scripts in order. Migration files will be added here after the first production release when backwards compatibility becomes necessary.
