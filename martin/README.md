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
   - `geom_simplified_low` - Zoom 0-4 (10km tolerance)
   - `geom_simplified_medium` - Zoom 5-8 (1km tolerance)
3. **Spatial indexes** on all geometry columns
4. **Automatic triggers** keep derived columns in sync

These optimizations are applied by running:
```bash
psql -d track_regions < db/init/03-geom-3857-columns.sql
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

### Table Sources (auto-discovered)

| Endpoint | Description |
|----------|-------------|
| `/administrative_divisions/{z}/{x}/{y}` | Full-resolution GADM boundaries |
| `/administrative_divisions_low/{z}/{x}/{y}` | Low-detail GADM (zoom 0-4) |
| `/administrative_divisions_medium/{z}/{x}/{y}` | Medium-detail GADM (zoom 5-8) |
| `/regions/{z}/{x}/{y}` | Custom world view regions (full geom) |
| `/regions_hull/{z}/{x}/{y}` | Region TS hull geometries |
| `/regions_display/{z}/{x}/{y}` | Region display geometries |

### Function Sources (dynamic queries)

| Endpoint | Parameters | Description |
|----------|------------|-------------|
| `/tile_world_view_root_regions/{z}/{x}/{y}` | `world_view_id` | Root regions for a world view |
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
- `db/init/02-martin-functions.sql`

These are automatically created when the database is initialized.

To manually add them to an existing database:

```bash
psql -h localhost -U postgres -d track_regions -f db/init/02-martin-functions.sql
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

The SQL functions use zoom-dependent simplification:
- Zoom 0-2: tolerance 0.1°
- Zoom 3-4: tolerance 0.05°
- Zoom 5-6: tolerance 0.01°
- Zoom 7-8: tolerance 0.005°
- Zoom 9+: tolerance 0.001°

Adjust these in `02-martin-functions.sql` if needed.
