# GADM Mapping

This document describes how GADM data is imported and mapped into the current schema.

## Source Format

The import pipeline expects GADM GeoPackage input (for example `gadm_410.gpkg`), loaded by:

- `db/init-db.py`

The script reads hierarchical columns (`GID_0..GID_n`, `NAME_0..NAME_n`) and materializes explicit parent-child rows.

## Target Schema

Imported rows land in `administrative_divisions`:

- `id`
- `name`
- `parent_id`
- `has_children`
- `gadm_uid`
- `geom` (4326)
- simplified/display/derived geometry columns maintained by DB functions/triggers

This table is the authoritative administrative boundary dataset used by:

- division browsing/search APIs (`/api/divisions/*`)
- region member composition (`region_members.division_id`)
- geometry merges for user-defined regions

## Hierarchy Strategy

GADM’s denormalized level columns are converted into a normalized tree:

- one row per administrative division
- explicit `parent_id` relation
- deterministic `has_children` flag

This enables fast recursive queries for:

- descendants/ancestors
- subdivision listing
- split tools in the World View editor

## Geometry Strategy

### Stored forms

- raw `geom` (WGS84 / 4326)
- simplified versions for lower detail levels
- Web Mercator derivatives (`*_3857`) for tile generation

### Why this matters

- API responses can choose detail level without recomputing simplification
- tile rendering avoids on-the-fly reprojection/simplification
- shared borders stay consistent across neighboring divisions

## Operational Notes

- First-time setup uses `db/init/01-schema.sql` + `db/init-db.py`
- Re-importing GADM should be done on a fresh/test DB, then promoted if needed
- Upstream GADM updates require re-import; IDs and parent links are recreated by the import process
