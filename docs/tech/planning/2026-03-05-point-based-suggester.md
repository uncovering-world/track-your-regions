# Point-Based Division Suggester — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-region matching tool that uses Wikivoyage marker coordinates to suggest GADM division assignments when geoshapes are unavailable.

**Architecture:** New backend service `pointMatcher.ts` parses Wikivoyage `{{marker}}`/`{{geo}}` templates, resolves coordinates via Wikidata P625, then finds the shallowest GADM divisions containing those points (excluding sibling-assigned divisions). New controller endpoint, frontend button with `PlaceIcon`, reuses existing suggestion review flow.

**Tech Stack:** TypeScript, PostgreSQL/PostGIS (ST_Contains), Wikivoyage MediaWiki API, Wikidata `wbgetentities` API.

---

### Task 1: Parse `{{marker}}` and `{{geo}}` templates from wikitext

**Files:**
- Create: `backend/src/services/wikivoyageExtract/markerParser.ts`
- Create: `backend/src/services/wikivoyageExtract/__tests__/markerParser.test.ts`

**Step 1: Write the failing tests**

```typescript
// backend/src/services/wikivoyageExtract/__tests__/markerParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseMarkers, parseGeoTag } from '../markerParser.js';

describe('parseMarkers', () => {
  it('extracts explicit lat/long from marker', () => {
    const text = '{{marker|type=city|name=Cabinda|lat=-5.55|long=12.20}}';
    const result = parseMarkers(text);
    expect(result).toEqual([{ name: 'Cabinda', lat: -5.55, lon: 12.20, wikidataId: null }]);
  });

  it('extracts wikidata ID when no coords', () => {
    const text = '{{marker|type=city|name=[[Luanda]]|wikidata=Q3897}}';
    const result = parseMarkers(text);
    expect(result).toEqual([{ name: 'Luanda', lat: null, lon: null, wikidataId: 'Q3897' }]);
  });

  it('handles mixed markers', () => {
    const text = `
      {{marker|type=city|name=Cabinda|lat=-5.55|long=12.20}}
      {{marker|type=city|name=[[Luanda]]|wikidata=Q3897|lat=-8.84|long=13.23}}
      {{marker|type=city|name=Lobito|wikidata=Q187764}}
    `;
    const result = parseMarkers(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ name: 'Cabinda', lat: -5.55, lon: 12.20 });
    expect(result[1]).toMatchObject({ name: 'Luanda', lat: -8.84, lon: 13.23, wikidataId: 'Q3897' });
    expect(result[2]).toMatchObject({ name: 'Lobito', lat: null, lon: null, wikidataId: 'Q187764' });
  });

  it('strips wikilinks from name', () => {
    const text = '{{marker|type=city|name=[[São Tomé]]|wikidata=Q3921}}';
    const result = parseMarkers(text);
    expect(result[0].name).toBe('São Tomé');
  });

  it('returns empty for no markers', () => {
    expect(parseMarkers('Some regular text')).toEqual([]);
  });

  it('ignores markers without name', () => {
    const text = '{{marker|type=go|lat=1|long=2}}';
    const result = parseMarkers(text);
    expect(result).toEqual([]);
  });
});

describe('parseGeoTag', () => {
  it('extracts geo tag coordinates', () => {
    const text = '{{geo|lat=-12.5|long=18.5|zoom=6}}';
    expect(parseGeoTag(text)).toEqual({ lat: -12.5, lon: 18.5 });
  });

  it('extracts positional geo tag', () => {
    const text = '{{geo|-12.5|18.5|zoom=6}}';
    expect(parseGeoTag(text)).toEqual({ lat: -12.5, lon: 18.5 });
  });

  it('returns null when no geo tag', () => {
    expect(parseGeoTag('No geo here')).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `TEST_REPORT_LOCAL=1 npx vitest run backend/src/services/wikivoyageExtract/__tests__/markerParser.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// backend/src/services/wikivoyageExtract/markerParser.ts
