# Vector Border Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raster border editing with vector SVG overlay — borders extracted as polyline paths from the CV pipeline, rendered and edited as SVG elements, with eraser path-splitting, polyline endpoint snapping, and on-demand rasterization for flood fill.

**Architecture:** Backend traces border pixels into ordered polyline paths (chain-tracing + Douglas-Peucker simplification) and sends them via SSE. Frontend renders paths as an SVG overlay, with tools for erasing (split paths), drawing (polyline with snap), and filling (rasterize SVG to hidden canvas for flood fill). Atrament removed entirely.

**Tech Stack:** SVG for vector border rendering/editing, Canvas for flood fill rasterization + color fills, Douglas-Peucker for path simplification, Catmull-Rom for smooth rendering

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `backend/src/controllers/admin/wvImportMatchBorderTrace.ts` | Chain-tracing algorithm: border pixels → ordered polyline paths + Douglas-Peucker simplification |
| `backend/src/controllers/admin/wvImportMatchBorderTrace.test.ts` | Tests for chain-tracing and simplification |
| `frontend/src/components/admin/svgBorderUtils.ts` | SVG path generation (Catmull-Rom smoothing), rasterization to canvas, eraser intersection math |
| `frontend/src/components/admin/svgBorderUtils.test.ts` | Tests for path smoothing, point-to-segment distance, Douglas-Peucker |

### Modified Files
| File | Changes |
|------|---------|
| `backend/src/controllers/admin/wvImportMatchClusterClean.ts` | Call `traceBorderPaths()` after border pixel detection, return paths |
| `backend/src/controllers/admin/wvImportMatchShared.ts` | Include `borderPaths` in cluster_review SSE event |
| `frontend/src/api/adminWvImportCvMatch.ts` | Add `BorderPath` type, extend SSE event type |
| `frontend/src/components/admin/useCvMatchPipeline.ts` | Store `borderPaths` in `clusterReview` state |
| `frontend/src/components/admin/CvClusterReviewSection.tsx` | Pass `borderPaths` to editor |
| `frontend/src/components/admin/ClusterPaintEditor.tsx` | **Major rewrite**: remove Atrament/border canvas, add SVG overlay |
| `frontend/src/components/admin/clusterPaintUtils.ts` | Keep `floodFillFromSource` (signature unchanged), remove unused helpers |
| `frontend/package.json` | Remove `atrament` dependency |

### Removed Files
| File | Reason |
|------|--------|
| `frontend/src/types/atrament.d.ts` | No longer needed — Atrament removed |

---

### Task 1: Chain-Tracing Algorithm with Tests

**Files:**
- Create: `backend/src/controllers/admin/wvImportMatchBorderTrace.ts`
- Create: `backend/src/controllers/admin/wvImportMatchBorderTrace.test.ts`

This is the core algorithm: given `pixelLabels` (Uint8Array) and dimensions (TW, TH), extract ordered polyline paths from border pixels.

- [ ] **Step 1: Write failing tests for chain tracing**

