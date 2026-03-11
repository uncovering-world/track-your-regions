# Geo Similarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Compare Wikidata geoshapes with GADM suggestion geometries at match time, flag close geometric matches in the UI.

**Architecture:** New `wikidata_geoshapes` cache table stores fetched geoshapes. After suggestions are written during matching, a geo-comparison pass fetches geoshapes (cached) and computes IoU against each suggestion's GADM geometry using PostGIS. Results stored as `geo_similarity` on suggestions and `geo_available` on import state. Frontend shows badges on tree rows and percentages in suggestion lists.

**Tech Stack:** PostGIS (ST_Intersection, ST_Union, ST_Area), Wikimedia geoshape API, React/MUI

---

### Task 1: Schema Changes

**Files:**
- Modify: `db/init/01-schema.sql`

**Step 1: Add `wikidata_geoshapes` table**

After the `region_map_images` table (around line 1904), add:

```sql
-- Cached Wikidata geoshapes (fetched from maps.wikimedia.org)
CREATE TABLE IF NOT EXISTS wikidata_geoshapes (
    wikidata_id TEXT PRIMARY KEY,
    geom GEOMETRY(MultiPolygon, 4326),
    fetched_at TIMESTAMPTZ DEFAULT now(),
    not_available BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_wg_geom ON wikidata_geoshapes USING GIST(geom);

COMMENT ON TABLE wikidata_geoshapes IS 'Cache of Wikidata geoshapes for geometric comparison during import matching';
COMMENT ON COLUMN wikidata_geoshapes.not_available IS 'True if QID has no geoshape (avoids re-fetching)';
```

**Step 2: Add `geo_similarity` to `region_match_suggestions`**

After the `rejected` column (line 1887):

```sql
    geo_similarity REAL  -- IoU score 0.0-1.0, NULL if not computed
```

**Step 3: Add `geo_available` to `region_import_state`**

After the `hierarchy_reviewed` column (line 1869):

```sql
    geo_available BOOLEAN DEFAULT NULL  -- TRUE/FALSE/NULL (not yet checked)
```

**Step 4: Apply migration to running DB**

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions <<'SQL'
CREATE TABLE IF NOT EXISTS wikidata_geoshapes (
    wikidata_id TEXT PRIMARY KEY,
    geom GEOMETRY(MultiPolygon, 4326),
    fetched_at TIMESTAMPTZ DEFAULT now(),
    not_available BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_wg_geom ON wikidata_geoshapes USING GIST(geom);
ALTER TABLE region_match_suggestions ADD COLUMN IF NOT EXISTS geo_similarity REAL;
ALTER TABLE region_import_state ADD COLUMN IF NOT EXISTS geo_available BOOLEAN DEFAULT NULL;
SQL
```

**Step 5: Commit**

```
feat: add wikidata_geoshapes table and geo_similarity columns
```

---

### Task 2: Geoshape Cache Service

**Files:**
- Create: `backend/src/services/worldViewImport/geoshapeCache.ts`

**Step 1: Create the service**

```typescript
import pool from '../../db.js';

const GEOSHAPE_URL = 'https://maps.wikimedia.org/geoshape';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions)';
const FETCH_DELAY_MS = 1500;

let lastFetchTime = 0;

/**
 * Get or fetch a Wikidata geoshape geometry.
 * Returns the PostGIS-stored geometry row, or null if not available.
 * Caches results (including "not available") in wikidata_geoshapes table.
 */
export async function getOrFetchGeoshape(wikidataId: string): Promise<boolean> {
  // Check cache first
  const cached = await pool.query(
    'SELECT not_available FROM wikidata_geoshapes WHERE wikidata_id = $1',
    [wikidataId],
  );
  if (cached.rows.length > 0) {
    return !cached.rows[0].not_available;
  }

  // Rate limit
  const now = Date.now();
  const elapsed = now - lastFetchTime;
  if (elapsed < FETCH_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS - elapsed));
  }
  lastFetchTime = Date.now();

  // Fetch from Wikimedia
  try {
    const url = `${GEOSHAPE_URL}?getgeojson=1&ids=${wikidataId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://en.wikivoyage.org/',
      },
    });

    if (!response.ok) {
      console.warn(`[GeoshapeCache] HTTP ${response.status} for ${wikidataId}`);
      await pool.query(
        `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
         ON CONFLICT (wikidata_id) DO NOTHING`,
        [wikidataId],
      );
      return false;
    }

    const geojson = await response.json();

    // Extract geometry from FeatureCollection
    const features = geojson?.features;
    if (!features || features.length === 0 || !features[0]?.geometry) {
      await pool.query(
        `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
         ON CONFLICT (wikidata_id) DO NOTHING`,
        [wikidataId],
      );
      return false;
    }

    const geometry = features[0].geometry;
    const geomJson = JSON.stringify(geometry);

    // Store with validation (convert to MultiPolygon)
    await pool.query(
      `INSERT INTO wikidata_geoshapes (wikidata_id, geom)
       VALUES ($1, validate_multipolygon(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)))
       ON CONFLICT (wikidata_id) DO NOTHING`,
      [wikidataId, geomJson],
    );

    return true;
  } catch (err) {
    console.error(`[GeoshapeCache] Failed to fetch geoshape for ${wikidataId}:`, err);
    await pool.query(
      `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
       ON CONFLICT (wikidata_id) DO NOTHING`,
      [wikidataId],
    );
    return false;
  }
}

/**
 * Compute IoU between a cached Wikidata geoshape and a GADM division.
 * Uses geom_simplified_medium for performance.
 * Returns IoU score (0.0-1.0) or null if geometries don't overlap / aren't available.
 */
export async function computeIoU(
  wikidataId: string,
  divisionId: number,
): Promise<number | null> {
  const result = await pool.query(`
    SELECT
      ST_Area(ST_Intersection(wg.geom, ad.geom_simplified_medium)::geography) /
      NULLIF(ST_Area(ST_Union(wg.geom, ad.geom_simplified_medium)::geography), 0) AS iou
    FROM wikidata_geoshapes wg, administrative_divisions ad
    WHERE wg.wikidata_id = $1
      AND wg.not_available = FALSE
      AND ad.id = $2
      AND ad.geom_simplified_medium IS NOT NULL
  `, [wikidataId, divisionId]);

  if (result.rows.length === 0) return null;
  const iou = result.rows[0].iou as number | null;
  return iou != null ? Math.round(iou * 1000) / 1000 : null;
}
```

