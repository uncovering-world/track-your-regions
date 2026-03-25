# Smart Simplify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Smart Simplify" dialog that detects divisions misplaced across sibling regions and suggests per-move corrections with a map-based before/after comparison.

**Architecture:** Two new backend endpoints (detect + apply-move) in the wvImport tree-ops controller. Extract the simplify-hierarchy core loop into a reusable function. New frontend dialog component with MapLibre map showing color-coded sibling divisions. Dialog state managed via `useImportTreeDialogs` hook, button added to `TreeNodeActions`.

**Tech Stack:** Express, PostgreSQL, React, MUI, MapLibre GL via react-map-gl, TanStack Query, Turf.js

**Spec:** `docs/superpowers/specs/2026-03-25-smart-simplify-design.md`

---

### Task 1: Backend — Extract `runSimplifyHierarchy` helper

**Files:**
- Modify: `backend/src/controllers/admin/wvImportTreeOpsController.ts`

The existing `simplifyHierarchy` endpoint handler contains the core simplification loop. Extract it into a standalone async function that both the endpoint and the new apply-move endpoint can call.

- [ ] **Step 1: Create `runSimplifyHierarchy` function**

In `wvImportTreeOpsController.ts`, add this function BEFORE the existing `simplifyHierarchy` export. It contains the same logic but works independently (opens its own connection + transaction):

```typescript
/**
 * Core simplification logic — recursively merges child divisions into parents
 * when 100% GADM coverage is detected. Used by both the simplifyHierarchy endpoint
 * and the smart-simplify apply-move endpoint.
 */
async function runSimplifyHierarchy(
  regionId: number,
  worldViewId: number,
): Promise<{ replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }>; totalReduced: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const allReplacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> = [];

    for (;;) {
      const members = await client.query(`
        SELECT rm.id AS member_id, rm.division_id, ad.parent_id
        FROM region_members rm
        JOIN administrative_divisions ad ON ad.id = rm.division_id
        WHERE rm.region_id = $1 AND rm.custom_geom IS NULL
      `, [regionId]);

      const byParent = new Map<number, Array<{ memberId: number; divisionId: number }>>();
      for (const row of members.rows) {
        if (row.parent_id == null) continue;
        const parentId = row.parent_id as number;
        if (!byParent.has(parentId)) byParent.set(parentId, []);
        byParent.get(parentId)!.push({ memberId: row.member_id, divisionId: row.division_id });
      }

      const replacements: Array<{ parentId: number; memberIds: number[]; count: number }> = [];
      for (const [parentId, children] of byParent) {
        const totalResult = await client.query(
          'SELECT count(*)::int AS cnt FROM administrative_divisions WHERE parent_id = $1',
          [parentId],
        );
        const totalChildren = totalResult.rows[0].cnt as number;
        if (children.length === totalChildren) {
          replacements.push({ parentId, memberIds: children.map(c => c.memberId), count: children.length });
        }
      }

      if (replacements.length === 0) break;

      for (const rep of replacements) {
        await client.query('DELETE FROM region_members WHERE id = ANY($1::int[])', [rep.memberIds]);

        const existing = await client.query(
          'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
          [regionId, rep.parentId],
        );
        if (existing.rows.length === 0) {
          await client.query('INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)', [regionId, rep.parentId]);
        }

        const pathResult = await client.query(`
          WITH RECURSIVE ancestors AS (
            SELECT id, name, parent_id, 1 AS depth FROM administrative_divisions WHERE id = $1
            UNION ALL
            SELECT ad.id, ad.name, ad.parent_id, a.depth + 1
            FROM administrative_divisions ad JOIN ancestors a ON ad.id = a.parent_id
          )
          SELECT name FROM ancestors ORDER BY depth DESC
        `, [rep.parentId]);
        const names = pathResult.rows.map(r => r.name as string);
        allReplacements.push({ parentName: names[names.length - 1], parentPath: names.join(' > '), replacedCount: rep.count });
      }
    }

    await client.query('COMMIT');
    const totalReduced = allReplacements.reduce((sum, r) => sum + r.replacedCount, 0) - allReplacements.length;
    return { replacements: allReplacements, totalReduced };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Refactor `simplifyHierarchy` endpoint to use `runSimplifyHierarchy`**

Replace the body of the existing `simplifyHierarchy` export with a thin wrapper:

```typescript
export async function simplifyHierarchy(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/simplify-hierarchy — regionId=${regionId}`);

  // Verify region belongs to this world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  const result = await runSimplifyHierarchy(regionId, worldViewId);

  if (result.replacements.length > 0) {
    await invalidateRegionGeometry(regionId);
    await syncImportMatchStatus(regionId);
  }

  res.json(result);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportTreeOpsController.ts
git commit -m "refactor: extract runSimplifyHierarchy for reuse by smart-simplify

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Backend — Detection endpoint

**Files:**
- Modify: `backend/src/controllers/admin/wvImportTreeOpsController.ts` (add `detectSmartSimplify`)
- Modify: `backend/src/controllers/admin/worldViewImportController.ts` (add re-export)
- Modify: `backend/src/routes/adminRoutes.ts` (add route)
- Modify: `backend/src/types/index.ts` (add Zod schema)

- [ ] **Step 1: Add Zod schema**

In `backend/src/types/index.ts`, add near the other wvImport schemas:

```typescript
export const wvImportSmartSimplifySchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
});
```

- [ ] **Step 2: Add `detectSmartSimplify` function**

Append to `wvImportTreeOpsController.ts` (after `simplifyHierarchy`). This is a read-only endpoint using `pool.query()` directly:

```typescript
/**
 * Detect divisions that are split across sibling regions and suggest moves
 * that would enable simplification.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-simplify
 */
