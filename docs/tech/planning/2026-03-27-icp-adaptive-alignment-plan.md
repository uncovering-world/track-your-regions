# ICP Adaptive Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect poor ICP alignment caused by island-inflated GADM bounding boxes and offer one-click adjustment that tries multiple strategies to fix it.

**Architecture:** Detection uses dual signal (aspect ratio mismatch pre-ICP + high overflow post-ICP). On user confirmation, two strategies run (bbox contribution analysis + CV-GADM overlap check), best result wins. Reuses existing SSE pause/resume pattern from cluster/water review.

**Tech Stack:** TypeScript, Vitest, SSE (Server-Sent Events), React/MUI

**Design spec:** `docs/tech/planning/2026-03-27-icp-adaptive-alignment-design.md`

---

## File Structure

### New Files
- `backend/src/controllers/admin/wvImportMatchIcp.test.ts` — Unit tests for detection + outlier helpers
- `frontend/src/components/admin/CvIcpAdjustmentSection.tsx` — Adjustment banner UI component

### Modified Files
- `backend/src/controllers/admin/wvImportMatchIcp.ts` — Detection logic, outlier identification, bbox override support
- `backend/src/controllers/admin/wvImportMatchShared.ts` — SSE pause/resume after ICP, adjustment orchestration
- `backend/src/routes/adminRoutes.ts` — POST route for adjustment decision
- `frontend/src/api/adminWorldViewImport.ts` — API function for adjustment response + type
- `frontend/src/components/admin/useCvMatchPipeline.ts` — Handle `icp_adjustment_available` SSE event
- `frontend/src/components/admin/CvMatchDialog.tsx` — Render CvIcpAdjustmentSection

---

### Task 1: Geometry helper functions

**Files:**
- Create: `backend/src/controllers/admin/wvImportMatchIcp.test.ts`
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.ts`

- [ ] **Step 1: Write failing tests for computeShoelaceArea and computeBboxFromDivisions**

```typescript
// backend/src/controllers/admin/wvImportMatchIcp.test.ts
import { describe, it, expect } from 'vitest';
import { computeShoelaceArea, computeBboxFromDivisions } from './wvImportMatchIcp.js';

describe('computeShoelaceArea', () => {
  it('computes area of a unit square', () => {
    const points: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(computeShoelaceArea(points)).toBeCloseTo(1.0);
  });

  it('computes area of a right triangle', () => {
    const points: Array<[number, number]> = [[0, 0], [4, 0], [0, 3]];
    expect(computeShoelaceArea(points)).toBeCloseTo(6.0);
  });

  it('returns 0 for degenerate polygon (line)', () => {
    const points: Array<[number, number]> = [[0, 0], [1, 1], [2, 2]];
    expect(computeShoelaceArea(points)).toBeCloseTo(0);
  });

  it('handles clockwise and counter-clockwise winding identically', () => {
    const ccw: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const cw: Array<[number, number]> = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(computeShoelaceArea(ccw)).toBeCloseTo(computeShoelaceArea(cw));
  });
});

