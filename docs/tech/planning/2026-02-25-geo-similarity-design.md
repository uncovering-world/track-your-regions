# Geo Similarity — Design

**Status: Implemented**

## Solution

Compare Wikidata geoshapes with GADM suggestion geometries at match time using IoU (Intersection over Union). Cache geoshapes to avoid re-fetching. Show results as badges in the tree row and percentages in the suggestion list.

## Data Model

### New table: `wikidata_geoshapes`

```sql
CREATE TABLE IF NOT EXISTS wikidata_geoshapes (
    wikidata_id TEXT PRIMARY KEY,
    geom GEOMETRY(MultiPolygon, 4326),
    fetched_at TIMESTAMPTZ DEFAULT now(),
    not_available BOOLEAN DEFAULT FALSE
);
```

Cache of Wikidata geoshapes. `not_available = TRUE` means the QID has no geoshape (avoids re-fetching).

### New columns

- `region_match_suggestions.geo_similarity REAL` — IoU score 0.0-1.0, NULL if not computed
- `region_import_state.geo_available BOOLEAN DEFAULT NULL` — TRUE/FALSE/NULL (not yet checked)

## Backend

### Geoshape Cache Service

New file: `backend/src/services/worldViewImport/geoshapeCache.ts`

- `getOrFetchGeoshape(wikidataId: string): Promise<Geometry | null>`
- Checks `wikidata_geoshapes` table first
- On cache miss: fetches from `https://maps.wikimedia.org/geoshape?getgeojson=1&ids={wikidataId}`
- Stores result including `not_available=true` for 404/empty responses
- 1.5s delay between fetches (Wikimedia rate limits)

### IoU Computation

After suggestions are generated for a region with `source_external_id` (wikidataId):

1. `getOrFetchGeoshape(wikidataId)` — fetch/cache
2. If geometry exists: compute IoU for each suggestion via PostGIS:
   ```sql
   SELECT ST_Area(ST_Intersection(wg.geom, ad.geom_simplified_medium)) /
          NULLIF(ST_Area(ST_Union(wg.geom, ad.geom_simplified_medium)), 0) AS iou
   FROM wikidata_geoshapes wg, administrative_divisions ad
   WHERE wg.wikidata_id = $1 AND ad.id = $2
   ```
3. Update `region_match_suggestions.geo_similarity` with IoU value
4. Set `region_import_state.geo_available = TRUE`
5. If no geometry: set `geo_available = FALSE`

Uses `geom_simplified_medium` from GADM for performance.

### Integration Point

Hook into the matching phase in `matcher.ts` — after suggestions are written for a region, run geo comparison if wikidataId is available.

## Frontend

### Tree Row (Quick Scan)

In `TreeNodeRow.tsx`, next to existing match info:
- `geo_available === false`: greyed-out `PublicOff` icon, tooltip "No geoshape available"
- Top/accepted suggestion `geo_similarity >= 0.7`: green badge "Strong geo match"
- Top/accepted suggestion `geo_similarity >= 0.5`: amber badge "Geo match"

### Suggestion List (Expanded Detail)

Each suggestion shows `geo_similarity` as percentage:
- Green >= 0.7, amber >= 0.5, grey < 0.5
- NULL shows "—"

### API Types

- `MatchSuggestion`: add `geoSimilarity: number | null`
- `MatchTreeNode`: add `geoAvailable: boolean | null`

## Thresholds

- **Strong:** IoU >= 0.7 (green badge)
- **Close:** IoU >= 0.5 (amber badge)
- Below 0.5: no badge, shown as grey percentage in detail view