```typescript
// backend/src/controllers/admin/wvImportMatchBorderTrace.test.ts
import { describe, it, expect } from 'vitest';
import { traceBorderPaths, douglasPeucker } from './wvImportMatchBorderTrace';

describe('traceBorderPaths', () => {
  it('traces a simple horizontal border between two clusters', () => {
    // 4x3 grid: top row = cluster 0, bottom two rows = cluster 1
    // Border should be at y=0/y=1 boundary
    const TW = 4, TH = 3;
    const labels = new Uint8Array([
      0, 0, 0, 0,
      1, 1, 1, 1,
      1, 1, 1, 1,
    ]);
    const paths = traceBorderPaths(labels, TW, TH);
    expect(paths.length).toBeGreaterThan(0);
    // All paths should be internal (cluster 0 ↔ cluster 1)
    for (const p of paths) {
      expect(p.type).toBe('internal');
      expect(p.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('traces external border (cluster vs background 255)', () => {
    // 4x4 grid: center 2x2 = cluster 0, rest = background (255)
    const TW = 4, TH = 4;
    const labels = new Uint8Array([
      255, 255, 255, 255,
      255,   0,   0, 255,
      255,   0,   0, 255,
      255, 255, 255, 255,
    ]);
    const paths = traceBorderPaths(labels, TW, TH);
    expect(paths.length).toBeGreaterThan(0);
    const ext = paths.filter(p => p.type === 'external');
    expect(ext.length).toBeGreaterThan(0);
  });

  it('returns empty for uniform labels', () => {
    const labels = new Uint8Array([0, 0, 0, 0]);
    expect(traceBorderPaths(labels, 2, 2)).toEqual([]);
  });

  it('assigns unique IDs to each path', () => {
    const TW = 4, TH = 3;
    const labels = new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 2, 2]);
    const paths = traceBorderPaths(labels, TW, TH);
    const ids = paths.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('douglasPeucker', () => {
  it('simplifies a straight line to just endpoints', () => {
    const pts: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    const simplified = douglasPeucker(pts, 1.0);
    expect(simplified).toEqual([[0, 0], [4, 0]]);
  });

  it('preserves corners', () => {
    // L-shape: horizontal then vertical
    const pts: Array<[number, number]> = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
    const simplified = douglasPeucker(pts, 1.0);
    expect(simplified.length).toBe(3); // start, corner, end
    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified[1]).toEqual([10, 0]);
    expect(simplified[2]).toEqual([10, 10]);
  });

  it('returns input if 2 or fewer points', () => {
    expect(douglasPeucker([[0, 0], [1, 1]], 1.0)).toEqual([[0, 0], [1, 1]]);
    expect(douglasPeucker([[0, 0]], 1.0)).toEqual([[0, 0]]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `TEST_REPORT_LOCAL=1 npx vitest run backend/src/controllers/admin/wvImportMatchBorderTrace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement chain-tracing + Douglas-Peucker**

```typescript
// backend/src/controllers/admin/wvImportMatchBorderTrace.ts

export interface BorderPath {
  id: string;
  points: Array<[number, number]>;
  type: 'internal' | 'external';
  clusters: [number, number];
}

/**
 * Extract border pixels from pixelLabels and trace them into ordered polyline paths.
 * Uses 4-neighbor detection (same as existing overlayBuf border check) and
 * 8-connectivity chain-tracing to order the pixels into paths.
 */
export function traceBorderPaths(pixelLabels: Uint8Array, TW: number, TH: number): BorderPath[] {
  // Step 1: Detect all border pixels and classify them
  interface BorderPixel {
    x: number;
    y: number;
    type: 'internal' | 'external';
    clusterA: number;  // the label at this pixel
    clusterB: number;  // the differing neighbor label
  }

  const borderMap = new Map<number, BorderPixel>(); // key = y*TW+x

  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      const label = pixelLabels[p];
      if (label === 255) continue;

      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (pixelLabels[n] === label) continue;
        const neighborLabel = pixelLabels[n];
        const type = neighborLabel === 255 ? 'external' : 'internal';
        // Use canonical cluster pair (lower label first) for consistent grouping
        const clusterA = Math.min(label, neighborLabel);
        const clusterB = Math.max(label, neighborLabel);
        borderMap.set(p, { x, y, type, clusterA, clusterB });
        break; // one classification per pixel is enough
      }
    }
  }

  if (borderMap.size === 0) return [];

  // Step 2: Group border pixels by their cluster pair
  const groups = new Map<string, number[]>(); // "clA:clB" → pixel indices
  for (const [idx, bp] of borderMap) {
    const key = `${bp.clusterA}:${bp.clusterB}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(idx);
  }

  // Step 3: Chain-trace each group into ordered paths
  const paths: BorderPath[] = [];
  let nextId = 0;

  for (const [key, pixels] of groups) {
    const pixelSet = new Set(pixels);
    const visited = new Set<number>();
    const firstBp = borderMap.get(pixels[0])!;

    for (const startIdx of pixels) {
      if (visited.has(startIdx)) continue;

      // Trace a chain starting from this pixel using 8-connectivity
      const chain: Array<[number, number]> = [];
      let current = startIdx;

      while (current !== -1) {
        visited.add(current);
        const bp = borderMap.get(current)!;
        chain.push([bp.x, bp.y]);

        // Find next unvisited neighbor in the same group (8-connectivity)
        const cx = current % TW;
        const cy = Math.floor(current / TW);
        let next = -1;

        for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
          const ni = ny * TW + nx;
          if (!visited.has(ni) && pixelSet.has(ni)) {
            next = ni;
            break;
          }
        }
        current = next;
      }

      if (chain.length >= 2) {
        paths.push({
          id: `bp-${nextId++}`,
          points: douglasPeucker(chain, 1.5),
          type: firstBp.type,
          clusters: [firstBp.clusterA, firstBp.clusterB],
        });
      }
    }
  }

  return paths;
}