export async function detectSmartSimplify(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-simplify — parentRegionId=${parentRegionId}`);

  // Verify parent region belongs to this world view
  const parentCheck = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [parentRegionId, worldViewId],
  );
  if (parentCheck.rows.length === 0) {
    res.status(404).json({ error: 'Parent region not found in this world view' });
    return;
  }

  // Get all child regions
  const childrenResult = await pool.query(
    'SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2 ORDER BY name',
    [parentRegionId, worldViewId],
  );
  if (childrenResult.rows.length === 0) {
    res.json({ moves: [] });
    return;
  }

  const children = childrenResult.rows as Array<{ id: number; name: string }>;
  const childIds = children.map(c => c.id);
  const childNameMap = new Map(children.map(c => [c.id, c.name]));

  // Get all full-coverage members across all children
  const membersResult = await pool.query(`
    SELECT rm.id AS member_row_id, rm.division_id, rm.region_id,
           ad.parent_id AS gadm_parent_id, ad.name AS division_name
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = ANY($1::int[]) AND rm.custom_geom IS NULL
  `, [childIds]);

  // Group by GADM parent (skip nulls)
  const byGadmParent = new Map<number, Array<{ memberRowId: number; divisionId: number; regionId: number; divisionName: string }>>();
  for (const row of membersResult.rows) {
    if (row.gadm_parent_id == null) continue;
    const pid = row.gadm_parent_id as number;
    if (!byGadmParent.has(pid)) byGadmParent.set(pid, []);
    byGadmParent.get(pid)!.push({
      memberRowId: row.member_row_id,
      divisionId: row.division_id,
      regionId: row.region_id,
      divisionName: row.division_name,
    });
  }

  // Batch-fetch child counts for all GADM parents
  const gadmParentIds = [...byGadmParent.keys()];
  if (gadmParentIds.length === 0) {
    res.json({ moves: [] });
    return;
  }

  const countsResult = await pool.query(`
    SELECT parent_id, count(*)::int AS cnt
    FROM administrative_divisions
    WHERE parent_id = ANY($1::int[])
    GROUP BY parent_id
  `, [gadmParentIds]);
  const totalChildrenMap = new Map(countsResult.rows.map(r => [r.parent_id as number, r.cnt as number]));

  // Find GADM parents that are complete but split across siblings
  interface MoveCandidate {
    gadmParentId: number;
    gadmParentName: string;
    gadmParentPath: string;
    totalChildren: number;
    ownerRegionId: number;
    ownerRegionName: string;
    divisions: Array<{ divisionId: number; name: string; fromRegionId: number; fromRegionName: string; memberRowId: number }>;
  }
  const moves: MoveCandidate[] = [];

  for (const [gadmParentId, members] of byGadmParent) {
    const totalChildren = totalChildrenMap.get(gadmParentId);
    if (totalChildren == null || members.length !== totalChildren) continue;

    // Group by owning sibling region
    const byRegion = new Map<number, typeof members>();
    for (const m of members) {
      if (!byRegion.has(m.regionId)) byRegion.set(m.regionId, []);
      byRegion.get(m.regionId)!.push(m);
    }
    if (byRegion.size <= 1) continue; // all in one sibling — no move needed

    // Owner = sibling with the most; tie-breaker = lowest region ID
    let ownerRegionId = 0;
    let ownerCount = 0;
    for (const [regionId, regionMembers] of byRegion) {
      if (regionMembers.length > ownerCount || (regionMembers.length === ownerCount && regionId < ownerRegionId)) {
        ownerRegionId = regionId;
        ownerCount = regionMembers.length;
      }
    }

    // Divisions NOT in the owner are the move targets
    const divisionsToMove = members
      .filter(m => m.regionId !== ownerRegionId)
      .map(m => ({
        divisionId: m.divisionId,
        name: m.divisionName,
        fromRegionId: m.regionId,
        fromRegionName: childNameMap.get(m.regionId) || 'Unknown',
        memberRowId: m.memberRowId,
      }));

    // Build GADM parent path
    const pathResult = await pool.query(`
      WITH RECURSIVE ancestors AS (
        SELECT id, name, parent_id, 1 AS depth FROM administrative_divisions WHERE id = $1
        UNION ALL
        SELECT ad.id, ad.name, ad.parent_id, a.depth + 1
        FROM administrative_divisions ad JOIN ancestors a ON ad.id = a.parent_id
      )
      SELECT name FROM ancestors ORDER BY depth DESC
    `, [gadmParentId]);
    const names = pathResult.rows.map(r => r.name as string);

    moves.push({
      gadmParentId,
      gadmParentName: names[names.length - 1],
      gadmParentPath: names.join(' > '),
      totalChildren,
      ownerRegionId,
      ownerRegionName: childNameMap.get(ownerRegionId) || 'Unknown',
      divisions: divisionsToMove,
    });
  }

  // Sort moves by number of divisions to move (most impactful first)
  moves.sort((a, b) => b.divisions.length - a.divisions.length);

  res.json({ moves });
}
```

- [ ] **Step 3: Add re-export in barrel**

In `worldViewImportController.ts`, update the tree-ops line:
```typescript
export { mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves, simplifyHierarchy, detectSmartSimplify } from './wvImportTreeOpsController.js';
```

- [ ] **Step 4: Add route + import**

In `adminRoutes.ts`:
1. Add `detectSmartSimplify` to the import from `worldViewImportController.js` (tree ops line)
2. Add `wvImportSmartSimplifySchema` to the import from `../types/index.js`
3. Add route after the simplify-hierarchy route:
```typescript
router.post('/wv-import/matches/:worldViewId/smart-simplify', validate(worldViewIdParamSchema, 'params'), validate(wvImportSmartSimplifySchema), detectSmartSimplify);
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin/wvImportTreeOpsController.ts backend/src/controllers/admin/worldViewImportController.ts backend/src/routes/adminRoutes.ts backend/src/types/index.ts
git commit -m "feat: add detectSmartSimplify endpoint for cross-sibling move detection

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Backend — Apply-move endpoint

**Files:**
- Modify: `backend/src/controllers/admin/wvImportTreeOpsController.ts` (add `applySmartSimplifyMove`)
- Modify: `backend/src/controllers/admin/worldViewImportController.ts` (add re-export)
- Modify: `backend/src/routes/adminRoutes.ts` (add route)
- Modify: `backend/src/types/index.ts` (add Zod schema)

- [ ] **Step 1: Add Zod schema**

In `backend/src/types/index.ts`:
```typescript
export const wvImportSmartSimplifyApplySchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
  ownerRegionId: z.coerce.number().int().positive(),
  memberRowIds: z.array(z.number().int().positive()).min(1),
});
```

- [ ] **Step 2: Add `applySmartSimplifyMove` function**

Append to `wvImportTreeOpsController.ts`:

```typescript
/**
 * Apply a single smart-simplify move: move members to the owner region,
 * then run simplification on the owner.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-simplify/apply-move
 */