/**
 * Parse Wikivoyage {{marker}} and {{geo}} templates from wikitext.
 * Pure functions, no I/O.
 */

export interface ParsedMarker {
  name: string;
  lat: number | null;
  lon: number | null;
  wikidataId: string | null;
}

/**
 * Extract {{marker}} templates from wikitext.
 * Returns markers with explicit coords and/or Wikidata IDs for resolution.
 * Only includes markers that have a name (city/region markers, not POI-only).
 */
export function parseMarkers(text: string): ParsedMarker[] {
  const results: ParsedMarker[] = [];
  // Match {{marker|...}} — handles nested {{ but not recursive
  const re = /\{\{marker\s*\|([^}]+)\}\}/gi;

  for (const match of text.matchAll(re)) {
    const params = parseTemplateParams(match[1]);
    const rawName = params.get('name');
    if (!rawName) continue;

    // Strip wikilinks: [[São Tomé]] → São Tomé, [[São Tomé|display]] → display
    const name = rawName.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').trim();
    if (!name) continue;

    const lat = params.has('lat') ? parseFloat(params.get('lat')!) : null;
    const lon = params.has('long') ? parseFloat(params.get('long')!) : null;
    const wikidataId = params.get('wikidata') ?? null;

    results.push({
      name,
      lat: lat != null && !isNaN(lat) ? lat : null,
      lon: lon != null && !isNaN(lon) ? lon : null,
      wikidataId,
    });
  }

  return results;
}

/**
 * Extract {{geo}} tag from wikitext. Returns center coordinate or null.
 * Supports both named params (lat=/long=) and positional ({{geo|lat|lon|...}}).
 */
export function parseGeoTag(text: string): { lat: number; lon: number } | null {
  const re = /\{\{geo\s*\|([^}]+)\}\}/i;
  const match = text.match(re);
  if (!match) return null;

  const params = parseTemplateParams(match[1]);

  // Try named params first
  if (params.has('lat') && params.has('long')) {
    const lat = parseFloat(params.get('lat')!);
    const lon = parseFloat(params.get('long')!);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }

  // Try positional: {{geo|lat|lon|...}}
  const parts = match[1].split('|').map(p => p.trim());
  const positional = parts.filter(p => !p.includes('='));
  if (positional.length >= 2) {
    const lat = parseFloat(positional[0]);
    const lon = parseFloat(positional[1]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }

  return null;
}

/** Parse pipe-separated template params into a Map */
function parseTemplateParams(paramStr: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of paramStr.split('|')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      map.set(part.slice(0, eqIdx).trim().toLowerCase(), part.slice(eqIdx + 1).trim());
    }
  }
  return map;
}
```

**Step 4: Run tests to verify they pass**

Run: `TEST_REPORT_LOCAL=1 npx vitest run backend/src/services/wikivoyageExtract/__tests__/markerParser.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add backend/src/services/wikivoyageExtract/markerParser.ts backend/src/services/wikivoyageExtract/__tests__/markerParser.test.ts
git commit -m "feat: add Wikivoyage marker and geo tag parser"
```

---

### Task 2: Resolve Wikidata P625 coordinates for markers missing lat/lon

**Files:**
- Create: `backend/src/services/worldViewImport/pointMatcher.ts`

This task creates the main service file with coordinate resolution logic. The Wikidata `wbgetentities` API is used to batch-fetch P625 (coordinate location) claims.

**Step 1: Write the coordinate resolution function**

```typescript
// backend/src/services/worldViewImport/pointMatcher.ts
/**
 * Point-based division matcher.
 *
 * Fetches Wikivoyage marker coordinates, resolves missing coords via Wikidata P625,
 * then finds GADM divisions containing the points (excluding sibling-assigned divisions).
 */

import { pool } from '../../db/index.js';
import type { ParsedMarker } from '../../services/wikivoyageExtract/markerParser.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions)';

