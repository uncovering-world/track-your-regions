# Geoshape Precision Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a geoshape match suggests an overly large GADM division (e.g., an entire province for an island), automatically drill down to tighter-fitting child divisions.

**Architecture:** After the existing covering set is built (shallowest-first), a new `refineCoveringSet()` function checks each division's precision (intersection/gadm_area). Divisions with precision < 0.5 are recursively replaced by their children that intersect the geoshape, if children collectively cover ≥ 80% of what the parent covered.

**Tech Stack:** TypeScript, PostgreSQL/PostGIS, Vitest

**Design spec:** `docs/tech/planning/2026-03-28-geoshape-precision-matching-design.md`

---

## File Structure

### Modified Files
- `backend/src/services/worldViewImport/geoshapeCache.ts` — Add `refineCoveringSet()`, modify coverage query to return intersection + gadm areas, call refinement after covering set build

---

### Task 1: Extend coverage query to return intersection_area and gadm_area

**Files:**
- Modify: `backend/src/services/worldViewImport/geoshapeCache.ts`

Currently the batch coverage query (lines 409-427) returns only `coverage` (intersection/wiki_area). The refinement needs `intersection_area` and `gadm_area` separately to compute precision.

- [ ] **Step 1: Modify the coverage SQL query**

In `geoshapeCache.ts`, change the coverage query (lines 408-427) from:

```sql
SELECT ad.id AS division_id,
  safe_geo_area(
    ST_ForcePolygonCCW(ST_CollectionExtract(
      ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
    ))
  ) / NULLIF(wa.area, 0) AS coverage
FROM administrative_divisions ad, wiki w, wiki_area wa
WHERE ad.id = ANY($2)
  AND ad.geom_simplified_medium IS NOT NULL
```

To:

```sql
SELECT ad.id AS division_id,
  safe_geo_area(
    ST_ForcePolygonCCW(ST_CollectionExtract(
      ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
    ))
  ) / NULLIF(wa.area, 0) AS coverage,
  safe_geo_area(
    ST_ForcePolygonCCW(ST_CollectionExtract(
      ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
    ))
  ) AS intersection_area,
  safe_geo_area(ad.geom_simplified_medium) AS gadm_area
FROM administrative_divisions ad, wiki w, wiki_area wa
WHERE ad.id = ANY($2)
  AND ad.geom_simplified_medium IS NOT NULL
```

- [ ] **Step 2: Extend the coverageMap to store all three values**

Change the `coverageMap` (lines 430-436) from `Map<number, number>` to store an object:

```typescript
// Build coverage map with precision data
interface CoverageEntry {
  coverage: number;        // intersection_area / wiki_area
  intersectionArea: number;
  gadmArea: number;
}
const coverageMap = new Map<number, CoverageEntry>();
for (const row of coverageResult.rows) {
  const coverage = row.coverage as number | null;
  if (coverage != null && coverage > 0.01) {
    coverageMap.set(row.division_id as number, {
      coverage,
      intersectionArea: row.intersection_area as number,
      gadmArea: row.gadm_area as number,
    });
  }
}
```

- [ ] **Step 3: Update all coverageMap consumers**

The `CandidateInfo` type (line 444) and all references to `coverageMap.get(id)` need updating:

Change the `CandidateInfo` type to include the new fields:
```typescript
type CandidateInfo = {
  id: number; name: string; path: string;
  parentId: number | null; gadmDepth: number;
  coverage: number; intersectionArea: number; gadmArea: number;
};
```

Update the candidateInfoMap builder (lines 446-457) — change `coverage: coverageMap.get(id)!` to:
```typescript
const entry = coverageMap.get(id)!;
candidateInfoMap.set(id, {
  id,
  name: row.name as string,
  path: row.path as string,
  parentId: row.parent_id as number | null,
  gadmDepth: row.gadm_depth as number,
  coverage: entry.coverage,
  intersectionArea: entry.intersectionArea,
  gadmArea: entry.gadmArea,
});
```

Update the filter check (line 448) from `if (!coverageMap.has(id)) continue;` — this stays the same since `coverageMap.has()` still works.

- [ ] **Step 4: Verify no type errors**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit --project backend/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/worldViewImport/geoshapeCache.ts
git commit -m "refactor(geoshape): extend coverage query with intersection_area and gadm_area"
```

---

### Task 2: Implement refineCoveringSet function

**Files:**
- Modify: `backend/src/services/worldViewImport/geoshapeCache.ts`

- [ ] **Step 1: Add the refineCoveringSet function**

Add this function before `geoshapeMatchRegion()` (insert around line 253, before the main function):

```typescript
/**
 * Refine a covering set by drilling down into children when a division
 * is too imprecise (includes >2x the geoshape's area).
 *
 * For each division with precision < 0.5, queries its children that intersect
 * the geoshape. If children collectively cover ≥ 80% of what the parent covered,
 * replaces the parent with children. Recurses up to maxDepth levels.
 */
