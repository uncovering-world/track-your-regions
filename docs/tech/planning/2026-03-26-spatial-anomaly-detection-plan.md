# Spatial Anomaly Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect spatial anomalies (exclaves and disconnected fragments) in region assignments, integrated into Smart Simplify and the CV matching pipeline.

**Architecture:** A pure TypeScript graph algorithm (`detectSpatialAnomalies`) operates on an adjacency edge list + division-to-region assignments. PostGIS provides the adjacency graph via `ST_Touches`/`ST_DWithin` on `geom_simplified_medium`. The detector is called from two integration points: the Smart Simplify endpoint (on committed `region_members`) and the CV pipeline Phase 5 (on suggested assignments before commit). A lightweight client-side copy enables instant re-checks in paint mode.

**Tech Stack:** TypeScript, PostGIS (adjacency queries), Vitest (testing), React/MUI (frontend)

**Spec:** `docs/tech/planning/2026-03-26-spatial-anomaly-detection-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/src/services/worldViewImport/spatialAnomalyDetector.ts` | **New.** Core algorithm: `getAdjacencyGraph()`, `detectSpatialAnomalies()`, `detectAnomaliesForRegion()` |
| `backend/src/services/worldViewImport/spatialAnomalyDetector.test.ts` | **New.** Unit tests for the pure `detectSpatialAnomalies()` function |
| `backend/src/controllers/admin/wvImportTreeOpsController.ts` | **Modify.** Smart Simplify endpoint returns `spatialAnomalies` alongside `moves` |
| `backend/src/types/index.ts` | **Modify.** Add `skipSimplify` to `wvImportSmartSimplifyApplySchema` |
| `backend/src/controllers/admin/wvImportMatchShared.ts` | **Modify.** CV pipeline calls detector before `complete` event |
| `frontend/src/utils/spatialAnomalyDetector.ts` | **New.** Client-side pure `detectSpatialAnomalies()` + shared types |
| `frontend/src/api/adminWvImportTreeOps.ts` | **Modify.** Add `SpatialAnomaly` types, update `SmartSimplifyResult` |
| `frontend/src/api/adminWorldViewImport.ts` | **Modify.** Re-export new types |
| `frontend/src/api/adminWvImportCvMatch.ts` | **Modify.** Add `spatialAnomalies` + `adjacencyEdges` to `ColorMatchResult` |
| `frontend/src/components/admin/useCvMatchPipeline.ts` | **Modify.** Store anomalies in `CvMatchDialogState` |
| `frontend/src/components/admin/SmartSimplifyDialog.tsx` | **Modify.** Render spatial anomaly section below GADM-parent moves |
| `frontend/src/components/admin/CvGeoPreviewSection.tsx` | **Modify.** Warning banner + anomaly indicators |
| `frontend/src/components/admin/CvMatchMap.tsx` | **Modify.** Visual styling for anomalous divisions |

---

## Task 1: Core Algorithm — Pure Function + Tests

**Files:**
- Create: `backend/src/services/worldViewImport/spatialAnomalyDetector.ts`
- Create: `backend/src/services/worldViewImport/spatialAnomalyDetector.test.ts`

### Step 1.1: Write failing tests for connected component detection

- [ ] Create test file with test cases covering: single region all connected (no anomalies), one region with an exclave, region split into two disconnected groups, multiple regions with cross-region anomalies.