**Notes:**
- `getOrFetchGeoshape` returns `boolean` (available/not). The geometry is stored in DB, used by `computeIoU` directly.
- IoU uses `::geography` cast for accurate area computation across different latitudes.
- `validate_multipolygon` is the existing DB function that normalizes geometry.

**Step 2: Commit**

```
feat: add geoshape cache service with IoU computation
```

---

### Task 3: Integrate Geo Comparison into Matching Pipeline

**Files:**
- Modify: `backend/src/services/worldViewImport/matcher.ts` (batch-write phase, ~line 590-626)

**Step 1: Add import**

At top of matcher.ts, add:
```typescript
import { getOrFetchGeoshape, computeIoU } from './geoshapeCache.js';
```

**Step 2: Add geo comparison after suggestions are written**

After the batch-write loop (after line 618, before `COMMIT`), add a geo-comparison pass:

```typescript
    // Phase 5: Geo comparison — compare Wikidata geoshapes with GADM suggestions
    progress.statusMessage = 'Computing geo similarity...';

    // Get wikidataIds for all regions that got suggestions
    const regionIdsWithSuggestions = updates
      .filter(u => u.suggestions.length > 0)
      .map(u => u.id);

    if (regionIdsWithSuggestions.length > 0) {
      const wikidataRows = await client.query(
        `SELECT region_id, source_external_id
         FROM region_import_state
         WHERE region_id = ANY($1) AND source_external_id IS NOT NULL`,
        [regionIdsWithSuggestions],
      );

      const wikidataMap = new Map<number, string>();
      for (const row of wikidataRows.rows) {
        wikidataMap.set(row.region_id as number, row.source_external_id as string);
      }

      for (const update of updates) {
        const wikidataId = wikidataMap.get(update.id);
        if (!wikidataId || update.suggestions.length === 0) {
          continue;
        }

        const available = await getOrFetchGeoshape(wikidataId);

        await client.query(
          `UPDATE region_import_state SET geo_available = $1 WHERE region_id = $2`,
          [available, update.id],
        );

        if (!available) continue;

        for (const suggestion of update.suggestions) {
          const iou = await computeIoU(wikidataId, suggestion.divisionId);
          if (iou != null) {
            await client.query(
              `UPDATE region_match_suggestions SET geo_similarity = $1
               WHERE region_id = $2 AND division_id = $3`,
              [iou, update.id, suggestion.divisionId],
            );
          }
        }
      }
    }
```

**Important:** This runs inside the existing transaction (using `client`), but `getOrFetchGeoshape` and `computeIoU` use `pool` (not the transaction client). The pool calls read/write the geoshape cache. The `client` calls update the import-specific tables within the transaction. This is safe because the geoshape cache is independent data.

**Step 3: Commit**

```
feat: compute geo similarity during matching phase
```

---

### Task 4: Also Run Geo Comparison for Other Match Paths

**Files:**
- Modify: `backend/src/services/worldViewImport/matcher.ts` (~line 840-860, ~line 1000-1015)

The matcher has three places where suggestions are written:
1. `matchChildrenAsCountries` (line 603-610) — **Task 3 covers this**
2. `matchSingleChildAsCountry` (line 855-860) — used by `handleAsGrouping`
3. `matchCountriesAsSubdivisions` (line 1008-1014) — used for subdivision drill-down

For paths 2 and 3, add the same geo comparison after suggestions are inserted. The pattern is the same: look up `source_external_id`, call `getOrFetchGeoshape`, then `computeIoU` per suggestion.

Extract a helper to avoid repeating the pattern:

```typescript
async function computeGeoSimilarityForRegion(
  client: PoolClient,
  regionId: number,
  suggestions: Array<{ divisionId: number }>,
): Promise<void> {
  const wdResult = await client.query(
    'SELECT source_external_id FROM region_import_state WHERE region_id = $1',
    [regionId],
  );
  const wikidataId = wdResult.rows[0]?.source_external_id as string | undefined;
  if (!wikidataId) return;

  const available = await getOrFetchGeoshape(wikidataId);
  await client.query(
    'UPDATE region_import_state SET geo_available = $1 WHERE region_id = $2',
    [available, regionId],
  );

  if (!available) return;

  for (const suggestion of suggestions) {
    const iou = await computeIoU(wikidataId, suggestion.divisionId);
    if (iou != null) {
      await client.query(
        `UPDATE region_match_suggestions SET geo_similarity = $1
         WHERE region_id = $2 AND division_id = $3`,
        [iou, regionId, suggestion.divisionId],
      );
    }
  }
}
```

Call this after each suggestion-write block. Also use it in the Task 3 loop to replace the inline code.

**Step 2: Commit**

```
feat: compute geo similarity for all match paths
```

---

### Task 5: Update Match Tree API Response

**Files:**
- Modify: `backend/src/controllers/admin/worldViewImportController.ts` (~line 590-670)

**Step 1: Add `geo_similarity` to the suggestions subquery**

Change line 604:
```sql
'divisionId', rms.division_id, 'name', rms.name, 'path', rms.path, 'score', rms.score
```
to:
```sql
'divisionId', rms.division_id, 'name', rms.name, 'path', rms.path, 'score', rms.score, 'geoSimilarity', rms.geo_similarity
```

**Step 2: Add `geo_available` to the SELECT**

After `ris.hierarchy_reviewed` (line 602), add:
```sql
      ris.geo_available,
```

**Step 3: Update the `TreeNode` interface**

Add to the interface (~line 641):
```typescript
    suggestions: Array<{ divisionId: number; name: string; path: string; score: number; geoSimilarity: number | null }>;
```

Add after `hierarchyReviewed`:
```typescript
    geoAvailable: boolean | null;
```

**Step 4: Update node creation**

In the node creation loop (~line 660-680), add:
```typescript
      geoAvailable: (row.geo_available as boolean | null) ?? null,
```

**Step 5: Commit**

```
feat: include geo_similarity and geo_available in match tree API
```

---

### Task 6: Update Frontend Types

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts`

**Step 1: Add `geoSimilarity` to `MatchSuggestion`**

```typescript
export interface MatchSuggestion {
  divisionId: number;
  name: string;
  path: string;
  score: number;
  geoSimilarity: number | null;  // ADD
}
```

**Step 2: Add `geoAvailable` to `MatchTreeNode`**

```typescript
export interface MatchTreeNode {
  // ... existing fields ...
  geoAvailable: boolean | null;  // ADD
  children: MatchTreeNode[];
}
```

**Step 3: Commit**

```
feat: add geoSimilarity and geoAvailable to frontend types
```

---

### Task 7: Tree Row Geo Badges

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx`

**Step 1: Add geo indicator to tree row**

After the existing match status indicators, add:
- If `node.geoAvailable === false`: greyed-out `PublicOff` icon, tooltip "No geoshape available for comparison"
- If top non-rejected suggestion has `geoSimilarity >= 0.7`: green chip "Strong geo match (XX%)"
- If top suggestion has `geoSimilarity >= 0.5`: amber chip "Geo match (XX%)"

Use MUI `Chip` component with `size="small"` and `variant="outlined"`.

**Step 2: Commit**

```
feat: show geo similarity badges on tree rows
```

---

### Task 8: Suggestion List Geo Percentages

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx` (or wherever the suggestion list is rendered within the row)

**Step 1: Add geo percentage to each suggestion**

In the suggestion list (where score, name, path are shown), add a geo similarity column:
- `geoSimilarity != null`: show as percentage (e.g., "78%"), color-coded (green >= 0.7, amber >= 0.5, grey < 0.5)
- `geoSimilarity == null`: show "—"

Use `Typography` with `color` prop for the color coding.

**Step 2: Commit**

```
feat: show geo similarity percentage in suggestion list
```

---

### Task 9: Update Undo Snapshots

**Files:**
- Modify: `backend/src/controllers/admin/worldViewImportController.ts`

The undo system snapshots `region_match_suggestions` rows. The existing `SuggestionSnapshot` type and the snapshot queries need to include `geo_similarity`.

**Step 1: Update SuggestionSnapshot type** to include `geo_similarity: number | null`

**Step 2: Update snapshot SELECTs** that read from `region_match_suggestions` for undo — add `geo_similarity` column.

**Step 3: Update restore INSERTs** that write suggestions back during undo — include `geo_similarity`.

**Step 4: Commit**

```
feat: include geo_similarity in undo snapshots
```

---

### Task 10: Pre-Commit Checks + Docs

**Step 1: Run checks**
```bash
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

**Step 2: Update design doc** — trim `docs/tech/planning/2026-02-25-geo-similarity-design.md` to only unimplemented improvements.

**Step 3: Commit**

```
docs: update geo similarity design doc
```