describe('computeBboxFromDivisions', () => {
  it('computes tight bbox around all divisions', () => {
    const divs = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 5, area: 50 },
      { id: 2, minX: 8, maxX: 20, minY: 3, maxY: 8, area: 60 },
    ];
    const bbox = computeBboxFromDivisions(divs);
    expect(bbox).toEqual({ minX: 0, maxX: 20, minY: 0, maxY: 8 });
  });

  it('handles single division', () => {
    const divs = [{ id: 1, minX: 5, maxX: 15, minY: 2, maxY: 7, area: 50 }];
    const bbox = computeBboxFromDivisions(divs);
    expect(bbox).toEqual({ minX: 5, maxX: 15, minY: 2, maxY: 7 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: FAIL — `computeShoelaceArea` and `computeBboxFromDivisions` are not exported

- [ ] **Step 3: Implement and export the helper functions**

Add to `backend/src/controllers/admin/wvImportMatchIcp.ts`, after the existing type definitions (after line 53):

```typescript
// =============================================================================
// Geometry helpers for ICP adjustment
// =============================================================================

export interface DivisionBbox {
  id: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  area: number;
}

/** Compute polygon area using the shoelace formula. Returns absolute area. */
export function computeShoelaceArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

/** Compute the tight bounding box enclosing all divisions. */
export function computeBboxFromDivisions(
  divs: DivisionBbox[],
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const d of divs) {
    if (d.minX < minX) minX = d.minX;
    if (d.maxX > maxX) maxX = d.maxX;
    if (d.minY < minY) minY = d.minY;
    if (d.maxY > maxY) maxY = d.maxY;
  }
  return { minX, maxX, minY, maxY };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchIcp.ts backend/src/controllers/admin/wvImportMatchIcp.test.ts
git commit -m "feat(cv): add geometry helpers for ICP adaptive alignment"
```

---

### Task 2: Detection function

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.test.ts`
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.ts`

- [ ] **Step 1: Write failing tests for detectBboxInflation**

Append to `backend/src/controllers/admin/wvImportMatchIcp.test.ts`:

```typescript
import { detectBboxInflation } from './wvImportMatchIcp.js';

describe('detectBboxInflation', () => {
  const TW = 800, TH = 600;

  it('returns true when both aspect ratio mismatch AND overflow exceed thresholds', () => {
    // GADM bbox is 2:1, CV bbox is 1:1 → ratio mismatch = 2.0 > 1.4
    const gBbox = { minX: 0, maxX: 200, minY: 0, maxY: 100 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const overflow = 120; // 120/800 = 0.15 > 0.12
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(true);
  });

  it('returns false when aspect ratios are similar (compact country)', () => {
    const gBbox = { minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 340 };
    const overflow = 120;
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(false);
  });

  it('returns false when overflow is low (elongated but well-matched country)', () => {
    const gBbox = { minX: 0, maxX: 200, minY: 0, maxY: 100 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const overflow = 50; // 50/800 = 0.0625 < 0.12
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(false);
  });

  it('returns false when both signals are below thresholds', () => {
    const gBbox = { minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 340 };
    const overflow = 50;
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: FAIL — `detectBboxInflation` is not exported

- [ ] **Step 3: Implement detectBboxInflation**

Add to `backend/src/controllers/admin/wvImportMatchIcp.ts` after `computeBboxFromDivisions`:

```typescript
/**
 * Detect if ICP alignment likely failed due to bbox inflation (distant islands).
 * Uses dual signal: aspect ratio mismatch (pre-ICP) AND high overflow (post-ICP).
 */
export function detectBboxInflation(
  gBbox: { minX: number; maxX: number; minY: number; maxY: number },
  cBbox: { minX: number; maxX: number; minY: number; maxY: number },
  bestOverflow: number,
  TW: number, TH: number,
): boolean {
  const gadmW = gBbox.maxX - gBbox.minX;
  const gadmH = gBbox.maxY - gBbox.minY;
  const cvW = cBbox.maxX - cBbox.minX;
  const cvH = cBbox.maxY - cBbox.minY;
  if (gadmW <= 0 || gadmH <= 0 || cvW <= 0 || cvH <= 0) return false;

  const gadmRatio = gadmW / gadmH;
  const cvRatio = cvW / cvH;
  const ratioMismatch = Math.max(gadmRatio, cvRatio) / Math.min(gadmRatio, cvRatio);
  const overflowPct = bestOverflow / Math.max(TW, TH);

  return ratioMismatch > 1.4 && overflowPct > 0.12;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchIcp.ts backend/src/controllers/admin/wvImportMatchIcp.test.ts
git commit -m "feat(cv): add bbox inflation detection for ICP adjustment"
```

---

### Task 3: Strategy B — BBox contribution outlier detection

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.test.ts`
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.ts`

- [ ] **Step 1: Write failing tests for findBboxOutliers**

Append to `backend/src/controllers/admin/wvImportMatchIcp.test.ts`:

```typescript
import { findBboxOutliers } from './wvImportMatchIcp.js';

describe('findBboxOutliers', () => {
  it('excludes a small distant island that inflates the bbox', () => {
    const divBboxes = [
      // Mainland divisions clustered together
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 100 },
      { id: 2, minX: 10, maxX: 20, minY: 0, maxY: 10, area: 100 },
      { id: 3, minX: 0, maxX: 10, minY: 10, maxY: 20, area: 100 },
      // Tiny distant island — inflates bbox to 100 wide
      { id: 4, minX: 95, maxX: 100, minY: 5, maxY: 10, area: 25 },
    ];
    // CV bbox is roughly square (mainland only)
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    expect(excluded).toContain(4);
    expect(excluded).not.toContain(1);
    expect(excluded).not.toContain(2);
    expect(excluded).not.toContain(3);
  });

  it('does not exclude large divisions (area guard)', () => {
    const divBboxes = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 50 },
      // This division extends the bbox but is large (>10% of total area)
      { id: 2, minX: 50, maxX: 100, minY: 0, maxY: 10, area: 60 },
    ];
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    expect(excluded).not.toContain(2);
  });

  it('returns empty when all divisions contribute equally', () => {
    const divBboxes = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 100 },
      { id: 2, minX: 10, maxX: 20, minY: 0, maxY: 10, area: 100 },
      { id: 3, minX: 0, maxX: 10, minY: 10, maxY: 20, area: 100 },
      { id: 4, minX: 10, maxX: 20, minY: 10, maxY: 20, area: 100 },
    ];
    // CV bbox has similar aspect ratio to GADM bbox
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    expect(excluded).toEqual([]);
  });

  it('stops when aspect ratio is close enough to CV bbox', () => {
    const divBboxes = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 100 },
      { id: 2, minX: 10, maxX: 20, minY: 0, maxY: 10, area: 100 },
      // Two small islands — only one needs removal to fix the ratio
      { id: 3, minX: 80, maxX: 85, minY: 5, maxY: 8, area: 15 },
      { id: 4, minX: 90, maxX: 95, minY: 5, maxY: 8, area: 15 },
    ];
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    // Should exclude the most impactful outlier(s) until ratio stabilizes
    expect(excluded.length).toBeGreaterThanOrEqual(1);
    expect(excluded.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: FAIL — `findBboxOutliers` is not exported

- [ ] **Step 3: Implement findBboxOutliers**

Add to `backend/src/controllers/admin/wvImportMatchIcp.ts` after `detectBboxInflation`:

```typescript
/**
 * Strategy B: Find divisions that inflate the GADM bbox disproportionately.
 * Iteratively removes the division whose removal shrinks the bbox the most,
 * until the aspect ratio matches the CV bbox or no significant improvement remains.
 */
export function findBboxOutliers(
  divBboxes: DivisionBbox[],
  cBbox: { minX: number; maxX: number; minY: number; maxY: number },
): number[] {
  const totalArea = divBboxes.reduce((sum, d) => sum + d.area, 0);
  const cvW = cBbox.maxX - cBbox.minX;
  const cvH = cBbox.maxY - cBbox.minY;
  if (cvW <= 0 || cvH <= 0) return [];
  const cvRatio = cvW / cvH;

  const excluded: number[] = [];
  let remaining = [...divBboxes];

  for (let iter = 0; iter < divBboxes.length && remaining.length > 1; iter++) {
    const curBbox = computeBboxFromDivisions(remaining);
    const curW = curBbox.maxX - curBbox.minX;
    const curH = curBbox.maxY - curBbox.minY;
    if (curW <= 0 || curH <= 0) break;

    const curRatio = curW / curH;
    const ratioMatch = Math.max(curRatio, cvRatio) / Math.min(curRatio, cvRatio);
    if (ratioMatch <= 1.3) break;

    const curArea = curW * curH;
    let bestReduction = 0;
    let bestIdx = -1;

    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].area > totalArea * 0.1) continue;
      const without = remaining.filter((_, j) => j !== i);
      if (without.length === 0) continue;
      const newBbox = computeBboxFromDivisions(without);
      const newArea = (newBbox.maxX - newBbox.minX) * (newBbox.maxY - newBbox.minY);
      const reduction = (curArea - newArea) / curArea;
      if (reduction > bestReduction) {
        bestReduction = reduction;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestReduction < 0.05) break;

    excluded.push(remaining[bestIdx].id);
    remaining = remaining.filter((_, i) => i !== bestIdx);
  }

  return excluded;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchIcp.ts backend/src/controllers/admin/wvImportMatchIcp.test.ts
git commit -m "feat(cv): add Strategy B bbox contribution outlier detection"
```

---

### Task 4: Strategy C — CV-GADM overlap outlier detection

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.test.ts`
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.ts`

- [ ] **Step 1: Write failing tests for findOverlapOutliers**

Append to `backend/src/controllers/admin/wvImportMatchIcp.test.ts`:

```typescript
import { findOverlapOutliers } from './wvImportMatchIcp.js';

describe('findOverlapOutliers', () => {
  const TW = 100, TH = 100;

  it('excludes divisions whose centroid projects outside the CV mask', () => {
    // Simple 1:1 identity-like transform
    const gadmToPixel = (gx: number, gy: number): [number, number] => [gx, gy];

    // icpMask: only the center 50x50 region is active
    const icpMask = new Uint8Array(TW * TH);
    for (let y = 25; y < 75; y++) {
      for (let x = 25; x < 75; x++) {
        icpMask[y * TW + x] = 1;
      }
    }

    // Division 1: centroid at (50, 50) — inside mask
    // Division 2: centroid at (90, 90) — outside mask
    // Using simple square polygons as SVG-like points
    const divPaths = [
      { id: 1, points: [[40, 40], [60, 40], [60, 60], [40, 60]] as Array<[number, number]> },
      { id: 2, points: [[85, 85], [95, 85], [95, 95], [85, 95]] as Array<[number, number]> },
    ];

    const excluded = findOverlapOutliers(divPaths, gadmToPixel, icpMask, TW, TH);
    expect(excluded).toContain(2);
    expect(excluded).not.toContain(1);
  });

  it('excludes divisions whose centroid projects outside the image', () => {
    // Transform that pushes some points off-screen
    const gadmToPixel = (gx: number, gy: number): [number, number] => [gx * 2 - 50, gy * 2 - 50];

    const icpMask = new Uint8Array(TW * TH);
    icpMask.fill(1); // Entire image is mask

    const divPaths = [
      { id: 1, points: [[50, 50], [60, 50], [60, 60], [50, 60]] as Array<[number, number]> },
      // Centroid at (10, 10) → transforms to (-30, -30) — off screen
      { id: 2, points: [[5, 5], [15, 5], [15, 15], [5, 15]] as Array<[number, number]> },
    ];

    const excluded = findOverlapOutliers(divPaths, gadmToPixel, icpMask, TW, TH);
    expect(excluded).toContain(2);
    expect(excluded).not.toContain(1);
  });

  it('returns empty when all divisions project onto the mask', () => {
    const gadmToPixel = (gx: number, gy: number): [number, number] => [gx, gy];
    const icpMask = new Uint8Array(TW * TH);
    icpMask.fill(1);

    const divPaths = [
      { id: 1, points: [[20, 20], [30, 20], [30, 30], [20, 30]] as Array<[number, number]> },
      { id: 2, points: [[60, 60], [70, 60], [70, 70], [60, 70]] as Array<[number, number]> },
    ];

    const excluded = findOverlapOutliers(divPaths, gadmToPixel, icpMask, TW, TH);
    expect(excluded).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: FAIL — `findOverlapOutliers` is not exported

- [ ] **Step 3: Implement findOverlapOutliers**

Add to `backend/src/controllers/admin/wvImportMatchIcp.ts` after `findBboxOutliers`:

```typescript
/**
 * Strategy C: Find divisions whose centroid doesn't land on the CV mask
 * when projected using the (possibly bad) initial gadmToPixel transform.
 * Accepts pre-parsed points to keep SVG parsing in the caller.
 */
export function findOverlapOutliers(
  divPaths: Array<{ id: number; points: Array<[number, number]> }>,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  icpMask: Uint8Array,
  TW: number, TH: number,
): number[] {
  const excluded: number[] = [];
  for (const d of divPaths) {
    if (d.points.length === 0) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of d.points) { cx += x; cy += y; }
    cx /= d.points.length;
    cy /= d.points.length;
    const [px, py] = gadmToPixel(cx, cy);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix < 0 || ix >= TW || iy < 0 || iy >= TH || !icpMask[iy * TW + ix]) {
      excluded.push(d.id);
    }
  }
  return excluded;
}
```

**Note:** This function accepts pre-parsed `points` arrays rather than raw SVG strings. The caller (`wvImportMatchShared.ts`) will parse the SVG paths via `parseSvgPathPoints` before calling this, which avoids importing SVG helpers and keeps the function pure/testable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchIcp.ts backend/src/controllers/admin/wvImportMatchIcp.test.ts
git commit -m "feat(cv): add Strategy C CV-GADM overlap outlier detection"
```

---

### Task 5: Extend alignDivisionsToImage for bbox override + relaxed scale

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchIcp.ts`

- [ ] **Step 1: Add optional fields to AlignmentParams and AlignmentResult**

In `backend/src/controllers/admin/wvImportMatchIcp.ts`, extend the interfaces:

```typescript
export interface AlignmentParams {
  // ... all existing fields unchanged ...

  /** Override GADM bbox (for adjusted alignment after excluding islands) */
  gBboxOverride?: { minX: number; maxX: number; minY: number; maxY: number };
  /** Scale constraint range — 0.10 means ±10% (default), 0.25 means ±25% */
  scaleRange?: number;
}

export interface AlignmentResult {
  // ... all existing fields unchanged ...

  /** GADM bbox used for alignment (original or overridden) */
  gBbox: { minX: number; maxX: number; minY: number; maxY: number };
  /** CV bbox computed from border pixels */
  cBbox: { minX: number; maxX: number; minY: number; maxY: number };
}
```

- [ ] **Step 2: Use overrides in alignDivisionsToImage**

In `alignDivisionsToImage`, modify the bbox computation (around line 192):

Change:
```typescript
const gBbox = { minX: cMinX, maxX: cMaxX, minY: -cMaxY, maxY: -cMinY };
```

To:
```typescript
const gBbox = params.gBboxOverride ?? { minX: cMinX, maxX: cMaxX, minY: -cMaxY, maxY: -cMinY };
```

Modify the scale constraint in Option B (around line 260-261) and Option C (around line 336-337):

Change `0.90` / `1.10` to use the configurable range:
```typescript
const range = params.scaleRange ?? 0.10;
// Option B (two locations):
sxB = Math.max(initSx * (1 - range), Math.min(initSx * (1 + range), (np * sGxCx - sGx * sCx) / detX));
syB = Math.max(initSy * (1 - range), Math.min(initSy * (1 + range), (np * sGyCy - sGy * sCy) / detY));
// Option C (two locations):
sxC = Math.max(initSx * (1 - range), Math.min(initSx * (1 + range), (wSum * wsGxCx - wsGx * wsCx) / detXC));
syC = Math.max(initSy * (1 - range), Math.min(initSy * (1 + range), (wSum * wsGyCy - wsGy * wsCy) / detYC));
```

- [ ] **Step 3: Return gBbox and cBbox in the result**

At the end of `alignDivisionsToImage`, change the return statement to include the new fields:

```typescript
return {
  gadmToPixel,
  bestLabel: best.label,
  bestError: best.error,
  bestOverflow: best.overflow,
  gBbox,
  cBbox,
};
```

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `cd backend && npx vitest run src/controllers/admin/wvImportMatchIcp.test.ts`
Expected: PASS — all existing tests still pass (new fields are optional)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchIcp.ts
git commit -m "feat(cv): extend alignDivisionsToImage with bbox override and scale range params"
```

---

### Task 6: SSE orchestration — adjustment pause/resume in wvImportMatchShared.ts

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchShared.ts`

**Context:** The ICP alignment is called at ~line 521-528 in `matchDivisionsFromClusters()`. The adjustment logic goes between ICP alignment and division assignment (~line 530). Follow the same pause/resume pattern as `pendingClusterReviews` (line 431-440).

- [ ] **Step 1: Add pending adjustments Map and resolve function**

At the top of `wvImportMatchShared.ts`, near the existing `pendingClusterReviews` declaration, add:

```typescript
export interface IcpAdjustmentDecision {
  action: 'adjust' | 'continue';
}

const pendingIcpAdjustments = new Map<string, (decision: IcpAdjustmentDecision) => void>();

export function resolveIcpAdjustment(reviewId: string, decision: IcpAdjustmentDecision): boolean {
  const resolve = pendingIcpAdjustments.get(reviewId);
  if (resolve) {
    pendingIcpAdjustments.delete(reviewId);
    resolve(decision);
    return true;
  }
  return false;
}
```

- [ ] **Step 2: Add adjustment orchestration after ICP alignment call**

After the existing `alignDivisionsToImage` call (~line 528), add the detection + adjustment logic. Insert between the ICP result destructuring and the "Assigning GADM divisions" log step:

```typescript
import {
  alignDivisionsToImage,
  detectBboxInflation,
  findBboxOutliers,
  findOverlapOutliers,
  computeShoelaceArea,
  computeBboxFromDivisions,
  type AlignmentResult,
  type DivisionBbox,
} from './wvImportMatchIcp.js';
import { parseSvgPathPoints } from './wvImportMatchSvgHelpers.js';

// ... inside matchDivisionsFromClusters, after alignDivisionsToImage returns:
// Note: destructure gBbox and cBbox from the result (new fields from Task 5):
// const { gadmToPixel, bestLabel, bestError, bestOverflow, gBbox, cBbox } = await alignDivisionsToImage({...});

// Build the shared ICP params object for potential re-calls
const icpParams = {
  divPaths, countryPath,
  cMinX, cMinY, cMaxX, cMaxY,
  icpMask, pixelLabels,
  TW, TH, origW, origH,
  quantBuf, centroids, mapBuffer,
  pxS, pushDebugImage,
};

let finalGadmToPixel = gadmToPixel;
let finalBestLabel = bestLabel;
let finalBestError = bestError;
let finalBestOverflow = bestOverflow;

// Check for bbox inflation (islands problem)
const inflationDetected = detectBboxInflation(gBbox, cBbox, bestOverflow, TW, TH);

if (inflationDetected) {
  console.log(`  [ICP] Bbox inflation detected — aspect ratio mismatch + high overflow`);
  const reviewId = `icp-adj-${Date.now()}`;

  sendEvent({
    type: 'icp_adjustment_available',
    reviewId,
    message: 'Alignment quality is lower than expected, possibly due to small islands or features not shown on the map.',
    metrics: { overflow: bestOverflow, error: bestError, icpOption: bestLabel },
  });

  const decision = await new Promise<IcpAdjustmentDecision>((resolve) => {
    pendingIcpAdjustments.set(reviewId, resolve);
    setTimeout(() => {
      if (pendingIcpAdjustments.has(reviewId)) {
        console.log(`  [ICP Adjustment] Review ${reviewId} timed out — continuing with original`);
        pendingIcpAdjustments.delete(reviewId);
        resolve({ action: 'continue' });
      }
    }, 300000); // 5-minute timeout
  });

  if (decision.action === 'adjust') {
    await logStep('Adjusting ICP alignment (excluding outlier islands)...');

    // Parse division SVG points (needed for both strategies)
    const divParsed = divPaths.map(d => ({
      id: d.id,
      points: parseSvgPathPoints(d.svgPath),
    }));

    // Compute per-division bboxes + areas for Strategy B
    const divBboxes: DivisionBbox[] = divParsed.map(d => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of d.points) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { id: d.id, minX, maxX, minY, maxY, area: computeShoelaceArea(d.points) };
    });

    // Strategy B: BBox contribution analysis
    const excludedB = findBboxOutliers(divBboxes, cBbox);
    const remainingB = divBboxes.filter(d => !excludedB.includes(d.id));
    let resultB: AlignmentResult | null = null;
    if (excludedB.length > 0 && remainingB.length > 0) {
      const bboxB = computeBboxFromDivisions(remainingB);
      console.log(`  [ICP Adjust B] Excluded ${excludedB.length} divisions: [${excludedB}], new bbox: x=[${bboxB.minX.toFixed(4)},${bboxB.maxX.toFixed(4)}]`);
      resultB = await alignDivisionsToImage({
        ...icpParams,
        gBboxOverride: bboxB,
        scaleRange: 0.25,
      });
    }

    // Strategy C: CV-GADM overlap check
    const excludedC = findOverlapOutliers(divParsed, gadmToPixel, icpMask, TW, TH);
    const remainingC = divBboxes.filter(d => !excludedC.includes(d.id));
    let resultC: AlignmentResult | null = null;
    if (excludedC.length > 0 && remainingC.length > 0) {
      const bboxC = computeBboxFromDivisions(remainingC);
      console.log(`  [ICP Adjust C] Excluded ${excludedC.length} divisions: [${excludedC}], new bbox: x=[${bboxC.minX.toFixed(4)},${bboxC.maxX.toFixed(4)}]`);
      resultC = await alignDivisionsToImage({
        ...icpParams,
        gBboxOverride: bboxC,
        scaleRange: 0.25,
      });
    }

    // Pick the best result among original, B, and C
    const candidates: Array<{ label: string; overflow: number; error: number; result: AlignmentResult | null }> = [
      { label: 'original', overflow: bestOverflow, error: bestError, result: null },
      ...(resultB ? [{ label: 'strategyB', overflow: resultB.bestOverflow, error: resultB.bestError, result: resultB }] : []),
      ...(resultC ? [{ label: 'strategyC', overflow: resultC.bestOverflow, error: resultC.bestError, result: resultC }] : []),
    ];
    candidates.sort((a, b) => {
      if (Math.abs(a.overflow - b.overflow) < 3) return a.error - b.error;
      return a.overflow - b.overflow;
    });
    const winner = candidates[0];

    if (winner.result) {
      finalGadmToPixel = winner.result.gadmToPixel;
      finalBestLabel = winner.result.bestLabel;
      finalBestError = winner.result.bestError;
      finalBestOverflow = winner.result.bestOverflow;
      console.log(`  [ICP Adjust] Winner: ${winner.label} (ICP ${finalBestLabel}, err=${finalBestError.toFixed(1)}, overflow=${finalBestOverflow.toFixed(0)}px)`);
    } else {
      console.log(`  [ICP Adjust] Original alignment was best — keeping it`);
    }
  } else {
    console.log(`  [ICP Adjustment] User chose to continue with original alignment`);
  }
}
```

- [ ] **Step 3: Update downstream code to use finalGadmToPixel**

Replace the `gadmToPixel` variable used in the `assignDivisionsToClusters` call (around line 534) with `finalGadmToPixel`:

```typescript
const assignmentResult = await assignDivisionsToClusters({
  divPaths, centroids, divNameMap, gadmToPixel: finalGadmToPixel,
  // ... rest unchanged
});
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: PASS — no type errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchShared.ts
git commit -m "feat(cv): add ICP adjustment SSE orchestration with dual strategy"
```

---

### Task 7: Backend route for ICP adjustment decision

**Files:**
- Modify: `backend/src/routes/adminRoutes.ts`

- [ ] **Step 1: Add the POST route handler**

In `backend/src/routes/adminRoutes.ts`, near the existing cluster-review and water-review routes (around line 373), add:

```typescript
import { resolveIcpAdjustment } from '../controllers/admin/wvImportMatchShared.js';