```typescript
// backend/src/services/worldViewImport/spatialAnomalyDetector.test.ts
import { describe, it, expect } from 'vitest';
import { detectSpatialAnomalies } from './spatialAnomalyDetector.js';
import type { DivisionAssignment, AdjacencyEdge, SpatialAnomaly } from './spatialAnomalyDetector.js';

describe('detectSpatialAnomalies', () => {
  it('returns empty array when all regions are fully connected', () => {
    // A-B-C all in Region 1, fully connected chain
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Region 1' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Region 1' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Region 1' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 2, divB: 3 },
    ];
    expect(detectSpatialAnomalies(assignments, edges)).toEqual([]);
  });

  it('detects a single exclave surrounded by another region', () => {
    // Region 1: divs 1,2,3 (connected). Region 2: divs 4,5,6 (connected) + div 7 (isolated, surrounded by Region 1)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'West' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'West' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'West' },
      { divisionId: 4, memberRowId: 13, regionId: 200, regionName: 'East' },
      { divisionId: 5, memberRowId: 14, regionId: 200, regionName: 'East' },
      { divisionId: 6, memberRowId: 15, regionId: 200, regionName: 'East' },
      { divisionId: 7, memberRowId: 16, regionId: 200, regionName: 'East' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 }, { divA: 2, divB: 3 }, // West connected
      { divA: 4, divB: 5 }, { divA: 5, divB: 6 }, // East main body connected
      // div 7 (East) only touches div 1 and 2 (West) — exclave
      { divA: 7, divB: 1 }, { divA: 7, divB: 2 },
    ];
    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].divisions.map(d => d.divisionId)).toEqual([7]);
    expect(result[0].divisions[0].sourceRegionId).toBe(200);
    expect(result[0].suggestedTargetRegionId).toBe(100);
    expect(result[0].fragmentSize).toBe(1);
    expect(result[0].totalRegionSize).toBe(4);
    expect(result[0].score).toBeCloseTo(0.25);
  });

  it('detects disconnected fragment with multiple divisions', () => {
    // Region 1: divs 1,2,3,4,5 (main) + divs 6,7 (fragment, only touching Region 2)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Alpha' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Alpha' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Alpha' },
      { divisionId: 4, memberRowId: 13, regionId: 100, regionName: 'Alpha' },
      { divisionId: 5, memberRowId: 14, regionId: 100, regionName: 'Alpha' },
      { divisionId: 6, memberRowId: 15, regionId: 100, regionName: 'Alpha' },
      { divisionId: 7, memberRowId: 16, regionId: 100, regionName: 'Alpha' },
      { divisionId: 8, memberRowId: 17, regionId: 200, regionName: 'Beta' },
      { divisionId: 9, memberRowId: 18, regionId: 200, regionName: 'Beta' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 }, { divA: 2, divB: 3 }, { divA: 3, divB: 4 }, { divA: 4, divB: 5 },
      { divA: 6, divB: 7 }, // fragment connected to each other
      { divA: 6, divB: 8 }, { divA: 7, divB: 9 }, // fragment touches Beta
      { divA: 8, divB: 9 }, // Beta connected
    ];
    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].divisions.map(d => d.divisionId).sort()).toEqual([6, 7]);
    expect(result[0].divisions[0].sourceRegionId).toBe(100);
    expect(result[0].suggestedTargetRegionId).toBe(200);
    expect(result[0].fragmentSize).toBe(2);
    expect(result[0].totalRegionSize).toBe(7);
  });

  it('handles region with no adjacency edges (isolated divisions)', () => {
    // Two divisions in one region, no edges between them, no other regions
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Solo' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Solo' },
    ];
    const edges: AdjacencyEdge[] = [];
    const result = detectSpatialAnomalies(assignments, edges);
    // Both are size-1 components with no cross-region neighbors → skipped (bestCount === 0)
    expect(result).toHaveLength(0);
  });

  it('returns empty for single-division region', () => {
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Single' },
      { divisionId: 2, memberRowId: 11, regionId: 200, regionName: 'Other' },
    ];
    const edges: AdjacencyEdge[] = [{ divA: 1, divB: 2 }];
    // Single-division regions can't have fragments
    expect(detectSpatialAnomalies(assignments, edges)).toEqual([]);
  });

  it('skips fragment with no cross-region neighbors (island)', () => {
    // Region A: divs 1,2 (connected) + div 3 (isolated, no neighbors at all)
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'Mainland' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'Mainland' },
      { divisionId: 3, memberRowId: 12, regionId: 100, regionName: 'Mainland' },
    ];
    const edges: AdjacencyEdge[] = [{ divA: 1, divB: 2 }];
    // div 3 is a fragment but has no neighbors in other regions → skipped
    expect(detectSpatialAnomalies(assignments, edges)).toEqual([]);
  });

  it('handles null memberRowId for suggested assignments', () => {
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: null, regionId: 100, regionName: 'R1' },
      { divisionId: 2, memberRowId: null, regionId: 100, regionName: 'R1' },
      { divisionId: 3, memberRowId: null, regionId: 200, regionName: 'R2' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 },
      { divA: 2, divB: 3 },
    ];
    // All connected, no fragments
    expect(detectSpatialAnomalies(assignments, edges)).toEqual([]);
  });

  it('sorts results by score ascending (most suspicious first)', () => {
    // Region A: 10 divs, 1 exclave (score 0.1). Region B: 4 divs, 1 exclave (score 0.25)
    const assignments: DivisionAssignment[] = [
      // Region A main: divs 1-9
      ...Array.from({ length: 9 }, (_, i) => ({
        divisionId: i + 1, memberRowId: i + 10, regionId: 100, regionName: 'Big',
      })),
      // Region A exclave: div 10
      { divisionId: 10, memberRowId: 19, regionId: 100, regionName: 'Big' },
      // Region B main: divs 11-13
      ...Array.from({ length: 3 }, (_, i) => ({
        divisionId: i + 11, memberRowId: i + 20, regionId: 200, regionName: 'Small',
      })),
      // Region B exclave: div 14
      { divisionId: 14, memberRowId: 23, regionId: 200, regionName: 'Small' },
      // Region C: divs 15-16 (neighbor for exclaves)
      { divisionId: 15, memberRowId: 24, regionId: 300, regionName: 'Neighbor' },
      { divisionId: 16, memberRowId: 25, regionId: 300, regionName: 'Neighbor' },
    ];
    const edges: AdjacencyEdge[] = [
      // Region A main chain
      ...Array.from({ length: 8 }, (_, i) => ({ divA: i + 1, divB: i + 2 })),
      // Region A exclave touches Neighbor only
      { divA: 10, divB: 15 },
      // Region B main chain
      { divA: 11, divB: 12 }, { divA: 12, divB: 13 },
      // Region B exclave touches Neighbor only
      { divA: 14, divB: 16 },
      // Neighbor connected
      { divA: 15, divB: 16 },
    ];
    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(2);
    // Big exclave: 1/10 = 0.1 should come first
    expect(result[0].divisions[0].sourceRegionName).toBe('Big');
    expect(result[0].score).toBeCloseTo(0.1);
    // Small exclave: 1/4 = 0.25 should come second
    expect(result[1].divisions[0].sourceRegionName).toBe('Small');
    expect(result[1].score).toBeCloseTo(0.25);
  });

  it('picks the dominant neighbor as suggested target', () => {
    // Exclave div 5 (Region A) touches div 6 (Region B) and div 7 (Region C)
    // and div 8 (Region B) — B has more neighbors, so B is the target
    const assignments: DivisionAssignment[] = [
      { divisionId: 1, memberRowId: 10, regionId: 100, regionName: 'A' },
      { divisionId: 2, memberRowId: 11, regionId: 100, regionName: 'A' },
      { divisionId: 5, memberRowId: 14, regionId: 100, regionName: 'A' }, // exclave
      { divisionId: 6, memberRowId: 15, regionId: 200, regionName: 'B' },
      { divisionId: 7, memberRowId: 16, regionId: 300, regionName: 'C' },
      { divisionId: 8, memberRowId: 17, regionId: 200, regionName: 'B' },
    ];
    const edges: AdjacencyEdge[] = [
      { divA: 1, divB: 2 }, // A main connected
      { divA: 5, divB: 6 }, // exclave touches B
      { divA: 5, divB: 7 }, // exclave touches C
      { divA: 5, divB: 8 }, // exclave touches B again
      { divA: 6, divB: 8 }, // B connected
    ];
    const result = detectSpatialAnomalies(assignments, edges);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedTargetRegionId).toBe(200); // B wins (2 neighbors vs C's 1)
  });
});
```