/**
 * Douglas-Peucker line simplification.
 * Reduces point count while preserving shape within tolerance.
 */
export function douglasPeucker(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 2) return [...points];

  // Find the point farthest from the line between first and last
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToLineDistance(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/** Perpendicular distance from point to line segment */
function pointToLineDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const num = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]);
  return num / Math.sqrt(lenSq);
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `TEST_REPORT_LOCAL=1 npx vitest run backend/src/controllers/admin/wvImportMatchBorderTrace.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchBorderTrace.ts backend/src/controllers/admin/wvImportMatchBorderTrace.test.ts
git commit -m "feat: chain-tracing algorithm for border pixel extraction

Traces connected border pixels (from pixelLabels neighbor check) into
ordered polyline paths with Douglas-Peucker simplification. Groups
borders by adjacent cluster pair. 8-connectivity chain-tracing."
```

---

### Task 2: Backend — Wire Border Paths Into SSE Event

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchClusterClean.ts:567-584`
- Modify: `backend/src/controllers/admin/wvImportMatchShared.ts:455-467`

- [ ] **Step 1: Call traceBorderPaths in cleanClusters**

In `wvImportMatchClusterClean.ts`, the function `cleanClusters` currently returns `{ finalLabels, quantBuf, icpMask }`. After the border pixel detection loop (line 567) and before the debug image generation (line 576), call `traceBorderPaths`:

```typescript
import { traceBorderPaths, type BorderPath } from './wvImportMatchBorderTrace';
```

After line 567 (end of border detection loop), add:

```typescript
  // Extract border pixels as ordered vector paths for the manual paint editor
  const borderPaths = traceBorderPaths(pixelLabels, TW, TH);
  console.log(`  [Borders] Traced ${borderPaths.length} vector paths (${borderPaths.filter(p => p.type === 'internal').length} internal, ${borderPaths.filter(p => p.type === 'external').length} external)`);
```

Update the return type to include `borderPaths`. Find where `cleanClusters` returns its result and add `borderPaths` to the return object.

- [ ] **Step 2: Include borderPaths in the SSE cluster_review event**

In `wvImportMatchShared.ts`, the `cleanClusters` call (around line 373) destructures the return value. Add `borderPaths` to the destructured result:

```typescript
  const { finalLabels, quantBuf, icpMask, borderPaths } = await cleanClusters({ ... });
```

Then in the SSE event (line 455-467), add `borderPaths` to `data`:

```typescript
      sendEvent({
        type: 'cluster_review',
        reviewId,
        data: {
          clusters: clusterInfos.map(c => ({
            label: c.label,
            color: `rgb(${c.color[0]},${c.color[1]},${c.color[2]})`,
            pct: c.pct,
            isSmall: c.pct < 3,
            componentCount: c.componentCount,
          })),
          borderPaths,
        },
      });