// ... inside the router setup:

router.post('/wv-import/icp-adjustment/:reviewId', (req: AuthenticatedRequest, res: Response) => {
  const reviewId = String(req.params.reviewId);
  const action = req.body?.action === 'adjust' ? 'adjust' : 'continue';
  console.log(`  [ICP Adjustment POST] reviewId=${reviewId} action=${action}`);
  const found = resolveIcpAdjustment(reviewId, { action });
  if (found) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Review not found or expired' });
  }
});
```

**Note:** `resolveIcpAdjustment` is likely already imported from the same module as `resolveClusterReview` — add it to the existing import statement.

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/adminRoutes.ts
git commit -m "feat(cv): add POST route for ICP adjustment decision"
```

---

### Task 8: Frontend — API function, SSE handling, and UI component

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts`
- Modify: `frontend/src/components/admin/useCvMatchPipeline.ts`
- Create: `frontend/src/components/admin/CvIcpAdjustmentSection.tsx`
- Modify: `frontend/src/components/admin/CvMatchDialog.tsx`

- [ ] **Step 1: Add API type and function in adminWorldViewImport.ts**

In `frontend/src/api/adminWorldViewImport.ts`, near the existing `respondToClusterReview`:

```typescript
export interface IcpAdjustmentDecision {
  action: 'adjust' | 'continue';
}