- [ ] Run tests to verify they fail:

```bash
cd backend && npx vitest run src/services/worldViewImport/spatialAnomalyDetector.test.ts
```

Expected: FAIL — module not found.

### Step 1.2: Implement the pure detection function

- [ ] Create the service file with types and the pure `detectSpatialAnomalies` function:

```typescript
// backend/src/services/worldViewImport/spatialAnomalyDetector.ts
import pool from '../../db.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DivisionAssignment {
  divisionId: number;
  memberRowId: number | null; // null for suggested (not yet committed) assignments
  regionId: number;
  regionName: string;
  divisionName?: string; // optional, for building anomaly output
}

export interface AdjacencyEdge {
  divA: number;
  divB: number;
}

export interface SpatialAnomalyDivision {
  divisionId: number;
  name: string;
  memberRowId: number | null;
  sourceRegionId: number;
  sourceRegionName: string;
}

export interface SpatialAnomaly {
  divisions: SpatialAnomalyDivision[];
  suggestedTargetRegionId: number;
  suggestedTargetRegionName: string;
  fragmentSize: number;
  totalRegionSize: number;
  score: number; // fragmentSize / totalRegionSize — lower = more suspicious
}

// ── Pure algorithm (no DB) ───────────────────────────────────────────────────

/**
 * Detect spatial anomalies (exclaves & disconnected fragments) from an
 * adjacency graph and division-to-region assignments. Pure function.
 */
export function detectSpatialAnomalies(
  assignments: DivisionAssignment[],
  edges: AdjacencyEdge[],
): SpatialAnomaly[] {
  // Build lookup: divisionId → assignment
  const assignmentMap = new Map<number, DivisionAssignment>();
  for (const a of assignments) assignmentMap.set(a.divisionId, a);

  // Build adjacency list (bidirectional)
  const adj = new Map<number, Set<number>>();
  for (const a of assignments) adj.set(a.divisionId, new Set());
  for (const { divA, divB } of edges) {
    adj.get(divA)?.add(divB);
    adj.get(divB)?.add(divA);
  }

  // Group divisions by region
  const regionDivisions = new Map<number, number[]>();
  for (const a of assignments) {
    const divs = regionDivisions.get(a.regionId) ?? [];
    divs.push(a.divisionId);
    regionDivisions.set(a.regionId, divs);
  }

  const anomalies: SpatialAnomaly[] = [];

  // For each region, find connected components using only intra-region edges
  for (const [regionId, divIds] of regionDivisions) {
    if (divIds.length <= 1) continue; // single div can't have fragments

    const divSet = new Set(divIds);
    const visited = new Set<number>();
    const components: number[][] = [];

    for (const startDiv of divIds) {
      if (visited.has(startDiv)) continue;
      // BFS within region
      const component: number[] = [];
      const queue = [startDiv];
      visited.add(startDiv);
      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor) && divSet.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    if (components.length <= 1) continue; // fully connected, no anomalies

    // Find the largest component (main body)
    components.sort((a, b) => b.length - a.length);
    const totalSize = divIds.length;

    // All non-largest components are fragments
    for (let i = 1; i < components.length; i++) {
      const fragment = components[i];

      // Find dominant neighboring region via cross-region adjacency
      const neighborVotes = new Map<number, number>();
      for (const divId of fragment) {
        for (const neighbor of adj.get(divId) ?? []) {
          const neighborAssignment = assignmentMap.get(neighbor);
          if (neighborAssignment && neighborAssignment.regionId !== regionId) {
            neighborVotes.set(
              neighborAssignment.regionId,
              (neighborVotes.get(neighborAssignment.regionId) ?? 0) + 1,
            );
          }
        }
      }

      // Pick the region with most neighbor contacts
      let bestTargetId = 0;
      let bestTargetName = 'Unknown';
      let bestCount = 0;
      for (const [nRegionId, count] of neighborVotes) {
        if (count > bestCount || (count === bestCount && nRegionId < bestTargetId)) {
          bestCount = count;
          const nAssignment = assignments.find(a => a.regionId === nRegionId);
          bestTargetId = nRegionId;
          bestTargetName = nAssignment?.regionName ?? 'Unknown';
        }
      }

      // If no cross-region neighbors found, skip (isolated island?)
      if (bestCount === 0) continue;

      const regionAssignment = assignmentMap.get(fragment[0])!;
      anomalies.push({
        divisions: fragment.map(divId => {
          const a = assignmentMap.get(divId)!;
          return {
            divisionId: divId,
            name: a.divisionName ?? `Division ${divId}`,
            memberRowId: a.memberRowId,
            sourceRegionId: regionId,
            sourceRegionName: regionAssignment.regionName,
          };
        }),
        suggestedTargetRegionId: bestTargetId,
        suggestedTargetRegionName: bestTargetName,
        fragmentSize: fragment.length,
        totalRegionSize: totalSize,
        score: fragment.length / totalSize,
      });
    }
  }

  // Sort by score ascending (most suspicious = smallest fraction first)
  anomalies.sort((a, b) => a.score - b.score);
  return anomalies;
}
```

- [ ] Run tests to verify they pass:

```bash
cd backend && npx vitest run src/services/worldViewImport/spatialAnomalyDetector.test.ts
```