export async function applySmartSimplifyMove(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId, ownerRegionId, memberRowIds } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-simplify/apply-move — parent=${parentRegionId}, owner=${ownerRegionId}, members=${memberRowIds.length}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify both regions belong to this world view
    const regionsCheck = await client.query(
      'SELECT id FROM regions WHERE id = ANY($1::int[]) AND world_view_id = $2',
      [[parentRegionId, ownerRegionId], worldViewId],
    );
    if (regionsCheck.rows.length < 2) {
      res.status(404).json({ error: 'Parent or owner region not found in this world view' });
      return;
    }

    // Verify all memberRowIds belong to children of parentRegionId
    const childIds = await client.query(
      'SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
      [parentRegionId, worldViewId],
    );
    const childIdSet = new Set(childIds.rows.map(r => r.id as number));

    const memberCheck = await client.query(
      'SELECT id, region_id FROM region_members WHERE id = ANY($1::int[])',
      [memberRowIds],
    );
    if (memberCheck.rows.length !== memberRowIds.length) {
      res.status(400).json({ error: 'Some member row IDs not found' });
      return;
    }

    const affectedRegionIds = new Set<number>();
    for (const row of memberCheck.rows) {
      if (!childIdSet.has(row.region_id as number)) {
        res.status(400).json({ error: `Member row ${row.id} does not belong to a child of the parent region` });
        return;
      }
      affectedRegionIds.add(row.region_id as number);
    }
    affectedRegionIds.add(ownerRegionId);

    // Move all members to the owner region
    await client.query(
      'UPDATE region_members SET region_id = $1 WHERE id = ANY($2::int[])',
      [ownerRegionId, memberRowIds],
    );

    await client.query('COMMIT');

    // Post-commit: run simplify on the owner (opens its own transaction)
    const simplifyResult = await runSimplifyHierarchy(ownerRegionId, worldViewId);

    // Invalidate geometries and sync match status for all affected regions
    for (const regionId of affectedRegionIds) {
      await invalidateRegionGeometry(regionId);
      await syncImportMatchStatus(regionId);
    }

    res.json({ moved: memberRowIds.length, simplification: simplifyResult });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Add re-export in barrel**