```

- [ ] **Step 3: Run typecheck**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchClusterClean.ts backend/src/controllers/admin/wvImportMatchShared.ts
git commit -m "feat(backend): extract vector border paths and include in SSE event

Call traceBorderPaths after border pixel detection, include the
resulting BorderPath[] in the cluster_review SSE event data."
```

---

### Task 3: Frontend Types + SSE Handling

**Files:**
- Modify: `frontend/src/api/adminWvImportCvMatch.ts:94-140`
- Modify: `frontend/src/components/admin/useCvMatchPipeline.ts:70-83,260-316`
- Modify: `frontend/src/components/admin/CvClusterReviewSection.tsx:76-81`

- [ ] **Step 1: Add BorderPath type and extend SSE event**

In `frontend/src/api/adminWvImportCvMatch.ts`, after `ClusterReviewCluster` (line 100), add:

```typescript
export interface BorderPath {
  id: string;
  points: Array<[number, number]>;  // at TW x TH resolution
  type: 'internal' | 'external';
  clusters: [number, number];
}
```

In `ColorMatchSSEEvent`, the `data` field already has `clusters?: ClusterReviewCluster[]`. Add `borderPaths`:

```typescript
  data?: ColorMatchResult & {
    parkCount?: number; totalParkPct?: number; components?: ParkComponent[];
    clusters?: ClusterReviewCluster[];
    borderPaths?: BorderPath[];
  };
```

- [ ] **Step 2: Store borderPaths in clusterReview state**

In `useCvMatchPipeline.ts`, add `borderPaths` to the `clusterReview` type (around line 70):

```typescript
  clusterReview?: {
    reviewId: string;
    clusters: ClusterReviewCluster[];
    borderPaths: BorderPath[];  // ← add this
    previewImage: string;
    // ... rest unchanged
  };
```

In the cluster_review SSE handler (around line 260-316), when constructing the `clusterReview` object, include:

```typescript
    borderPaths: event.data?.borderPaths ?? [],
```

- [ ] **Step 3: Pass borderPaths to ClusterPaintEditor**

In `CvClusterReviewSection.tsx`, add `borderPaths` prop to the `ClusterPaintEditor` invocation:

```typescript
  <ClusterPaintEditor
    sourceImageUrl={sourceImg?.dataUrl ?? ''}
    originalImageUrl={originalImg?.dataUrl}
    borderPaths={cr.borderPaths}           // ← add this
    overlayImageUrl={paintMode === 'fix' ? clusterOverlayUrl(cr.reviewId) : undefined}
    initialClusters={paintMode === 'fix' ? cr.clusters : undefined}
    ...
  />
```

- [ ] **Step 4: Run typecheck**

Run: `npm run check`
Expected: Type error in ClusterPaintEditor.tsx (borderPaths not in Props yet) — expected, will be fixed in Task 5.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/adminWvImportCvMatch.ts frontend/src/components/admin/useCvMatchPipeline.ts frontend/src/components/admin/CvClusterReviewSection.tsx
git commit -m "feat(frontend): add BorderPath type, store in SSE state, pass to editor"
```

---

### Task 4: SVG Border Utilities with Tests

**Files:**
- Create: `frontend/src/components/admin/svgBorderUtils.ts`
- Create: `frontend/src/components/admin/svgBorderUtils.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/components/admin/svgBorderUtils.test.ts
import { describe, it, expect } from 'vitest';
import {
  pointsToSmoothSvgPath, rasterizeBorderPaths,
  findOpenEndpoints, pointToSegmentDistance,
} from './svgBorderUtils';
import type { BorderPath } from '../../api/adminWvImportCvMatch';