Expected: all tests PASS.

### Step 1.3: Add the PostGIS adjacency query function

- [ ] Add `getAdjacencyGraph` and `detectAnomaliesForRegion` to the service file:

```typescript
// Add to spatialAnomalyDetector.ts, after the pure function

// ── PostGIS adjacency query ──────────────────────────────────────────────────

/**
 * Query PostGIS for adjacency edges among given division IDs.
 * Uses geom_simplified_medium + ST_Touches/ST_DWithin for performance.
 */
export async function getAdjacencyGraph(divisionIds: number[]): Promise<AdjacencyEdge[]> {
  if (divisionIds.length < 2) return [];

  const { rows } = await pool.query<{ div_a: number; div_b: number }>(
    `SELECT a.id AS div_a, b.id AS div_b
     FROM administrative_divisions a
     JOIN administrative_divisions b ON a.id < b.id
     WHERE a.id = ANY($1) AND b.id = ANY($1)
       AND (ST_Touches(a.geom_simplified_medium, b.geom_simplified_medium)
            OR ST_DWithin(a.geom_simplified_medium, b.geom_simplified_medium, 0.0001))`,
    [divisionIds],
  );

  return rows.map(r => ({ divA: r.div_a, divB: r.div_b }));
}

// ── Convenience wrapper for committed region_members ─────────────────────────

/**
 * Detect spatial anomalies for all children of a parent region.
 * Queries committed region_members (full-coverage only, no custom_geom).
 */
export async function detectAnomaliesForRegion(
  worldViewId: number,
  parentRegionId: number,
): Promise<SpatialAnomaly[]> {
  // Get all child regions
  const { rows: children } = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [parentRegionId, worldViewId],
  );
  if (children.length < 2) return []; // need at least 2 siblings

  const childIds = children.map(c => c.id);
  const childNames = new Map(children.map(c => [c.id, c.name]));

  // Get all full-coverage members across children
  const { rows: members } = await pool.query<{
    member_row_id: number;
    region_id: number;
    division_id: number;
    division_name: string;
  }>(
    `SELECT rm.id AS member_row_id, rm.region_id, rm.division_id, ad.name AS division_name
     FROM region_members rm
     JOIN administrative_divisions ad ON ad.id = rm.division_id
     WHERE rm.region_id = ANY($1) AND rm.custom_geom IS NULL`,
    [childIds],
  );

  if (members.length < 2) return [];

  const assignments: DivisionAssignment[] = members.map(m => ({
    divisionId: m.division_id,
    memberRowId: m.member_row_id,
    regionId: m.region_id,
    regionName: childNames.get(m.region_id) ?? 'Unknown',
    divisionName: m.division_name,
  }));

  const divisionIds = members.map(m => m.division_id);
  const edges = await getAdjacencyGraph(divisionIds);

  return detectSpatialAnomalies(assignments, edges);
}
```

- [ ] Commit:

```bash
git add backend/src/services/worldViewImport/spatialAnomalyDetector.ts backend/src/services/worldViewImport/spatialAnomalyDetector.test.ts
git commit -m "feat: add spatial anomaly detector (exclaves & disconnected fragments)"
```

---

## Task 2: Smart Simplify Backend Integration

**Files:**
- Modify: `backend/src/controllers/admin/wvImportTreeOpsController.ts` (lines 645-823 detect, lines 829-921 apply)
- Modify: `backend/src/types/index.ts` (lines 541-549 Zod schemas)

### Step 2.1: Extend Smart Simplify detect endpoint to include spatial anomalies

- [ ] In `wvImportTreeOpsController.ts`, import the detector and call it after the existing GADM-parent move detection:

```typescript
// Add import at top of file
import { detectAnomaliesForRegion } from '../../services/worldViewImport/spatialAnomalyDetector.js';
```

Then at the end of `detectSmartSimplify`, before `res.json({ moves })` (~line 822), add the spatial anomaly call:

```typescript
  // Spatial anomaly detection (exclaves & disconnected fragments)
  const spatialAnomalies = await detectAnomaliesForRegion(worldViewId, parentRegionId);

  res.json({ moves, spatialAnomalies });
```

### Step 2.2: Add `skipSimplify` flag to the apply endpoint

- [ ] In `backend/src/types/index.ts`, extend the Zod schema (~line 545):

```typescript
export const wvImportSmartSimplifyApplySchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
  ownerRegionId: z.coerce.number().int().positive(),
  memberRowIds: z.array(z.number().int().positive()).min(1),
  skipSimplify: z.boolean().optional(),
});
```

- [ ] In `wvImportTreeOpsController.ts`, in `applySmartSimplifyMove`, parse `skipSimplify` from request body (~line 831) and conditionally skip simplification (~line 899):

Change the destructuring:
```typescript
const { parentRegionId, ownerRegionId, memberRowIds, skipSimplify } = req.body;
```

Wrap the simplification call:
```typescript
  let replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> = [];
  if (!skipSimplify) {
    const simplifyResult = await runSimplifyHierarchy(ownerRegionId, worldViewId);
    replacements = simplifyResult.replacements;
  }
```

- [ ] Commit:

```bash
git add backend/src/controllers/admin/wvImportTreeOpsController.ts backend/src/types/index.ts
git commit -m "feat: integrate spatial anomaly detector into Smart Simplify endpoint"
```

---

## Task 3: Frontend Types & API Updates

**Files:**
- Modify: `frontend/src/api/adminWvImportTreeOps.ts` (lines 338-385)
- Modify: `frontend/src/api/adminWorldViewImport.ts` (lines 364-375)
- Modify: `frontend/src/api/adminWvImportCvMatch.ts` (lines 38-58)

### Step 3.1: Add SpatialAnomaly types and update SmartSimplifyResult

