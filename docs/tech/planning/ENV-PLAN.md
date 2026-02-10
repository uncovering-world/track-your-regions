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

## Remaining Improvements (Optional)

- Add automated smoke checks after `db:load-gadm` (row counts + basic geometry presence)
- Add a “fast sample import” mode for CI/local prototyping