In `worldViewImportController.ts`, update the tree-ops line to also include `applySmartSimplifyMove`.

- [ ] **Step 4: Add route + import**

In `adminRoutes.ts`:
1. Add `applySmartSimplifyMove` to the import
2. Add `wvImportSmartSimplifyApplySchema` to the types import
3. Add route:
```typescript
router.post('/wv-import/matches/:worldViewId/smart-simplify/apply-move', validate(worldViewIdParamSchema, 'params'), validate(wvImportSmartSimplifyApplySchema), applySmartSimplifyMove);
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin/wvImportTreeOpsController.ts backend/src/controllers/admin/worldViewImportController.ts backend/src/routes/adminRoutes.ts backend/src/types/index.ts
git commit -m "feat: add applySmartSimplifyMove endpoint — move + simplify in one call

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Frontend — API client

**Files:**
- Modify: `frontend/src/api/adminWvImportTreeOps.ts` (add functions + types)
- Modify: `frontend/src/api/adminWorldViewImport.ts` (add re-exports)

- [ ] **Step 1: Add API functions to `adminWvImportTreeOps.ts`**

Append:

```typescript
// =============================================================================
// Smart Simplify
// =============================================================================

export interface SmartSimplifyDivision {
  divisionId: number;
  name: string;
  fromRegionId: number;
  fromRegionName: string;
  memberRowId: number;
}

export interface SmartSimplifyMove {
  gadmParentId: number;
  gadmParentName: string;
  gadmParentPath: string;
  totalChildren: number;
  ownerRegionId: number;
  ownerRegionName: string;
  divisions: SmartSimplifyDivision[];
}

export interface SmartSimplifyResult {
  moves: SmartSimplifyMove[];
}

export async function detectSmartSimplify(
  worldViewId: number,
  parentRegionId: number,
): Promise<SmartSimplifyResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-simplify`,
    { method: 'POST', body: JSON.stringify({ parentRegionId }) },
  );
}

export interface ApplySmartSimplifyResult {
  moved: number;
  simplification: SimplifyHierarchyResult;
}

export async function applySmartSimplifyMove(
  worldViewId: number,
  parentRegionId: number,
  ownerRegionId: number,
  memberRowIds: number[],
): Promise<ApplySmartSimplifyResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-simplify/apply-move`,
    { method: 'POST', body: JSON.stringify({ parentRegionId, ownerRegionId, memberRowIds }) },
  );
}
```

- [ ] **Step 2: Add re-exports in `adminWorldViewImport.ts`**

Add to the `export { ... } from './adminWvImportTreeOps'` block:
```typescript
  detectSmartSimplify,
  applySmartSimplifyMove,