describe('pointsToSmoothSvgPath', () => {
  it('converts 2 points to a simple line', () => {
    const d = pointsToSmoothSvgPath([[0, 0], [10, 10]]);
    expect(d).toContain('M 0 0');
    expect(d).toContain('L 10 10');
  });

  it('converts 3+ points to smooth curves', () => {
    const d = pointsToSmoothSvgPath([[0, 0], [5, 3], [10, 0]]);
    expect(d).toContain('M 0 0');
    expect(d).toContain('C'); // cubic bezier from Catmull-Rom
  });
});

describe('findOpenEndpoints', () => {
  it('returns endpoints of unclosed paths', () => {
    const paths: BorderPath[] = [
      { id: 'a', points: [[0, 0], [10, 0], [20, 0]], type: 'internal', clusters: [0, 1] },
      { id: 'b', points: [[30, 0], [40, 0]], type: 'internal', clusters: [0, 1] },
    ];
    const eps = findOpenEndpoints(paths);
    expect(eps.length).toBe(4); // 2 per open path
    expect(eps[0]).toEqual({ pathId: 'a', end: 'start', x: 0, y: 0 });
    expect(eps[1]).toEqual({ pathId: 'a', end: 'end', x: 20, y: 0 });
  });

  it('excludes endpoints that are close to another endpoint (junctions)', () => {
    const paths: BorderPath[] = [
      { id: 'a', points: [[0, 0], [10, 0]], type: 'internal', clusters: [0, 1] },
      { id: 'b', points: [[10, 1], [20, 0]], type: 'internal', clusters: [0, 2] }, // end of a ≈ start of b
    ];
    const eps = findOpenEndpoints(paths, 2); // junction threshold = 2px
    // a.end and b.start are within 2px — they're a junction, not open
    expect(eps.length).toBe(2); // only a.start and b.end
  });
});