export async function respondToIcpAdjustment(reviewId: string, decision: IcpAdjustmentDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/icp-adjustment/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}
```

- [ ] **Step 2: Add icpAdjustment state to CvMatchDialogState**

In `frontend/src/components/admin/useCvMatchPipeline.ts`, extend `CvMatchDialogState`:

```typescript
export interface CvMatchDialogState {
  // ... all existing fields ...
  icpAdjustment?: {
    reviewId: string;
    message: string;
    metrics: { overflow: number; error: number; icpOption: string };
  };
}
```

- [ ] **Step 3: Handle icp_adjustment_available SSE event**

In `useCvMatchPipeline.ts`, in the SSE event handler (around line 251, near the cluster_review handler), add:

```typescript
if (event.type === 'icp_adjustment_available' && event.reviewId) {
  console.log(`[CV SSE] icp_adjustment_available: reviewId=${event.reviewId}`);
  const rid = event.reviewId as string;
  setCVMatchDialog(prev => {
    if (!prev) return prev;
    return {
      ...prev,
      icpAdjustment: {
        reviewId: rid,
        message: (event.message as string) ?? 'Alignment quality is lower than expected.',
        metrics: {
          overflow: (event.metrics as { overflow: number })?.overflow ?? 0,
          error: (event.metrics as { error: number })?.error ?? 0,
          icpOption: (event.metrics as { icpOption: string })?.icpOption ?? '',
        },
      },
      progressText: 'ICP alignment — adjustment available',
      progressColor: '#ed6c02',
    };
  });
}
```

- [ ] **Step 4: Create CvIcpAdjustmentSection component**

```typescript
// frontend/src/components/admin/CvIcpAdjustmentSection.tsx
import { Box, Typography, Button, Alert, Stack } from '@mui/material';
import { respondToIcpAdjustment } from '../../api/adminWorldViewImport';
import type { CvMatchDialogState } from './useCvMatchPipeline';