```

Add to the `export type { ... } from './adminWvImportTreeOps'` block:
```typescript
  SmartSimplifyDivision,
  SmartSimplifyMove,
  SmartSimplifyResult,
  ApplySmartSimplifyResult,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/adminWvImportTreeOps.ts frontend/src/api/adminWorldViewImport.ts
git commit -m "feat: add smart simplify API client functions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend — SmartSimplifyDialog component

**Files:**
- Create: `frontend/src/components/admin/SmartSimplifyDialog.tsx`

This is the largest task. The dialog has:
- Left panel: source map image
- Right panel top: MapLibre map with color-coded sibling divisions
- Right panel bottom: moves list with apply/skip per move

- [ ] **Step 1: Create `SmartSimplifyDialog.tsx`**

Create the file with the full dialog component. Follow the `DivisionPreviewDialog` / `CoverageCompareDialog` patterns:

```typescript
/**
 * SmartSimplifyDialog — shows misplaced divisions across sibling regions
 * with a map comparison and per-move apply/skip flow.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, Box, Typography,
  IconButton, CircularProgress, Button, Chip, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import MapGL, { Source, Layer, NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import {
  detectSmartSimplify,
  applySmartSimplifyMove,
  type SmartSimplifyMove,
  type SmartSimplifyResult,
} from '../../api/adminWorldViewImport';
import { getChildrenRegionGeometry, type SiblingRegionGeometry } from '../../api/adminWvImportCoverage';
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const CHILD_COLORS = ['#3388ff', '#33aa55', '#9955cc', '#cc7733', '#5599dd', '#dd5577', '#55bb88', '#bb7744', '#7755cc', '#cc5533'];

interface SmartSimplifyDialogProps {
  open: boolean;
  onClose: () => void;
  worldViewId: number;
  parentRegionId: number;
  parentRegionName: string;
  regionMapUrl: string | null;
  onApplied: () => void; // called after each apply to refresh tree
}

export function SmartSimplifyDialog({
  open, onClose, worldViewId, parentRegionId, parentRegionName,
  regionMapUrl, onApplied,
}: SmartSimplifyDialogProps) {
  const mapRef = useRef<MapRef>(null);

  // ── Data state ──
  const [moves, setMoves] = useState<SmartSimplifyMove[] | null>(null);
  const [childGeometries, setChildGeometries] = useState<SiblingRegionGeometry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──
  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null);
  const [appliedGadmParentIds, setAppliedGadmParentIds] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'current' | 'proposed'>('current');
  const [applying, setApplying] = useState(false);

  // ── Fetch data on open ──
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setMoves(null);
    setChildGeometries(null);
    setSelectedMoveIndex(null);
    setAppliedGadmParentIds(new Set());
    setViewMode('current');

    Promise.all([
      detectSmartSimplify(worldViewId, parentRegionId),
      getChildrenRegionGeometry(worldViewId, parentRegionId),
    ])
      .then(([smartResult, geoResult]) => {
        setMoves(smartResult.moves);
        setChildGeometries(geoResult.childRegions);
        if (smartResult.moves.length > 0) setSelectedMoveIndex(0);
      })
      .catch(err => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [open, worldViewId, parentRegionId]);

  // ── Color map: regionId → color ──
  const colorMap = useMemo(() => {
    if (!childGeometries) return new Map<number, string>();
    return new Map(childGeometries.map((c, i) => [c.regionId, CHILD_COLORS[i % CHILD_COLORS.length]]));
  }, [childGeometries]);

  // ── Selected move ──
  const selectedMove = selectedMoveIndex !== null && moves ? moves[selectedMoveIndex] : null;
  const movingDivisionIds = useMemo(
    () => new Set(selectedMove?.divisions.map(d => d.divisionId) ?? []),
    [selectedMove],
  );

  // ── GeoJSON for map — build FeatureCollections per child region ──
  // Each division is a feature with properties: { regionId, divisionId, name }
  // For "proposed" view, reassign moved divisions to the owner's color
  const mapLayers = useMemo(() => {
    if (!childGeometries) return [];
    return childGeometries.map((child, i) => ({
      regionId: child.regionId,
      name: child.name,
      color: CHILD_COLORS[i % CHILD_COLORS.length],
      fc: {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const,
          properties: { name: child.name, regionId: child.regionId },
          geometry: child.geometry,
        }],
      },
    }));
  }, [childGeometries]);

  // ── Fit map to data ──
  useEffect(() => {
    if (!mapRef.current || !childGeometries || childGeometries.length === 0) return;
    try {
      const allFeatures = childGeometries.map(c => ({
        type: 'Feature' as const,
        properties: {},
        geometry: c.geometry,
      }));
      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allFeatures };
      const bbox = turf.bbox(fc) as [number, number, number, number];
      mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 0 });
    } catch { /* ignore */ }
  }, [childGeometries]);

  // ── Handlers ──
  const handleApply = useCallback(async () => {
    if (!selectedMove) return;
    setApplying(true);
    try {
      await applySmartSimplifyMove(
        worldViewId, parentRegionId,
        selectedMove.ownerRegionId,
        selectedMove.divisions.map(d => d.memberRowId),
      );
      setAppliedGadmParentIds(prev => new Set([...prev, selectedMove.gadmParentId]));
      onApplied();
    } catch (err) {
      console.error('Apply move failed:', err);
    } finally {
      setApplying(false);
    }
  }, [selectedMove, worldViewId, parentRegionId, onApplied]);

  const handleSkip = useCallback(() => {
    if (moves && selectedMoveIndex !== null) {
      // Find next non-applied move
      for (let i = selectedMoveIndex + 1; i < moves.length; i++) {
        if (!appliedGadmParentIds.has(moves[i].gadmParentId)) {
          setSelectedMoveIndex(i);
          return;
        }
      }
      setSelectedMoveIndex(null);
    }
  }, [moves, selectedMoveIndex, appliedGadmParentIds]);

  // ── Tooltip state ──
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string } | null>(null);
  const interactiveIds = useMemo(() => mapLayers.map((_, i) => `child-fill-${i}`), [mapLayers]);

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth
      slotProps={{ paper: { sx: { height: '90vh', display: 'flex', flexDirection: 'column' } } }}
    >
      <DialogTitle sx={{ pb: 1, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{parentRegionName} — Smart Simplify</span>
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ flex: 1, overflow: 'hidden', display: 'flex', p: 0 }}>
        {loading ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography color="error">{error}</Typography>
          </Box>
        ) : moves && moves.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography color="text.secondary">Nothing to simplify — all divisions are in the correct regions</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left panel: Source map image */}
            <Box sx={{
              flex: '0 0 42%', borderRight: 1, borderColor: 'divider',
              display: 'flex', flexDirection: 'column', bgcolor: 'grey.50',
            }}>
              <Typography variant="caption" sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', fontWeight: 600, color: 'text.secondary' }}>
                Source Map
              </Typography>
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1, overflow: 'hidden' }}>
                {regionMapUrl ? (
                  <img src={regionMapUrl} alt={`${parentRegionName} map`}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <Typography color="text.secondary" variant="body2">No source map available</Typography>
                )}
              </Box>
            </Box>

            {/* Right panel: Map + moves list */}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {/* Map */}
              <Box sx={{ flex: 1, minHeight: 200, position: 'relative' }}>
                <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}>
                  <ToggleButtonGroup size="small" exclusive value={viewMode}
                    onChange={(_, v) => { if (v) setViewMode(v); }}
                    sx={{ bgcolor: 'background.paper' }}
                  >
                    <ToggleButton value="current" sx={{ px: 1.5, py: 0.25, fontSize: '0.7rem' }}>Current</ToggleButton>
                    <ToggleButton value="proposed" sx={{ px: 1.5, py: 0.25, fontSize: '0.7rem' }}>Proposed</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <MapGL ref={mapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', height: '100%' }}
                  mapStyle={MAP_STYLE}
                  interactiveLayerIds={interactiveIds}
                  onMouseMove={(e) => {
                    const name = e.features?.[0]?.properties?.name;
                    setTooltip(name ? { x: e.point.x, y: e.point.y, name } : null);
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <NavigationControl position="top-left" showCompass={false} />
                  {mapLayers.map((layer, i) => (
                    <Source key={`child-${layer.regionId}`} id={`child-${i}`} type="geojson" data={layer.fc}>
                      <Layer id={`child-fill-${i}`} type="fill" paint={{
                        'fill-color': layer.color,
                        'fill-opacity': 0.4,
                      }} />
                      <Layer id={`child-outline-${i}`} type="line" paint={{
                        'line-color': layer.color,
                        'line-width': 1.5,
                      }} />
                    </Source>
                  ))}
                </MapGL>
                {tooltip && (
                  <Box sx={{
                    position: 'absolute', left: tooltip.x + 12, top: tooltip.y - 28,
                    bgcolor: 'rgba(0,0,0,0.8)', color: '#fff', px: 1, py: 0.25,
                    borderRadius: 0.5, fontSize: '0.75rem', pointerEvents: 'none',
                    whiteSpace: 'nowrap', zIndex: 10,
                  }}>
                    {tooltip.name}
                  </Box>
                )}
              </Box>

              {/* Moves list */}
              <Box sx={{ borderTop: 1, borderColor: 'divider', maxHeight: 220, overflow: 'auto' }}>
                <Typography variant="caption" sx={{ px: 1.5, py: 0.5, display: 'block', fontWeight: 600, color: 'text.secondary', borderBottom: 1, borderColor: 'divider' }}>
                  SUGGESTED MOVES ({moves?.filter(m => !appliedGadmParentIds.has(m.gadmParentId)).length ?? 0} remaining)
                </Typography>
                {moves?.map((move, i) => {
                  const isApplied = appliedGadmParentIds.has(move.gadmParentId);
                  const isSelected = i === selectedMoveIndex;
                  return (
                    <Box key={move.gadmParentId}
                      onClick={() => !isApplied && setSelectedMoveIndex(i)}
                      sx={{
                        px: 1.5, py: 1, cursor: isApplied ? 'default' : 'pointer',
                        borderBottom: 1, borderColor: 'divider',
                        borderLeft: 3, borderLeftColor: isSelected ? 'primary.main' : 'transparent',
                        bgcolor: isSelected ? 'action.selected' : 'transparent',
                        opacity: isApplied ? 0.4 : 1,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography variant="body2" sx={{
                            fontWeight: 600,
                            textDecoration: isApplied ? 'line-through' : 'none',
                          }}>
                            {move.divisions.length} {move.gadmParentName} division{move.divisions.length > 1 ? 's' : ''}
                          </Typography>
                          <Chip label={`${move.totalChildren} → 1`} size="small" color="success" variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem' }} />
                          {isApplied && <Chip label="applied" size="small" sx={{ height: 18, fontSize: '0.65rem' }} />}
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                          {move.divisions.map(d => d.fromRegionName).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                          {' → '}
                          <span style={{ fontWeight: 600 }}>{move.ownerRegionName}</span>
                          {' · '}
                          {move.divisions.map(d => d.name).join(', ')}
                        </Typography>
                      </Box>
                      {isSelected && !isApplied && (
                        <Box sx={{ display: 'flex', gap: 0.75, ml: 1, flexShrink: 0 }}>
                          <Button size="small" variant="contained" color="success"
                            onClick={(e) => { e.stopPropagation(); handleApply(); }}
                            disabled={applying}
                          >
                            {applying ? <CircularProgress size={14} /> : 'Apply'}
                          </Button>
                          <Button size="small" variant="outlined" color="inherit"
                            onClick={(e) => { e.stopPropagation(); handleSkip(); }}
                            disabled={applying}
                          >
                            Skip
                          </Button>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Implementation note:** This is a V1 that shows child-region-level geometry (union per child, color-coded). The Current/Proposed toggle and per-division highlighting (dashed red borders on individual divisions) require per-division geometry which `getChildrenRegionGeometry` does not provide. V1 shows the child-region-level view which is sufficient for the user to understand which regions are involved in each move. Per-division highlighting can be added as a follow-up by fetching `fetchDivisionGeometry` from `frontend/src/api/regions.ts` for the selected move's `divisionIds`.

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/SmartSimplifyDialog.tsx
git commit -m "feat: add SmartSimplifyDialog component with map + moves list

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — Dialog state + button wiring

**Files:**
- Modify: `frontend/src/components/admin/useImportTreeDialogs.ts` (add dialog state + handler)
- Modify: `frontend/src/components/admin/TreeNodeActions.tsx` (add button)
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx` (pass props)
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx` (render dialog + wire handler)

- [ ] **Step 1: Add state to `useImportTreeDialogs.ts`**

1. Add state type (near other dialog state types):
```typescript
export interface SmartSimplifyState {
  regionId: number;
  regionName: string;
  regionMapUrl: string | null;
}
```

2. Add to the `UseImportTreeDialogsResult` interface (around line 178, before the closing `}`):
```typescript
  // Smart simplify
  smartSimplifyDialog: SmartSimplifyState | null;
  setSmartSimplifyDialog: React.Dispatch<React.SetStateAction<SmartSimplifyState | null>>;
  handleSmartSimplify: (regionId: number) => void;