describe('pointToSegmentDistance', () => {
  it('computes distance to horizontal segment', () => {
    expect(pointToSegmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('computes distance to segment endpoint when perpendicular falls outside', () => {
    expect(pointToSegmentDistance(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `TEST_REPORT_LOCAL=1 npx vitest run frontend/src/components/admin/svgBorderUtils.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement SVG utilities**

```typescript
// frontend/src/components/admin/svgBorderUtils.ts
import type { BorderPath } from '../../api/adminWvImportCvMatch';

export interface OpenEndpoint {
  pathId: string;
  end: 'start' | 'end';
  x: number;
  y: number;
}

/**
 * Convert ordered points to a smooth SVG path `d` attribute using Catmull-Rom → cubic Bezier.
 * For 2 points: straight line. For 3+: smooth curves.
 */
export function pointsToSmoothSvgPath(points: Array<[number, number]>): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }

  // Catmull-Rom to cubic Bezier conversion
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom → Bezier control points (alpha=0.5 for centripetal)
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/**
 * Find open endpoints — path start/end points that are NOT junctions
 * (not close to another path's endpoint within threshold).
 */
export function findOpenEndpoints(paths: BorderPath[], junctionThreshold = 2): OpenEndpoint[] {
  // Collect all endpoints
  const allEndpoints: OpenEndpoint[] = [];
  for (const p of paths) {
    if (p.points.length < 2) continue;
    const first = p.points[0];
    const last = p.points[p.points.length - 1];
    allEndpoints.push({ pathId: p.id, end: 'start', x: first[0], y: first[1] });
    allEndpoints.push({ pathId: p.id, end: 'end', x: last[0], y: last[1] });
  }

  // An endpoint is "open" if no OTHER endpoint is within junctionThreshold
  return allEndpoints.filter(ep => {
    for (const other of allEndpoints) {
      if (other.pathId === ep.pathId && other.end === ep.end) continue;
      const dx = ep.x - other.x, dy = ep.y - other.y;
      if (Math.sqrt(dx * dx + dy * dy) <= junctionThreshold) return false;
    }
    return true;
  });
}

/**
 * Distance from point (px, py) to line segment (ax, ay)-(bx, by).
 * Returns closest distance, clamped to segment endpoints.
 */
export function pointToSegmentDistance(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx, projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Rasterize border paths onto a canvas for flood fill boundary detection.
 * Creates a hidden canvas, strokes all paths, returns ImageData.
 */
export function rasterizeBorderPaths(
  paths: BorderPath[],
  displayWidth: number,
  displayHeight: number,
  pipelineWidth: number,
  pipelineHeight: number,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = displayWidth;
  canvas.height = displayHeight;
  const ctx = canvas.getContext('2d')!;

  const scaleX = displayWidth / pipelineWidth;
  const scaleY = displayHeight / pipelineHeight;

  ctx.strokeStyle = 'rgb(21, 101, 192)';
  ctx.lineWidth = Math.max(2, 3 * scaleX); // scale border width
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const path of paths) {
    if (path.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(path.points[0][0] * scaleX, path.points[0][1] * scaleY);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i][0] * scaleX, path.points[i][1] * scaleY);
    }
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, displayWidth, displayHeight);
}

/**
 * Check if an eraser stroke (line from p1 to p2 with radius) intersects a border path.
 * Returns the indices of the closest segment on the path, or null if no intersection.
 */
export function findEraserIntersection(
  eraserX: number, eraserY: number, eraserRadius: number,
  pathPoints: Array<[number, number]>,
): number | null {
  for (let i = 0; i < pathPoints.length - 1; i++) {
    const dist = pointToSegmentDistance(
      eraserX, eraserY,
      pathPoints[i][0], pathPoints[i][1],
      pathPoints[i + 1][0], pathPoints[i + 1][1],
    );
    if (dist <= eraserRadius) return i;
  }
  return null;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `TEST_REPORT_LOCAL=1 npx vitest run frontend/src/components/admin/svgBorderUtils.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/svgBorderUtils.ts frontend/src/components/admin/svgBorderUtils.test.ts
git commit -m "feat: SVG border utilities — path smoothing, endpoints, rasterization

Catmull-Rom→Bezier path generation, open endpoint detection with
junction filtering, point-to-segment distance, border rasterization
for flood fill, eraser intersection testing."
```

---

### Task 5: Rewrite ClusterPaintEditor with SVG Overlay

**Files:**
- Rewrite: `frontend/src/components/admin/ClusterPaintEditor.tsx`

This is the largest task. The component is rewritten from scratch — Atrament and border canvas removed, SVG overlay added.

- [ ] **Step 1: Write the new component**

The new `ClusterPaintEditor` has:
- Props: `sourceImageUrl`, `originalImageUrl?`, `borderPaths: BorderPath[]`, `overlayImageUrl?`, `initialClusters?`, `onConfirm`, `onCancel`
- State: `tool` ('fill'|'eraser'|'line'), `paths: BorderPath[]` (editable copy), `polyPoints`, `palette`, `activeLabel`, `pcts`, zoom/pan state, `eraserSize`, `fillTolerance`, `borderOpacity`, `bgMode`
- Refs: `colorCanvasRef`, `wrapperRef`
- Layers: background `<img>` → SVG overlay (borders) → color canvas

**Key implementation details:**

The SVG overlay renders all `paths` as `<path>` elements with smoothed `d` attributes. Open endpoints are rendered as `<circle>` markers. The eraser tool checks `findEraserIntersection` on mousedown/mousemove and splits paths. The polyline tool adds points with auto-snap to open endpoints. Fill rasterizes borders via `rasterizeBorderPaths` and runs `floodFillFromSource`.

Due to the component's size (~400 lines), write it as a complete file. Key sections:

- **SVG rendering**: map `paths` to `<path>` elements using `pointsToSmoothSvgPath`, render open endpoints from `findOpenEndpoints` as `<circle>` elements
- **Eraser**: on mousedown+mousemove, find path segments within eraser radius, split the path at those segments (remove the hit segment, create two sub-paths from the remaining points)
- **Polyline**: same click-to-add-vertex logic as current, but auto-snap within 15px of open endpoints. Draw on SVG (not canvas). Enter finishes open, click near first closes.
- **Fill**: create rasterized ImageData from current paths via `rasterizeBorderPaths`, then call `floodFillFromSource(rasterized, colorCanvasData, ...)`, putImageData back to color canvas
- **Undo/redo**: snapshot `{ paths: BorderPath[], colorData: ImageData }`

The full component code should be written directly — it replaces the existing file entirely. Follow the existing MUI styling patterns.

- [ ] **Step 2: Run typecheck**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/ClusterPaintEditor.tsx
git commit -m "feat: rewrite paint editor with SVG border overlay

Replace Atrament + raster border canvas with SVG overlay for vector
border editing. Eraser splits paths and shows open endpoints.
Polyline tool snaps to endpoints. Fill rasterizes borders on-demand.
Three-layer stack: background img → SVG borders → color canvas."
```

---

### Task 6: Remove Atrament + Cleanup

**Files:**
- Modify: `frontend/package.json` — remove atrament
- Delete: `frontend/src/types/atrament.d.ts`
- Modify: `frontend/src/components/admin/clusterPaintUtils.ts` — keep `floodFillFromSource`, `overlayToPixelLabels`, `computeClusterPercentages`, `PaletteEntry`, `PixelData`, color helpers. Remove anything no longer used.
- Modify: `frontend/src/components/admin/clusterPaintUtils.test.ts` — update tests to match remaining functions

- [ ] **Step 1: Remove atrament**

```bash
cd frontend && npm uninstall atrament
```

Delete the type shim:

```bash
rm frontend/src/types/atrament.d.ts
```

- [ ] **Step 2: Run knip to find unused exports**

Run: `npm run knip`
Fix any unused files/exports flagged.

- [ ] **Step 3: Run all checks**

```bash
npm run check
npm run knip
TEST_REPORT_LOCAL=1 npm test
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Atrament dependency and type shim

Atrament replaced by SVG overlay for border editing. No more pixel
brush/eraser. Fill writes to canvas programmatically."
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/tech/cv-auto-match.md`
- Modify: `docs/vision/vision.md`

- [ ] **Step 1: Update tech docs**

In `docs/tech/cv-auto-match.md`, update the "Manual Cluster Editor" section to reflect the vector-based approach:
- Borders extracted as vector paths from `pixelLabels` (chain-tracing + Douglas-Peucker)
- SVG overlay for border rendering and editing
- Eraser splits paths, polyline snaps to open endpoints
- Flood fill via on-demand rasterization of SVG borders

Update the component table to replace `ClusterPaintEditor.tsx` description and add new files (`svgBorderUtils.ts`, `wvImportMatchBorderTrace.ts`).

- [ ] **Step 2: Update vision.md**

Update the manual cluster editor description under admin capabilities to mention vector border editing.

- [ ] **Step 3: Run pre-commit checks**

```bash
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: update manual cluster editor for vector border editing"
```

---

## Post-Implementation Notes

**Testing manually:**
1. Start dev: `npm run dev`
2. Admin → World View Import → pick a region → run CV color match
3. Wait for cluster review → click "Edit manually"
4. Verify: SVG borders visible over the processed image
5. Use eraser: drag across a border → it splits, orange endpoint markers appear
6. Use polyline: click near an endpoint → auto-snaps. Draw through gap → Enter or close.
7. Use fill: click inside a bordered region → fills with cluster color
8. Confirm clusters → pipeline should resume normally

**Known limitations (out of scope):**
- No curved drawing (only polyline with Catmull-Rom smoothing)
- No path merging/joining
- Fill requires borders to form closed-ish regions
- Performance with many paths (>500) may need SVG virtualization — unlikely with typical maps
