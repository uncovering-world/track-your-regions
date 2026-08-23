# Martin Vector Tile Server

This directory contains the configuration for [Martin](https://maplibre.org/martin/), a PostGIS-based vector tile server that serves MVT (Mapbox Vector Tiles) directly from the database.

## Why Vector Tiles?

Vector tiles dramatically improve map loading performance compared to fetching GeoJSON:

- **Smaller payloads**: Tiles are pre-clipped and simplified for each zoom level
- **Streaming**: Only visible tiles are loaded as you pan/zoom
- **Caching**: Tiles can be cached at CDN/browser level
- **GPU acceleration**: MapLibre GL renders vector tiles directly on GPU

## Performance Optimizations

The tile functions are optimized for fast response times (~0.7s per tile):

1. **Pre-computed SRID 3857 geometries** - No `ST_Transform` at query time
2. **Pre-simplified geometries** for different zoom levels:
   - `geom_overview` / `geom_overview_3857` - Zoom 0-2 (50km tolerance, parts
     under 2,500km² dropped)
   - `geom_simplified_coarse` / `geom_simplified_coarse_3857` - Zoom 3-4 (10km
     tolerance, parts under 100km² dropped)
   - `geom_simplified_medium` - Zoom 5-8 (1km tolerance)
   - `geom_simplified_low` (5km) is the input the two cheap rungs are derived
     from, and the arm the ladder falls through to when one of them is NULL
3. **Spatial indexes** on the geometry columns, with two exceptions: neither
   cheap rung has one. Tile functions filter on `geom_3857 && bounds` and read every
   LOD rung only inside `ST_AsMVTGeom`, so none of the simplified columns is a
   spatial-predicate operand — the indexes on the older rungs predate that and
   are not load-bearing for tiles
4. **Automatic triggers** keep derived columns in sync

The columns, indexes and triggers behind them are all defined in
`db/init/01-schema.sql`, which Postgres applies automatically when the database
is created empty. To re-apply it to a database that already holds data:
```bash
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/init/01-schema.sql
```

## Running Martin

### Option 1: Docker Compose (recommended for development)

Martin is included in the main `docker-compose.yml`:

```bash
docker compose up -d
```

Martin will be available at `http://localhost:3000`.

### Option 2: Standalone (for development/debugging)

First, install Martin:

```bash
# macOS
brew install maplibre/martin/martin

# Linux / Cargo
cargo install martin

# Or download binary from GitHub releases
# https://github.com/maplibre/martin/releases
```

Then run with npm script or directly:

```bash
# Via npm (recommended - auto-detects active database)
npm run martin

# Or directly
./martin/run-martin.sh
```

### Option 3: Manual restart

```bash
npm run martin:restart
```

## Database Switching Integration

Martin integrates with the `npm run db:use` workflow:

- **Standalone mode** (`npm run martin`): Automatically reads the active database from `.active-db` file
- **Docker mode**: When you run `npm run db:use <name>`, the Martin container is automatically restarted to use the new database

Example:
```bash
npm run db:use my_test_db    # Switches DB and restarts Martin container
npm run martin               # Standalone: uses my_test_db automatically
```

## Tile Endpoints

### Table Sources (auto-publish is off)

`config.yaml` sets `auto_publish: { tables: false, functions: true }`, so Martin
publishes no source for any table. It used to publish one per geometry column
it found — including every LOD rung on `regions` and `administrative_divisions`,
27 sources in total — until #504 turned table auto-publication off.

**The app never used them.** Every tile the frontend requests comes from a
function source below, because the rung a tile needs depends on its zoom and a
table source cannot choose — that observation is exactly why table
auto-publication was turned off: those 27 sources were serving every column of
`experiences` (including `created_by` and `status`), unauthenticated, on a
public port, to nobody.

Check what Martin actually serves against the running server rather than trust
this doc — `functions: true` auto-discovers every compatible function in the
database, so the catalog isn't a fixed list. It currently holds the six
function sources below; a new compatible function added to the schema is
published the same way, with no edit to `config.yaml`:

```bash
curl -s localhost:3000/catalog | jq '.tiles | keys'
```

### Function Sources (dynamic queries)

| Endpoint | Parameters | Description |
|----------|------------|-------------|
| `/tile_world_view_root_regions/{z}/{x}/{y}` | `world_view_id` | Root regions for a world view |
| `/tile_world_view_all_leaf_regions/{z}/{x}/{y}` | `world_view_id` | All leaf regions (no subregions) for a world view |
| `/tile_region_subregions/{z}/{x}/{y}` | `parent_id` | Subregions of a parent |
| `/tile_gadm_root_divisions/{z}/{x}/{y}` | - | Root GADM divisions |
| `/tile_gadm_subdivisions/{z}/{x}/{y}` | `parent_id` | GADM subdivisions of a parent |
| `/tile_region_islands/{z}/{x}/{y}` | `parent_id` (optional) | Real island boundaries for archipelagos |

### Example Usage

```bash
# Get a tile at zoom 3, x=4, y=2
curl http://localhost:3000/tile_gadm_root_divisions/3/4/2

# Get root regions for world view 2
curl "http://localhost:3000/tile_world_view_root_regions/3/4/2?world_view_id=2"

# Get subregions of region 15
curl "http://localhost:3000/tile_region_subregions/5/16/10?parent_id=15"
```

## Frontend Integration

The `RegionMapVT` component in the frontend uses these tiles:

```typescript
import { MARTIN_URL } from '../api';

// Build tile URL for current view
const tileUrl = `${MARTIN_URL}/tile_world_view_root_regions/{z}/{x}/{y}?world_view_id=${worldViewId}`;

// Use in MapLibre GL source
<Source type="vector" tiles={[tileUrl]} />
```

## Database Functions

The SQL functions for Martin are defined in:
- `db/init/01-schema.sql`

These are automatically created when the database is initialized.

To manually add them to an existing database:

```bash
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/init/01-schema.sql
```

## Debugging

### Check Martin catalog

```bash
curl http://localhost:3000/catalog
```

### Check specific source info

```bash
curl http://localhost:3000/tile_world_view_root_regions
```

### View tiles in browser

Open `http://localhost:3000/` for Martin's built-in tile viewer.

## Performance Tuning

### Caching

Martin supports tile caching. For production, consider:

1. **Nginx caching**: Add a reverse proxy with cache
2. **CDN**: CloudFlare, Fastly, etc.
3. **Redis cache**: Configure in Martin config

### Cache Invalidation

If vector tiles show stale geometries (different from GeoJSON mode):

#### 1. Force browser cache refresh

The frontend uses cache-busting parameters (`_v` and `_k`) in tile URLs.
Call `invalidateTileCache()` from `useNavigation` hook to increment the version
and force MapLibre to reload tiles.

#### 2. Restart Martin (nuclear option)

```bash
# Via npm script
npm run martin:restart

# Or via docker-compose
docker compose restart martin
```

### Simplification

The tile functions do not simplify. Each zoom band reads a column simplified
once, at write time, by the geometry triggers:

- Zoom 0-2: `geom_overview` (50km, floored at 2,500km², coverage-simplified)
- Zoom 3-4: `geom_simplified_coarse` (10km, floored at 100km², coverage-simplified)
- Zoom 5-8: `geom_simplified_medium` (1km)
- Zoom 9+: `geom_3857`, full resolution — unless the row's stored geometry
  exceeds the 10 MB display budget, which reads the 1km rung instead

Coverage-simplified means *within a sibling set of `regions`*. Borders across two
sets, a world view's root regions, and every rendered rung of
`administrative_divisions` are still simplified per row — see ADR-0031 decision 3
for what that costs and #560 for closing it.

The two cheap rungs use `ST_SimplifyPreserveTopology` over an input whose small
parts have been dropped, not the plain Douglas-Peucker they used to (ADR-0031):
nothing PostGIS offers deletes a ring, so dropping parts is the only thing that
makes an overview rung cheap, and doing it per row rather than by coverage is
what used to pull neighbouring borders apart.

Adjust in `db/init/01-schema.sql`, which defines both the tile functions and the
triggers that fill those columns. See `docs/tech/geometry-columns.md` for why
there are two cheap rungs and why the ladder is capped by what a row weighs.
