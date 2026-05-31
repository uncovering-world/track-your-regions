# Database Bootstrap Status

> **Status:** Implemented. This doc replaces the old migration-plan narrative with current operational reality.

## What Exists

- Consolidated schema: `db/init/01-schema.sql`
- GADM importer: `db/init-db.py`
- DB command wrapper: `scripts/db-cli.sh`
- NPM shortcuts in root `package.json` (`db:create`, `db:list`, `db:use`, `db:drop`, `db:status`, `db:load-gadm`, etc.)
- Local DB state files:
  - `.active-db`
  - `.golden-db`

## Current Workflow

```bash
npm run db:up
npm run db:create my_regions
npm run db:load-gadm
npm run dev
```

### Useful lifecycle commands

```bash
npm run db:list
npm run db:use <db_name>
npm run db:mark-golden
npm run db:unmark-golden
npm run db:drop <db_name>
```

## Notes

- `db:init` style multi-step migrations are no longer required for new environments.
- GADM import still takes time and is intended as an explicit step, not an automatic startup action.
- Golden DB guardrails prevent accidental drops until explicitly unmarked.

## Single Source of Truth: DB_NAME

The active database name is now the canonical entry in `.env`
(`DB_NAME`). The `.active-db` file is a legacy fallback: if `.env`
does not define `DB_NAME`, `scripts/db-cli.sh` reads `.active-db`
for backwards compatibility. New environments set via `npm run setup`
use `.env` exclusively; `.active-db` is not created.

## GADM Loader Repair

`npm run db:load-gadm` now offers to download the GADM GeoPackage
if the expected file is not found locally. It prompts for the
download URL (defaults to the GADM 4.1 direct link) so contributors
do not need to fetch the file manually before running the importer.

The importer (`init-db.py`) and `precalculate-geometries.py` run inside
the `db-loader` container (GDAL + psycopg2 + dotenv + shapely, built
from `db/Dockerfile`, `tools` compose profile), so the host needs **no
Python or GDAL** — only Docker. `db:load-gadm` builds the image, mounts
the gpkg, and runs both steps with `DB_HOST=db` over the compose
network.

## Remaining Improvements (Optional)

- Add automated smoke checks after `db:load-gadm` (row counts +
  basic geometry presence)
- Add a “fast sample import” mode for CI/local prototyping