```

3. Add state and handler inside the hook:
```typescript
  // Smart simplify
  const [smartSimplifyDialog, setSmartSimplifyDialog] = useState<SmartSimplifyState | null>(null);

  const handleSmartSimplify = useCallback((regionId: number) => {
    const node = tree ? findNodeById(tree, regionId) : null;
    if (!node) return;
    // Get regionMapUrl from import state (node may have it or we look at parent)
    setSmartSimplifyDialog({
      regionId,
      regionName: node.name,
      regionMapUrl: node.regionMapUrl ?? null,
    });
  }, [tree]);
```

4. Add to the return object:
```typescript
    // Smart simplify
    smartSimplifyDialog, setSmartSimplifyDialog, handleSmartSimplify,
```

- [ ] **Step 2: Add button to `TreeNodeActions.tsx`**

1. Add icon import:
```typescript
  SwapHoriz as SmartSimplifyIcon,
```

2. Add to `TreeNodeActionsProps`:
```typescript
  onSmartSimplify?: (regionId: number) => void;
```

3. Destructure in the component.

4. Add button JSX — show on nodes with children (near the merge/flatten buttons area). Add it after the "Drill into children" button block:
```tsx
      {/* Smart simplify — detect misplaced divisions across children */}
      {hasChildren && onSmartSimplify && (
        <Tooltip title="Smart simplify — detect misplaced divisions across children">
          <span>
            <IconButton
              size="small"
              onClick={() => onSmartSimplify(node.id)}
              disabled={isMutating}
              sx={{ p: 0.25 }}
            >
              <SmartSimplifyIcon sx={{ fontSize: 16, color: 'info.main' }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
```

- [ ] **Step 3: Pass through `TreeNodeRow.tsx`**

1. Add to props: `onSmartSimplify?: (regionId: number) => void;`
2. Destructure and pass to `<TreeNodeActions>`: `onSmartSimplify={onSmartSimplify}`

(No `arePropsEqual` change needed since there's no loading state prop — the callback is stable.)

- [ ] **Step 4: Wire in `WorldViewImportTree.tsx`**

1. Import the dialog:
```typescript
import { SmartSimplifyDialog } from './SmartSimplifyDialog';
```

2. Pass handler to `<TreeNodeRow>`:
```tsx
  onSmartSimplify={dialogs.handleSmartSimplify}
```

3. Render the dialog alongside other dialogs:
```tsx
      {dialogs.smartSimplifyDialog && (
        <SmartSimplifyDialog
          open
          onClose={() => dialogs.setSmartSimplifyDialog(null)}
          worldViewId={worldViewId}
          parentRegionId={dialogs.smartSimplifyDialog.regionId}
          parentRegionName={dialogs.smartSimplifyDialog.regionName}
          regionMapUrl={dialogs.smartSimplifyDialog.regionMapUrl}
          onApplied={() => invalidateTree(dialogs.smartSimplifyDialog?.regionId)}
        />
      )}
```

Note: `invalidateTree` comes from the `useTreeMutations` hook (already destructured in `WorldViewImportTree`).

- [ ] **Step 5: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 6: Run knip**

Run: `cd /home/nikolay/projects/track-your-regions && npm run knip`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/useImportTreeDialogs.ts frontend/src/components/admin/TreeNodeActions.tsx frontend/src/components/admin/TreeNodeRow.tsx frontend/src/components/admin/WorldViewImportTree.tsx
git commit -m "feat: wire Smart Simplify button and dialog into import tree

Adds a button on parent nodes that opens the SmartSimplifyDialog,
showing source map + GADM divisions with per-move apply/skip flow.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Pre-commit checks

**Files:** None (validation only)

- [ ] **Step 1: Run full check suite**

```bash
cd /home/nikolay/projects/track-your-regions
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

- [ ] **Step 2: Run `/security-check`**

- [ ] **Step 3: Fix any issues found, commit fixes**