- [ ] In `frontend/src/api/adminWvImportTreeOps.ts`, add the new types after `SmartSimplifyDivision` (~line 344) and update `SmartSimplifyResult`:

```typescript
export interface SpatialAnomalyDivision {
  divisionId: number;
  name: string;
  memberRowId: number | null;
  sourceRegionId: number;
  sourceRegionName: string;
}

export interface SpatialAnomaly {
  divisions: SpatialAnomalyDivision[];
  suggestedTargetRegionId: number;
  suggestedTargetRegionName: string;
  fragmentSize: number;
  totalRegionSize: number;
  score: number;
}
```

Update `SmartSimplifyResult`:
```typescript
export interface SmartSimplifyResult {
  moves: SmartSimplifyMove[];
  spatialAnomalies: SpatialAnomaly[];
}
```

### Step 3.2: Update barrel re-exports

- [ ] In `frontend/src/api/adminWorldViewImport.ts`, add `SpatialAnomalyDivision` and `SpatialAnomaly` to the existing `export type { ... } from './adminWvImportTreeOps'` block (~line 364). Do NOT create a separate export statement — add them to the existing block alongside `SmartSimplifyDivision`, `SmartSimplifyMove`, etc.

### Step 3.3: Update CV match types for pipeline integration

- [ ] In `frontend/src/api/adminWvImportCvMatch.ts`, add to `ColorMatchResult` (~line 38):

```typescript
export interface AdjacencyEdge {
  divA: number;
  divB: number;
}

export interface ColorMatchResult {
  // ... existing fields ...
  spatialAnomalies?: SpatialAnomaly[];
  adjacencyEdges?: AdjacencyEdge[];
}
```

Import the `SpatialAnomaly` type from `adminWvImportTreeOps`:
```typescript
import type { SpatialAnomaly } from './adminWvImportTreeOps';
```

- [ ] Commit:

```bash
git add frontend/src/api/adminWvImportTreeOps.ts frontend/src/api/adminWorldViewImport.ts frontend/src/api/adminWvImportCvMatch.ts
git commit -m "feat: add SpatialAnomaly types to frontend API layer"
```

---

## Task 4: Smart Simplify Dialog — Render Spatial Anomalies

**Files:**
- Modify: `frontend/src/components/admin/SmartSimplifyDialog.tsx`

### Step 4.1: Update state to store spatial anomalies

- [ ] In `SmartSimplifyDialog.tsx`, add state for spatial anomalies (~line 75, after the `moves` state):

```typescript
const [spatialAnomalies, setSpatialAnomalies] = useState<SpatialAnomaly[] | null>(null);
const [appliedAnomalyIndices, setAppliedAnomalyIndices] = useState<Set<number>>(new Set());
const [selectedAnomalyIndex, setSelectedAnomalyIndex] = useState<number | null>(null);
```

Import the `SpatialAnomaly` type:
```typescript
import type { SpatialAnomaly } from '../../api/adminWvImportTreeOps';
```

- [ ] Update the `detectSmartSimplify` callback (~line 96) to store anomalies:

```typescript
.then(([detectResult, geoResult]) => {
  setMoves(detectResult.moves);
  setSpatialAnomalies(detectResult.spatialAnomalies);
  // ... existing ...
})
```

### Step 4.2: Update API function signature, then add anomaly Accept/Skip handlers

- [ ] **First**, update `applySmartSimplifyMove` in `frontend/src/api/adminWvImportTreeOps.ts` (~line 375) to accept `skipSimplify`:

```typescript
export async function applySmartSimplifyMove(
  worldViewId: number,
  parentRegionId: number,
  ownerRegionId: number,
  memberRowIds: number[],
  skipSimplify?: boolean,
): Promise<ApplySmartSimplifyResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-simplify/apply-move`,
    { method: 'POST', body: JSON.stringify({ parentRegionId, ownerRegionId, memberRowIds, skipSimplify }) },
  );
}
```

- [ ] Then add handlers for applying spatial anomaly moves in `SmartSimplifyDialog.tsx`, after the existing `handleApply` (~line 204):

```typescript
const handleApplyAnomaly = useCallback(async (index: number) => {
  if (!spatialAnomalies) return;
  const anomaly = spatialAnomalies[index];
  const memberRowIds = anomaly.divisions
    .map(d => d.memberRowId)
    .filter((id): id is number => id !== null);
  if (memberRowIds.length === 0) return;

  try {
    setApplyError(null);
    await applySmartSimplifyMove(
      worldViewId,
      parentRegionId,
      anomaly.suggestedTargetRegionId,
      memberRowIds,
      true, // skipSimplify
    );
    setAppliedAnomalyIndices(prev => new Set(prev).add(index));
    onApplied();
    // Advance to next non-applied anomaly
    const nextIndex = spatialAnomalies.findIndex(
      (_, i) => i > index && !appliedAnomalyIndices.has(i),
    );
    setSelectedAnomalyIndex(nextIndex >= 0 ? nextIndex : null);
  } catch (err) {
    setApplyError(err instanceof Error ? err.message : 'Failed to apply');
  }
}, [spatialAnomalies, worldViewId, parentRegionId, appliedAnomalyIndices, onApplied]);