export interface CvIcpAdjustmentSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
}

export function CvIcpAdjustmentSection({ cvMatchDialog, setCVMatchDialog }: CvIcpAdjustmentSectionProps) {
  const adj = cvMatchDialog.icpAdjustment;
  if (!adj) return null;

  const handleDecision = async (action: 'adjust' | 'continue') => {
    setCVMatchDialog(prev => prev ? {
      ...prev,
      icpAdjustment: undefined,
      progressText: action === 'adjust' ? 'Adjusting alignment...' : 'Continuing with original alignment...',
      progressColor: '#1565c0',
    } : prev);
    try {
      await respondToIcpAdjustment(adj.reviewId, { action });
    } catch (e) {
      console.error('[ICP Adjustment] POST failed:', e);
    }
  };

  return (
    <Box sx={{ my: 2 }}>
      <Alert severity="warning" sx={{ mb: 1.5 }}>
        <Typography variant="body2">{adj.message}</Typography>
      </Alert>
      <Stack direction="row" spacing={1.5}>
        <Button
          size="small"
          variant="contained"
          color="warning"
          onClick={() => handleDecision('adjust')}
        >
          Adjust alignment
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => handleDecision('continue')}
        >
          Continue anyway
        </Button>
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 5: Wire CvIcpAdjustmentSection into CvMatchDialog.tsx**

In `CvMatchDialog.tsx`, add the import and render the section. Near the existing review sections (around line 100-105):

```typescript
import { CvIcpAdjustmentSection } from './CvIcpAdjustmentSection';

// Inside the render, after the cluster review section and before geo preview:
{cvMatchDialog.icpAdjustment && (
  <CvIcpAdjustmentSection
    cvMatchDialog={cvMatchDialog}
    setCVMatchDialog={setCVMatchDialog}
  />
)}
```

- [ ] **Step 6: Run type check and lint**

Run: `npm run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/adminWorldViewImport.ts \
  frontend/src/components/admin/useCvMatchPipeline.ts \
  frontend/src/components/admin/CvIcpAdjustmentSection.tsx \
  frontend/src/components/admin/CvMatchDialog.tsx
git commit -m "feat(cv): add ICP adjustment UI with adjust/continue buttons"
```

---

### Task 9: Pre-commit checks

- [ ] **Step 1: Run full check suite**

```bash
npm run check
npm run knip
TEST_REPORT_LOCAL=1 npm test
npm run security:all
```

Expected: All pass. If `knip` reports unused exports (the new helper functions are exported for testing), verify they are used in tests and the orchestration code.

- [ ] **Step 2: Fix any issues found**

Address lint errors, unused imports, or type issues.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(cv): address lint and type issues from ICP adjustment feature"
```