export interface ResolvedPoint {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Resolve coordinates for markers that have wikidata IDs but no lat/lon.
 * Batch-queries Wikidata wbgetentities API (up to 50 per request) for P625 claims.
 */
export async function resolveMarkerCoordinates(markers: ParsedMarker[]): Promise<ResolvedPoint[]> {
  const resolved: ResolvedPoint[] = [];
  const needsResolution: ParsedMarker[] = [];

  for (const m of markers) {
    if (m.lat != null && m.lon != null) {
      resolved.push({ name: m.name, lat: m.lat, lon: m.lon });
    } else if (m.wikidataId) {
      needsResolution.push(m);
    }
    // Markers with neither coords nor wikidata ID are skipped
  }

  if (needsResolution.length === 0) return resolved;

  // Batch fetch P625 coordinates from Wikidata (max 50 per request)
  for (let i = 0; i < needsResolution.length; i += 50) {
    const batch = needsResolution.slice(i, i + 50);
    const ids = batch.map(m => m.wikidataId!).join('|');

    try {
      const url = new URL(WIKIDATA_API);
      url.searchParams.set('action', 'wbgetentities');
      url.searchParams.set('ids', ids);
      url.searchParams.set('props', 'claims');
      url.searchParams.set('format', 'json');

      const resp = await fetch(url.toString(), {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.warn(`[PointMatch] Wikidata API returned ${resp.status}`);
        continue;
      }

      const data = await resp.json() as {
        entities?: Record<string, {
          claims?: { P625?: Array<{ mainsnak?: { datavalue?: { value?: { latitude: number; longitude: number } } } }> };
        }>;
      };

      if (!data.entities) continue;

      for (const marker of batch) {
        const entity = data.entities[marker.wikidataId!];
        const p625 = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
        if (p625) {
          resolved.push({ name: marker.name, lat: p625.latitude, lon: p625.longitude });
        }
      }
    } catch (err) {
      console.warn(`[PointMatch] Wikidata batch fetch failed:`, err instanceof Error ? err.message : err);
    }
  }

  return resolved;
}
```

**Step 2: Commit**

```bash
git add backend/src/services/worldViewImport/pointMatcher.ts
git commit -m "feat: add Wikidata P625 coordinate resolution for markers"
```

---

### Task 3: Implement GADM point-containment and covering-set algorithm

**Files:**
- Modify: `backend/src/services/worldViewImport/pointMatcher.ts`

Add the main `pointMatchRegion()` function that:
1. Fetches Wikivoyage page wikitext
2. Parses markers, resolves coordinates
3. Queries GADM divisions via ST_Contains
4. Builds covering set excluding sibling divisions

**Step 1: Add the main matching function**

Append to `pointMatcher.ts`:

```typescript
import { parseMarkers, parseGeoTag } from '../../services/wikivoyageExtract/markerParser.js';

const WV_API = 'https://en.wikivoyage.org/w/api.php';

/**
 * Fetch wikitext content of a Wikivoyage page by title.
 */
async function fetchWikivoyageWikitext(title: string): Promise<string | null> {
  const url = new URL(WV_API);
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', title);
  url.searchParams.set('prop', 'wikitext');
  url.searchParams.set('format', 'json');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;

  const data = await resp.json() as { parse?: { wikitext?: { '*': string } } };
  return data.parse?.wikitext?.['*'] ?? null;
}

/**
 * Point-match a region: parse Wikivoyage markers → find GADM divisions containing points.
 *
 * Returns suggestions in the same format as geoshapeMatchRegion().
 */
export async function pointMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ found: number; suggestions: Array<{ divisionId: number; name: string; path: string; score: number }> }> {
  // 1. Get region's source URL (Wikivoyage page title) and source_external_id
  const risResult = await pool.query(
    `SELECT ris.source_url, ris.source_external_id, r.is_leaf, r.parent_region_id
     FROM region_import_state ris
     JOIN regions r ON r.id = ris.region_id
     WHERE ris.region_id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  if (risResult.rows.length === 0) return { found: 0, suggestions: [] };

  const sourceUrl = risResult.rows[0].source_url as string | null;
  const isLeaf = risResult.rows[0].is_leaf as boolean;
  const parentRegionId = risResult.rows[0].parent_region_id as number | null;

  // Extract page title from source URL
  const pageTitle = sourceUrl
    ? decodeURIComponent(sourceUrl.replace('https://en.wikivoyage.org/wiki/', '').replace(/_/g, ' '))
    : null;
  if (!pageTitle) return { found: 0, suggestions: [] };

  // 2. Fetch wikitext and parse markers
  const wikitext = await fetchWikivoyageWikitext(pageTitle);
  if (!wikitext) return { found: 0, suggestions: [] };

  let markers = parseMarkers(wikitext);
  let points = await resolveMarkerCoordinates(markers);

  // Fallback to {{geo}} tag if no markers resolved
  if (points.length === 0) {
    const geo = parseGeoTag(wikitext);
    if (geo) {
      points = [{ name: pageTitle, lat: geo.lat, lon: geo.lon }];
    }
  }

  if (points.length === 0) return { found: 0, suggestions: [] };

  console.log(`[PointMatch] Region ${regionId} (${pageTitle}): ${points.length} points resolved`);

  // 3. Get sibling-assigned division IDs (divisions assigned to siblings of this region)
  const siblingDivisionIds = new Set<number>();
  if (parentRegionId != null) {
    const siblingResult = await pool.query(
      `SELECT rm.division_id
       FROM region_members rm
       JOIN regions r ON r.id = rm.region_id
       WHERE r.parent_region_id = $1 AND rm.region_id != $2`,
      [parentRegionId, regionId],
    );
    for (const row of siblingResult.rows) {
      siblingDivisionIds.add(row.division_id as number);
    }
  }

  // 4. Scope: walk up the region tree to find nearest ancestor with assigned GADM divisions
  const ancestorResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_region_id, 0 AS depth FROM regions WHERE id = $1
      UNION ALL
      SELECT r.id, r.parent_region_id, a.depth + 1
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT a.id,
      (SELECT array_agg(rm.division_id) FROM region_members rm WHERE rm.region_id = a.id) AS division_ids
    FROM ancestors a
    ORDER BY a.depth
  `, [regionId]);

  let scopeDivisionIds: number[] = [];
  for (const row of ancestorResult.rows) {
    if ((row.id as number) === regionId) continue;
    const ids = row.division_ids as number[] | null;
    if (ids && ids.length > 0) {
      scopeDivisionIds = ids;
      break;
    }
  }

  // 5. For each point, find GADM divisions containing it (with scope constraint)
  // Query all points at once using ST_Contains, scoped to GADM descendants of ancestor divisions
  const pointValues = points.map((p, i) => `($${i * 2 + 1}::float8, $${i * 2 + 2}::float8)`).join(', ');
  const pointParams = points.flatMap(p => [p.lon, p.lat]);

  let containmentQuery: string;
  let containmentParams: unknown[];

  if (scopeDivisionIds.length > 0) {
    containmentQuery = `
      WITH points(lon, lat) AS (VALUES ${pointValues}),
      scope AS (
        WITH RECURSIVE desc AS (
          SELECT id, parent_id, 0 AS depth FROM administrative_divisions WHERE id = ANY($${pointParams.length + 1})
          UNION ALL
          SELECT ad.id, ad.parent_id, d.depth + 1
          FROM administrative_divisions ad JOIN desc d ON ad.parent_id = d.id
        )
        SELECT id, parent_id, depth FROM desc
      )
      SELECT DISTINCT ad.id, ad.name, ad.parent_id, s.depth AS gadm_depth,
        (WITH RECURSIVE div_ancestors AS (
          SELECT ad.id AS aid, ad.name AS aname, ad.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM points p
      JOIN administrative_divisions ad ON ST_Contains(ad.geom_simplified_medium, ST_SetSRID(ST_Point(p.lon, p.lat), 4326))
      JOIN scope s ON ad.id = s.id
      WHERE ad.geom_simplified_medium IS NOT NULL
    `;
    containmentParams = [...pointParams, scopeDivisionIds];
  } else {
    containmentQuery = `
      WITH points(lon, lat) AS (VALUES ${pointValues})
      SELECT DISTINCT ad.id, ad.name, ad.parent_id, 0 AS gadm_depth,
        (WITH RECURSIVE div_ancestors AS (
          SELECT ad.id AS aid, ad.name AS aname, ad.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM points p
      JOIN administrative_divisions ad ON ST_Contains(ad.geom_simplified_medium, ST_SetSRID(ST_Point(p.lon, p.lat), 4326))
      WHERE ad.geom_simplified_medium IS NOT NULL
    `;
    containmentParams = pointParams;
  }

  const containResult = await pool.query(containmentQuery, containmentParams);

  if (containResult.rows.length === 0) {
    console.log(`[PointMatch] No GADM divisions contain any points for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // 6. Build covering set: shallowest divisions, excluding sibling-assigned
  // For each candidate division, check if it or any ancestor is sibling-assigned
  type CandidateInfo = { id: number; name: string; path: string; parentId: number | null; gadmDepth: number };
  const candidateMap = new Map<number, CandidateInfo>();
  for (const row of containResult.rows) {
    const id = row.id as number;
    if (!candidateMap.has(id) || (row.gadm_depth as number) < candidateMap.get(id)!.gadmDepth) {
      candidateMap.set(id, {
        id,
        name: row.name as string,
        path: row.path as string,
        parentId: row.parent_id as number | null,
        gadmDepth: row.gadm_depth as number,
      });
    }
  }

  // Filter: exclude sibling-assigned divisions and their ancestors
  // For sibling-assigned divisions, keep only their children that contain our points
  const filteredCandidates = [...candidateMap.values()]
    .filter(c => !siblingDivisionIds.has(c.id))
    .sort((a, b) => a.gadmDepth - b.gadmDepth);

  // Greedy covering set: pick shallowest, skip children of already-selected
  const selectedIds = new Set<number>();
  const coveringSet: CandidateInfo[] = [];

  for (const candidate of filteredCandidates) {
    // Skip if any ancestor already selected
    let ancestorSelected = false;
    let walkId: number | null = candidate.parentId;
    while (walkId != null) {
      if (selectedIds.has(walkId)) { ancestorSelected = true; break; }
      const parent = candidateMap.get(walkId);
      walkId = parent?.parentId ?? null;
      if (!parent) break;
    }
    if (!ancestorSelected) {
      selectedIds.add(candidate.id);
      coveringSet.push(candidate);
    }
  }

  if (coveringSet.length === 0) {
    console.log(`[PointMatch] No suitable divisions (all sibling-assigned) for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // 7. Load already-rejected, already-suggested, already-assigned IDs
  const [rejectedResult, existingResult, assignedResult] = await Promise.all([
    pool.query('SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = true', [regionId]),
    pool.query('SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = false', [regionId]),
    pool.query('SELECT division_id FROM region_members WHERE region_id = $1', [regionId]),
  ]);
  const skipIds = new Set<number>([
    ...rejectedResult.rows.map(r => r.division_id as number),
    ...existingResult.rows.map(r => r.division_id as number),
    ...assignedResult.rows.map(r => r.division_id as number),
  ]);

  const newSuggestions = coveringSet.filter(c => !skipIds.has(c.id));
  if (newSuggestions.length === 0) {
    console.log(`[PointMatch] All suggestions already handled for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // 8. Write suggestions to DB
  const newStatus = !isLeaf ? 'suggested' : 'needs_review';
  await pool.query(
    'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
    [newStatus, regionId],
  );

  const suggestions: Array<{ divisionId: number; name: string; path: string; score: number }> = [];
  for (const c of newSuggestions) {
    // Score: 500 base (point-based match is less precise than geoshape)
    const score = 500;
    suggestions.push({ divisionId: c.id, name: c.name, path: c.path, score });
    await pool.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
       VALUES ($1, $2, $3, $4, $5)`,
      [regionId, c.id, c.name, c.path, score],
    );
  }

  console.log(`[PointMatch] Suggestions for region ${regionId}: ${suggestions.map(s => s.name).join(', ')}`);
  return { found: suggestions.length, suggestions };
}
```

**Step 2: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Commit**

```bash
git add backend/src/services/worldViewImport/pointMatcher.ts
git commit -m "feat: add point-based GADM division matching service"
```

---

### Task 4: Add backend controller endpoint and route

**Files:**
- Modify: `backend/src/controllers/admin/wvImportAIController.ts` (add `pointMatch` export)
- Modify: `backend/src/controllers/admin/worldViewImportController.ts` (barrel re-export)
- Modify: `backend/src/routes/adminRoutes.ts` (add route)

**Step 1: Add controller function**

Add to `wvImportAIController.ts` (after the `geoshapeMatch` function):

```typescript
import { pointMatchRegion } from '../../services/worldViewImport/pointMatcher.js';

/**
 * Match a region using Wikivoyage marker coordinates → GADM point containment.
 * POST /api/admin/wv-import/matches/:worldViewId/point-match
 */
export async function pointMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/point-match — regionId=${regionId}`);

  try {
    const result = await pointMatchRegion(worldViewId, regionId);
    if (result.found > 0) {
      await computeGeoSimilarityIfNeeded(regionId);
    }
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Point match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Point match failed' });
  }
}
```

**Step 2: Update barrel re-export**

In `backend/src/controllers/admin/worldViewImportController.ts`, update the `wvImportAIController` line:

```typescript
export { startAIMatch, getAIMatchStatus, cancelAIMatchEndpoint, dbSearchOneRegion, geocodeMatch, geoshapeMatch, pointMatch, resetMatch, aiMatchOneRegion, aiSuggestChildren } from './wvImportAIController.js';
```

**Step 3: Add route**

In `backend/src/routes/adminRoutes.ts`, add import of `pointMatch` and the route:

```typescript
router.post('/wv-import/matches/:worldViewId/point-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), pointMatch);
```

Place it after the `geoshape-match` route.

**Step 4: Run typecheck + lint**

Run: `npm run check`
Expected: 0 errors

**Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportAIController.ts backend/src/controllers/admin/worldViewImportController.ts backend/src/routes/adminRoutes.ts
git commit -m "feat: add point-match endpoint for marker-based division matching"
```

---

### Task 5: Add frontend API function

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts`

**Step 1: Add API function**

After the `geoshapeMatchRegion` function (around line 299):

```typescript
export async function pointMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ found: number; suggestions: MatchSuggestion[] }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/point-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/adminWorldViewImport.ts
git commit -m "feat: add pointMatchRegion API function"
```

---

### Task 6: Add mutation hook for point match

**Files:**
- Modify: `frontend/src/components/admin/useTreeMutations.ts`

**Step 1: Add import and mutation**

Add `pointMatchRegion` to the import from `adminWorldViewImport`.

Add mutation (near the `geoshapeMatchMutation`, around line 304):

```typescript
const pointMatchMutation = useMutation({
  mutationFn: (regionId: number) => pointMatchRegion(worldViewId, regionId),
  onMutate: (regionId) => {
    setGeocodeProgress({ regionId, message: 'Matching by markers...' });
  },
  onSuccess: (data, regionId) => {
    setGeocodeProgress({
      regionId,
      message: data.found > 0 ? `Found ${data.found} division(s) from markers` : 'No divisions found from markers',
    });
    invalidateTree(regionId);
    setTimeout(() => setGeocodeProgress(null), 4000);
  },
  onError: () => {
    setGeocodeProgress(null);
  },
});
```

Add `pointMatchMutation.isPending` to the `isMutating` aggregate.

Add `pointMatchMutation` to the return object.

**Step 2: Run typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Commit**

```bash
git add frontend/src/components/admin/useTreeMutations.ts
git commit -m "feat: add pointMatchMutation to tree mutations hook"
```

---

### Task 7: Add PlaceIcon button to TreeNodeActions

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeActions.tsx`

**Step 1: Add props and button**

Add to `TreeNodeActionsProps`:
```typescript
pointMatchingRegionId: number | null;
onPointMatch: (regionId: number) => void;
```

Add `pointMatchingRegionId` to `SearchActionButtons` props and pass-through.

Add `ScatterPlot as PointMatchIcon` to the MUI imports (or `PinDrop` — `ScatterPlot` represents scattered points well).

Inside `SearchActionButtons`, after the geoshape button, add a new button:

```typescript
<Tooltip title={!wikidataId ? 'No Wikidata ID' : geoAvailable !== false ? 'Geoshape available — use geoshape match instead' : 'Point match (markers)'}>
  <span>
    <IconButton
      size="small"
      onClick={() => onPointMatch(nodeId)}
      disabled={isMutating || anySearching || !wikidataId || geoAvailable !== false}
      sx={{ p: 0.25 }}
    >
      {pointMatchingRegionId === nodeId
        ? <CircularProgress size={14} />
        : <PointMatchIcon sx={{ fontSize: 16, color: wikidataId && geoAvailable === false ? 'warning.main' : undefined }} />
      }
    </IconButton>
  </span>
</Tooltip>
```

Note the availability logic: **enabled when `wikidataId` exists AND `geoAvailable === false`** (geoshape not available). This is the complement of the geoshape button which is enabled when `geoAvailable !== false`.

**Step 2: Update prop threading**

Add `pointMatchingRegionId` and `onPointMatch` to `searchButtonProps` in the main `TreeNodeActions` function.

**Step 3: Run typecheck**

Run: `cd frontend && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add frontend/src/components/admin/TreeNodeActions.tsx
git commit -m "feat: add point match button to tree node actions"
```

---

### Task 8: Wire up point match in WorldViewImportTree and TreeNodeRow

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx`
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx`

**Step 1: Pass pointMatchMutation through**

In `WorldViewImportTree.tsx`:
- Destructure `pointMatchMutation` from `useTreeMutations()`
- Pass `onPointMatch={(regionId) => pointMatchMutation.mutate(regionId)}` to `TreeNodeRow`
- Pass `pointMatchingRegionId={pointMatchMutation.isPending ? (pointMatchMutation.variables ?? null) : null}`

In `TreeNodeRow.tsx`:
- Add `pointMatchingRegionId` and `onPointMatch` to the component's props
- Add to memoization comparison
- Pass through to `TreeNodeActions`

**Step 2: Run typecheck + lint**

Run: `npm run check`
Expected: 0 errors

**Step 3: Commit**

```bash
git add frontend/src/components/admin/WorldViewImportTree.tsx frontend/src/components/admin/TreeNodeRow.tsx
git commit -m "feat: wire point match button through tree component hierarchy"
```

---

### Task 9: Run all pre-commit checks

**Step 1: Lint + typecheck**

Run: `npm run check`
Expected: 0 errors

**Step 2: Unused files check**

Run: `npm run knip`
Expected: No new unused files

**Step 3: Unit tests**

Run: `TEST_REPORT_LOCAL=1 npm test`
Expected: All pass (including new markerParser tests)

**Step 4: Security scan**

Run: `npm run security:all`
Expected: No new issues

**Step 5: Security check**

Run: `/security-check`

**Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: pre-commit fixes for point-based suggester"
```

---

### Task 10: Update documentation

**Files:**
- Modify: `docs/tech/planning/2026-03-05-point-based-suggester-design.md` — trim to remaining ideas only
- Modify: `docs/vision/vision.md` — mention new marker-based matching capability under admin tools

**Step 1: Update vision doc**

Add a brief mention of the point-based division matching tool under the admin/WorldView Import section.

**Step 2: Trim planning doc**

Remove implemented sections, keep only future improvement ideas (e.g., parent-level clustering, caching markers).

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: update vision and planning for point-based suggester"
```