const handleSkipAnomaly = useCallback((index: number) => {
  if (!spatialAnomalies) return;
  const nextIndex = spatialAnomalies.findIndex(
    (_, i) => i > index && !appliedAnomalyIndices.has(i),
  );
  setSelectedAnomalyIndex(nextIndex >= 0 ? nextIndex : null);
}, [spatialAnomalies, appliedAnomalyIndices]);
```

### Step 4.3: Render spatial anomaly section in the dialog

- [ ] After the existing move list rendering (~line 538), add a section for spatial anomalies:

```tsx
{/* Spatial anomalies section */}
{spatialAnomalies && spatialAnomalies.length > 0 && (
  <Box sx={{ mt: 3 }}>
    <Typography variant="subtitle2" sx={{ mb: 1 }}>
      Spatial Anomalies ({spatialAnomalies.length})
    </Typography>
    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
      Disconnected fragments or exclaves detected. Each fragment could be reassigned to the surrounding region.
    </Typography>
    {spatialAnomalies.map((anomaly, idx) => {
      const isApplied = appliedAnomalyIndices.has(idx);
      const isSelected = selectedAnomalyIndex === idx;
      return (
        <Box
          key={`anomaly-${idx}`}
          onClick={() => !isApplied && setSelectedAnomalyIndex(idx)}
          sx={{
            p: 1, mb: 0.5, borderRadius: 1, cursor: isApplied ? 'default' : 'pointer',
            border: 1, borderColor: isSelected ? 'info.main' : 'divider',
            opacity: isApplied ? 0.5 : 1,
            bgcolor: isSelected ? 'action.selected' : undefined,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={500}>
              {anomaly.divisions.length} div{anomaly.divisions.length > 1 ? 's' : ''} of {anomaly.divisions[0]?.sourceRegionName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ({anomaly.fragmentSize}/{anomaly.totalRegionSize} divisions)
            </Typography>
            <Typography variant="caption">
              &rarr; {anomaly.suggestedTargetRegionName}
            </Typography>
            {isApplied && (
              <Chip label="Applied" size="small" color="success" sx={{ height: 20, fontSize: '0.65rem' }} />
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
            {anomaly.divisions.map(d => (
              <Chip key={d.divisionId} label={d.name} size="small" variant="outlined"
                sx={{ height: 20, fontSize: '0.65rem' }} />
            ))}
          </Box>
          {isSelected && !isApplied && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <Button size="small" variant="contained" color="success"
                onClick={(e) => { e.stopPropagation(); handleApplyAnomaly(idx); }}>
                Accept
              </Button>
              <Button size="small" variant="outlined"
                onClick={(e) => { e.stopPropagation(); handleSkipAnomaly(idx); }}>
                Skip
              </Button>
            </Box>
          )}
        </Box>
      );
    })}
  </Box>
)}
```

`Chip` is already imported in this file — no import change needed.

- [ ] Commit:

```bash
git add frontend/src/components/admin/SmartSimplifyDialog.tsx
git commit -m "feat: render spatial anomalies in Smart Simplify dialog"
```

---

## Task 5: CV Pipeline Backend Integration

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchShared.ts` (~line 722)

### Step 5.1: Call spatial detector before the `complete` SSE event

- [ ] Import the detector at the top of `wvImportMatchShared.ts`:

```typescript
import { getAdjacencyGraph, detectSpatialAnomalies } from '../../services/worldViewImport/spatialAnomalyDetector.js';
import type { AdjacencyEdge, DivisionAssignment, SpatialAnomaly } from '../../services/worldViewImport/spatialAnomalyDetector.js';
```

- [ ] Before the `sendEvent({ type: 'complete' ... })` call (~line 722), add the anomaly detection step. The data needed is already available:
  - `cvClusterResult` has division-to-cluster-to-region mappings
  - `knownDivisionIds` has pre-assigned division IDs (from `PipelineContext`)
  - `cvChildRegions` has child region info

```typescript
// ── Spatial anomaly detection on suggested assignments ───────────────────────
let spatialAnomalies: SpatialAnomaly[] = [];
let adjacencyEdges: AdjacencyEdge[] = [];
try {
  // Build combined assignments: existing members + CV suggestions
  const existingMembers = await pool.query<{
    member_row_id: number; region_id: number; division_id: number; division_name: string;
  }>(
    `SELECT rm.id AS member_row_id, rm.region_id, rm.division_id, ad.name AS division_name
     FROM region_members rm
     JOIN administrative_divisions ad ON ad.id = rm.division_id
     WHERE rm.region_id IN (SELECT id FROM regions WHERE parent_region_id = (
       SELECT parent_region_id FROM regions WHERE id = $1
     ) AND world_view_id = $2)
     AND rm.custom_geom IS NULL`,
    [regionId, worldViewId],
  );

  // Build region name lookup from child regions
  const regionNameMap = new Map(cvChildRegions.map(r => [r.id, r.name]));

  const allAssignments: DivisionAssignment[] = existingMembers.rows.map(m => ({
    divisionId: m.division_id,
    memberRowId: m.member_row_id,
    regionId: m.region_id,
    regionName: regionNameMap.get(m.region_id) ?? 'Unknown',
    divisionName: m.division_name,
  }));

  // Add CV suggested assignments (memberRowId = null, not yet committed)
  const existingDivIds = new Set(allAssignments.map(a => a.divisionId));
  for (const cluster of cvClusterResult) {
    if (!cluster.suggestedRegion) continue;
    for (const div of cluster.divisions) {
      if (existingDivIds.has(div.id)) continue; // already assigned
      allAssignments.push({
        divisionId: div.id,
        memberRowId: null,
        regionId: cluster.suggestedRegion.id,
        regionName: cluster.suggestedRegion.name,
        divisionName: div.name,
      });
    }
  }

  if (allAssignments.length >= 2) {
    const allDivIds = allAssignments.map(a => a.divisionId);
    adjacencyEdges = await getAdjacencyGraph(allDivIds);
    spatialAnomalies = detectSpatialAnomalies(allAssignments, adjacencyEdges);
  }
} catch (err) {
  // Non-fatal: log and continue without anomaly data
  console.warn('Spatial anomaly detection failed:', err);
}
```

- [ ] Update the `sendEvent` call to include the new fields:

```typescript
sendEvent({
  type: 'complete',
  elapsed: (Date.now() - startTime) / 1000,
  data: {
    clusters: cvClusterResult,
    childRegions: cvChildRegions,
    outOfBounds: cvOutOfBounds.length > 0 ? cvOutOfBounds : undefined,
    debugImages,
    geoPreview: geoPreview ?? undefined,
    spatialAnomalies: spatialAnomalies.length > 0 ? spatialAnomalies : undefined,
    adjacencyEdges: adjacencyEdges.length > 0 ? adjacencyEdges : undefined,
    stats: { /* ... existing ... */ },
  },
});
```

- [ ] Commit:

```bash
git add backend/src/controllers/admin/wvImportMatchShared.ts
git commit -m "feat: run spatial anomaly detection in CV pipeline before complete event"
```

---

## Task 6: CV Pipeline Frontend Integration

**Files:**
- Modify: `frontend/src/components/admin/useCvMatchPipeline.ts` (~line 24, ~line 277)
- Modify: `frontend/src/components/admin/CvGeoPreviewSection.tsx`
- Modify: `frontend/src/components/admin/CvMatchMap.tsx`
- Create: `frontend/src/utils/spatialAnomalyDetector.ts`

### Step 6.1: Create client-side detection utility

- [ ] Create the client-side pure function (intentional duplication of backend logic — no shared code path in this project):

```typescript
// frontend/src/utils/spatialAnomalyDetector.ts

export interface AdjacencyEdge {
  divA: number;
  divB: number;
}

export interface DivisionAssignment {
  divisionId: number;
  regionId: number;
  regionName: string;
}

export interface ClientSpatialAnomaly {
  fragmentDivisionIds: number[];
  sourceRegionId: number;
  sourceRegionName: string;
  suggestedTargetRegionId: number;
  suggestedTargetRegionName: string;
  fragmentSize: number;
  totalRegionSize: number;
  score: number;
}

/**
 * Client-side spatial anomaly detection for instant paint-mode re-checks.
 * Same algorithm as backend detectSpatialAnomalies, but simplified types.
 */
export function detectSpatialAnomaliesClient(
  assignments: DivisionAssignment[],
  edges: AdjacencyEdge[],
): ClientSpatialAnomaly[] {
  const assignmentMap = new Map<number, DivisionAssignment>();
  for (const a of assignments) assignmentMap.set(a.divisionId, a);

  const adj = new Map<number, Set<number>>();
  for (const a of assignments) adj.set(a.divisionId, new Set());
  for (const { divA, divB } of edges) {
    adj.get(divA)?.add(divB);
    adj.get(divB)?.add(divA);
  }

  const regionDivisions = new Map<number, number[]>();
  for (const a of assignments) {
    const divs = regionDivisions.get(a.regionId) ?? [];
    divs.push(a.divisionId);
    regionDivisions.set(a.regionId, divs);
  }

  const anomalies: ClientSpatialAnomaly[] = [];

  for (const [regionId, divIds] of regionDivisions) {
    if (divIds.length <= 1) continue;
    const divSet = new Set(divIds);
    const visited = new Set<number>();
    const components: number[][] = [];

    for (const startDiv of divIds) {
      if (visited.has(startDiv)) continue;
      const component: number[] = [];
      const queue = [startDiv];
      visited.add(startDiv);
      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);
        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor) && divSet.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    if (components.length <= 1) continue;
    components.sort((a, b) => b.length - a.length);
    const totalSize = divIds.length;

    for (let i = 1; i < components.length; i++) {
      const fragment = components[i];
      const neighborVotes = new Map<number, number>();
      for (const divId of fragment) {
        for (const neighbor of adj.get(divId) ?? []) {
          const na = assignmentMap.get(neighbor);
          if (na && na.regionId !== regionId) {
            neighborVotes.set(na.regionId, (neighborVotes.get(na.regionId) ?? 0) + 1);
          }
        }
      }

      let bestId = 0, bestName = 'Unknown', bestCount = 0;
      for (const [nId, count] of neighborVotes) {
        if (count > bestCount || (count === bestCount && nId < bestId)) {
          bestCount = count;
          bestId = nId;
          bestName = assignments.find(a => a.regionId === nId)?.regionName ?? 'Unknown';
        }
      }
      if (bestCount === 0) continue;

      anomalies.push({
        fragmentDivisionIds: fragment,
        sourceRegionId: regionId,
        sourceRegionName: assignmentMap.get(fragment[0])!.regionName,
        suggestedTargetRegionId: bestId,
        suggestedTargetRegionName: bestName,
        fragmentSize: fragment.length,
        totalRegionSize: totalSize,
        score: fragment.length / totalSize,
      });
    }
  }

  anomalies.sort((a, b) => a.score - b.score);
  return anomalies;
}
```

### Step 6.2: Update CvMatchDialogState and complete event handler

- [ ] In `useCvMatchPipeline.ts`, add fields to `CvMatchDialogState` (~line 24):

```typescript
import type { SpatialAnomaly } from '../../api/adminWvImportTreeOps';
import type { AdjacencyEdge } from '../../api/adminWvImportCvMatch';

// Add to CvMatchDialogState interface:
  spatialAnomalies?: SpatialAnomaly[];
  adjacencyEdges?: AdjacencyEdge[];
```

- [ ] In the `complete` event handler (~line 296-307), add the new fields to the state update:

```typescript
  spatialAnomalies: event.data?.spatialAnomalies,
  adjacencyEdges: event.data?.adjacencyEdges,
```

### Step 6.3: Add warning banner and anomaly indicators to CvGeoPreviewSection

- [ ] In `CvGeoPreviewSection.tsx`, add a warning banner when anomalies are found. Insert before the map section (~line 52):

```tsx
// Add Alert to the existing MUI import block (do NOT create a separate import):
// import { ..., Alert } from '@mui/material';

// Inside the component, before the map Box:
{cvMatchDialog.spatialAnomalies && cvMatchDialog.spatialAnomalies.length > 0 && (
  <Alert severity="warning" sx={{ mb: 1, py: 0, fontSize: '0.8rem' }}>
    {cvMatchDialog.spatialAnomalies.length} potential exclave{cvMatchDialog.spatialAnomalies.length > 1 ? 's' : ''} detected
    — divisions that would be disconnected from their region. Review assignments before accepting.
  </Alert>
)}
```

- [ ] In the `onClusterReassign` handler (~line 219), after updating feature properties, re-run client-side anomaly detection:

```typescript
import { detectSpatialAnomaliesClient } from '../../utils/spatialAnomalyDetector';
import type { AdjacencyEdge as ClientAdjEdge, DivisionAssignment as ClientDivAssignment } from '../../utils/spatialAnomalyDetector';

// At the end of the onClusterReassign handler, after updating clusters and geoPreview,
// re-run client-side detection if adjacencyEdges are available:
if (cvMatchDialog.adjacencyEdges) {
  const currentAssignments: ClientDivAssignment[] = [];
  for (const f of updatedFeatures) {
    const props = f.properties;
    if (props?.divisionId && props?.regionId) {
      currentAssignments.push({
        divisionId: props.divisionId,
        regionId: props.regionId,
        regionName: props.regionName ?? 'Unknown',
      });
    }
  }
  const clientAnomalies = detectSpatialAnomaliesClient(
    currentAssignments,
    cvMatchDialog.adjacencyEdges as ClientAdjEdge[],
  );
  // Update spatialAnomalies in dialog state with the client-side results
  // (convert ClientSpatialAnomaly to SpatialAnomaly shape)
  setCVMatchDialog(prev => prev ? {
    ...prev,
    spatialAnomalies: clientAnomalies.map(a => ({
      divisions: a.fragmentDivisionIds.map(id => ({
        divisionId: id,
        name: `Division ${id}`,
        memberRowId: null,
        sourceRegionId: a.sourceRegionId,
        sourceRegionName: a.sourceRegionName,
      })),
      suggestedTargetRegionId: a.suggestedTargetRegionId,
      suggestedTargetRegionName: a.suggestedTargetRegionName,
      fragmentSize: a.fragmentSize,
      totalRegionSize: a.totalRegionSize,
      score: a.score,
    })),
  } : prev);
}
```

### Step 6.4: Add visual styling for anomalous divisions on the map

- [ ] In `CvMatchMap.tsx`, add a new layer for anomalous division outlines. The anomaly division IDs should be passed as a prop or derived from feature properties. Add a prop:

```typescript
export interface CvMatchMapProps {
  // ... existing props ...
  anomalousDivisionIds?: Set<number>;
}
```

Add a dashed magenta outline layer after the existing unsplittable overlay (~line 242):

```tsx
{/* Spatial anomaly overlay (dashed magenta) */}
<Layer
  id="cv-divisions-anomaly"
  type="line"
  source="cv-divisions"
  filter={anomalousDivisionIds && anomalousDivisionIds.size > 0
    ? ['in', ['get', 'divisionId'], ['literal', [...anomalousDivisionIds]]]
    : ['==', 1, 0] // never match
  }
  paint={{
    'line-color': '#e040fb',
    'line-width': 2.5,
    'line-dasharray': [4, 3],
  }}
/>
```

- [ ] In `CvGeoPreviewSection.tsx`, compute `anomalousDivisionIds` from `cvMatchDialog.spatialAnomalies` and pass to `CvMatchMap`:

```typescript
const anomalousDivisionIds = useMemo(() => {
  const ids = new Set<number>();
  for (const a of cvMatchDialog.spatialAnomalies ?? []) {
    for (const d of a.divisions) ids.add(d.divisionId);
  }
  return ids;
}, [cvMatchDialog.spatialAnomalies]);

// Pass to CvMatchMap:
<CvMatchMap
  // ... existing props ...
  anomalousDivisionIds={anomalousDivisionIds}
/>
```

- [ ] Commit:

```bash
git add frontend/src/utils/spatialAnomalyDetector.ts frontend/src/components/admin/useCvMatchPipeline.ts frontend/src/components/admin/CvGeoPreviewSection.tsx frontend/src/components/admin/CvMatchMap.tsx
git commit -m "feat: integrate spatial anomaly detection into CV pipeline UI"
```

---

## Task 7: Pre-Commit Checks & Cleanup

**Files:** All modified files from above.

### Step 7.1: Run lint + typecheck

- [ ] Run:

```bash
npm run check
```

Fix any lint or type errors. Common issues to watch for:
- Missing imports (e.g., `Chip` in SmartSimplifyDialog, `Alert` in CvGeoPreviewSection)
- Unused imports from prior refactoring
- Type mismatches between backend `SpatialAnomaly` and frontend types

### Step 7.2: Run unused file/dependency check

- [ ] Run:

```bash
npm run knip
```

Fix any unused exports or dependencies flagged.

### Step 7.3: Run unit tests

- [ ] Run:

```bash
TEST_REPORT_LOCAL=1 npm test
```

Ensure all tests pass, including the new `spatialAnomalyDetector.test.ts`.

### Step 7.4: Run security checks

- [ ] Run:

```bash
npm run security:all
```

Verify no new vulnerabilities. The new PostGIS query uses parameterized `$1` — no injection risk.

### Step 7.5: Final commit if any fixes were needed

- [ ] If any fixes were applied in steps 7.1-7.4, commit them:

```bash
git add -u
git commit -m "fix: address lint, type, and test issues from spatial anomaly detection"
```