async function refineCoveringSet(
  coveringSet: Array<{
    id: number; name: string; path: string;
    parentId: number | null; gadmDepth: number;
    coverage: number; intersectionArea: number; gadmArea: number;
  }>,
  wikidataId: string,
  wikiArea: number,
  depth: number = 0,
  maxDepth: number = 3,
): Promise<typeof coveringSet> {
  if (depth >= maxDepth) return coveringSet;

  const refined: typeof coveringSet = [];

  for (const entry of coveringSet) {
    const precision = entry.gadmArea > 0 ? entry.intersectionArea / entry.gadmArea : 1;

    if (precision >= 0.5) {
      // Division fits well enough — keep it
      refined.push(entry);
      continue;
    }

    console.log(`  [Geoshape Refine] ${entry.name} (id=${entry.id}): precision=${(precision * 100).toFixed(1)}% — drilling down to children`);

    // Query children that intersect the geoshape
    const childResult = await pool.query(`
      WITH wiki AS (
        SELECT ST_ForcePolygonCCW(geom) AS geom
        FROM wikidata_geoshapes
        WHERE wikidata_id = $1 AND not_available = FALSE
      )
      SELECT ad.id, ad.name, ad.parent_id,
        safe_geo_area(
          ST_ForcePolygonCCW(ST_CollectionExtract(
            ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
          ))
        ) AS intersection_area,
        safe_geo_area(ad.geom_simplified_medium) AS gadm_area,
        (WITH RECURSIVE div_ancestors AS (
          SELECT ad.id AS aid, ad.name AS aname, ad.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM administrative_divisions ad, wiki w
      WHERE ad.parent_id = $2
        AND ad.geom_simplified_medium IS NOT NULL
        AND ST_Intersects(ad.geom_simplified_medium, w.geom)
    `, [wikidataId, entry.id]);

    if (childResult.rows.length === 0) {
      // No children found — keep the parent (it's a leaf GADM division)
      refined.push(entry);
      continue;
    }

    // Filter children by coverage > 1% and compute coverage
    const children: typeof coveringSet = [];
    let childTotalIntersection = 0;
    for (const row of childResult.rows) {
      const intersectionArea = row.intersection_area as number;
      const gadmArea = row.gadm_area as number;
      const coverage = wikiArea > 0 ? intersectionArea / wikiArea : 0;
      if (coverage < 0.01) continue; // Skip tiny overlaps
      childTotalIntersection += intersectionArea;
      children.push({
        id: row.id as number,
        name: row.name as string,
        path: row.path as string,
        parentId: row.parent_id as number | null,
        gadmDepth: entry.gadmDepth + 1,
        coverage,
        intersectionArea,
        gadmArea,
      });
    }

    // Check if children collectively cover ≥ 80% of what the parent covered
    const childCoverageRatio = entry.intersectionArea > 0
      ? childTotalIntersection / entry.intersectionArea
      : 0;

    if (childCoverageRatio >= 0.8 && children.length > 0) {
      console.log(`  [Geoshape Refine] Replaced ${entry.name} with ${children.length} children (${(childCoverageRatio * 100).toFixed(0)}% coverage retained)`);
      // Recurse on children that are also imprecise
      const refinedChildren = await refineCoveringSet(children, wikidataId, wikiArea, depth + 1, maxDepth);
      refined.push(...refinedChildren);
    } else {
      console.log(`  [Geoshape Refine] Keeping ${entry.name} — children only cover ${(childCoverageRatio * 100).toFixed(0)}% of parent's contribution`);
      refined.push(entry);
    }
  }

  return refined;
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit --project backend/tsconfig.json`
Expected: No errors (function is defined but not yet called)

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/worldViewImport/geoshapeCache.ts
git commit -m "feat(geoshape): add refineCoveringSet function for precision drill-down"
```

---

### Task 3: Integrate refinement into geoshapeMatchRegion

**Files:**
- Modify: `backend/src/services/worldViewImport/geoshapeCache.ts`

- [ ] **Step 1: Compute wikiArea for the refinement call**

The `wikiArea` is already computed inside the batch coverage query CTE but not exposed as a variable. Add it right after the coverage query result processing (after line 436 / the coverageMap build loop). Query it from the cached geoshape:

```typescript
// Compute wiki area for refinement precision checks
const wikiAreaResult = await pool.query(`
  SELECT safe_geo_area(ST_ForcePolygonCCW(geom)) AS area
  FROM wikidata_geoshapes
  WHERE wikidata_id = $1 AND not_available = FALSE
`, [wikidataId]);
const wikiArea = (wikiAreaResult.rows[0]?.area as number) ?? 0;
```

Insert this after the `coverageMap` build and before the "Build hierarchy-aware covering set" section.

- [ ] **Step 2: Call refineCoveringSet after the covering set is built**

After the covering set is built (after line 486 — the end of the greedy covering set loop) and before the empty check (line 488), add:

```typescript
  // 7b. Refine covering set: drill down into children when a division is too imprecise
  const refinedCoveringSet = await refineCoveringSet(coveringSet, wikidataId, wikiArea);
```

- [ ] **Step 3: Replace coveringSet with refinedCoveringSet in all downstream code**

In the remaining code (Steps 8-9), replace all references to `coveringSet` with `refinedCoveringSet`:

- Line ~488 (empty check): `if (refinedCoveringSet.length === 0) {`
- Line ~494: `const selectedDivisionIds = refinedCoveringSet.map(c => c.id);`
- Line ~529 (suggestion loop): `for (const c of refinedCoveringSet) {`

- [ ] **Step 4: Verify no type errors**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit --project backend/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Manual test**

Run geoshape match on Flores (Indonesia) via the admin UI. Expected:
- Log shows `[Geoshape Refine] Nusa Tenggara Timur ... precision=X% — drilling down to children`
- Log shows `Replaced Nusa Tenggara Timur with N children`
- Suggestions show individual regencies on Flores (Manggarai, Ende, Sikka, etc.) instead of the whole NTT province

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/worldViewImport/geoshapeCache.ts
git commit -m "feat(geoshape): integrate precision drill-down into covering set builder"
```

---

### Task 4: Pre-commit checks

- [ ] **Step 1: Run full check suite**

```bash
npm run check
npm run knip
TEST_REPORT_LOCAL=1 npm test
npm run security:all
```

Expected: All pass. Any new lint warnings in geoshapeCache.ts should be addressed.

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add backend/src/services/worldViewImport/geoshapeCache.ts
git commit -m "fix(geoshape): address lint issues from precision matching"
```
