# ADR-0006: Use Martin for Vector Tile Serving

**Date:** 2025-01-01
**Status:** Accepted

---

## Context

The app renders region polygons on an interactive map. With thousands of GADM divisions
and custom regions, sending raw GeoJSON is too slow. Vector tiles (MVT) are needed for
efficient rendering, but the geometry changes frequently as users edit world views and
compute region boundaries.

## Decision

Use Martin as the vector tile server. Martin auto-discovers PostGIS tables and functions,
serving MVT tiles directly from the database with no pre-build step.

Tile endpoints are implemented as PostGIS functions (`tile_gadm_root_divisions`,
`tile_world_view_root_regions`, `tile_region_subregions`) that accept query parameters
for filtering by world view, parent region, etc.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Tippecanoe pre-built tiles | Requires a build step after every geometry change; breaks real-time editing workflow |
| pg_tileserv | Less actively maintained; fewer features than Martin |
| Mapbox Vector Tile API | Usage-based billing; vendor lock-in (see ADR-0001) |
| GeoJSON direct rendering | Too slow for large polygon sets; no level-of-detail simplification |

## Consequences

**Positive:**
- Geometry changes in DB instantly appear on the map (no tile rebuild)
- Parametrized tile functions support multi-world-view filtering
- Stateless — scales horizontally with no shared state
- Auto-discovers PostGIS tables/functions via config

**Negative / Trade-offs:**
- Tiles are computed on every request (no pre-built cache); relies on DB performance
- Cache busting requires incrementing `world_views.tile_version` and appending `&_v=`
  query param to tile URLs
- Martin config (`martin/config.yaml`) must be updated when adding new tile functions

## References

- Related ADRs: ADR-0001 (MapLibre), ADR-0002 (GADM)
- Config: `martin/config.yaml`
- Tile functions: `db/init/02-martin-functions.sql`
- Frontend integration: `frontend/src/components/regionMap/useTileUrls.ts`
- Martin: https://martin.maplibre.org
