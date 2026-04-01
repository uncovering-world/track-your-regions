# Manual Cluster Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canvas-based paint editor so admins can manually draw or correct CV color cluster boundaries when automated K-means clustering fails.

**Architecture:** Atrament library provides brush/eraser on an HTML Canvas overlay. Custom flood fill uses the source map image for boundary detection, painting onto the overlay. The overlay canvas data is converted to `pixelLabels: Uint8Array` (same format the CV pipeline uses) and sent back to the backend, which resumes the existing division-matching pipeline transparently.

**Tech Stack:** Atrament (canvas drawing), sharp (PNG decode on backend), React + MUI (UI), existing CV pipeline infrastructure

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `frontend/src/components/admin/clusterPaintUtils.ts` | Pure utility functions: flood fill, overlay↔pixelLabels conversion, color helpers |
| `frontend/src/components/admin/clusterPaintUtils.test.ts` | Unit tests for all utility functions |
| `frontend/src/components/admin/ClusterPaintEditor.tsx` | Main paint editor component: canvas, toolbar, palette, undo/redo, zoom/pan |

### Modified Files
| File | Changes |
|------|---------|
| `backend/src/controllers/admin/wvImportMatchReview.ts` | Add overlay image storage + retrieval, extend decision type with `ManualClusterDecision` |
| `backend/src/controllers/admin/wvImportMatchShared.ts:399-517` | Generate overlay PNG alongside preview; handle `manual_clusters` decision type |
| `backend/src/routes/adminRoutes.ts:350-404` | Add GET `/cluster-overlay/:reviewId` route; extend POST handler for manual clusters |
| `frontend/src/api/adminWvImportCvMatch.ts:102-233` | Add `ManualClusterResponse` type, `clusterOverlayUrl()`, extend `respondToClusterReview()` |
| `frontend/src/components/admin/CvClusterReviewSection.tsx` | Add "Edit manually" / "Draw from scratch" buttons, conditional rendering of paint editor |

---

### Task 1: Utility Functions with Tests

**Files:**
- Create: `frontend/src/components/admin/clusterPaintUtils.ts`
- Create: `frontend/src/components/admin/clusterPaintUtils.test.ts`

- [ ] **Step 1: Write failing tests for flood fill**

```typescript
// frontend/src/components/admin/clusterPaintUtils.test.ts
import { describe, it, expect } from 'vitest';
import {
  floodFillFromSource, overlayToPixelLabels, hexToRgb, rgbToHex, parseRgbString,
} from './clusterPaintUtils';
import type { PixelData, PaletteEntry } from './clusterPaintUtils';

function createPixelData(w: number, h: number, fill?: [number, number, number, number]): PixelData {
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill) {
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1];
      data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = fill[3];
    }
  }
  return { data, width: w, height: h };
}

function setPixel(pd: PixelData, x: number, y: number, r: number, g: number, b: number, a = 255) {
  const i = (y * pd.width + x) * 4;
  pd.data[i] = r; pd.data[i + 1] = g; pd.data[i + 2] = b; pd.data[i + 3] = a;
}

function getPixel(pd: PixelData, x: number, y: number): [number, number, number, number] {
  const i = (y * pd.width + x) * 4;
  return [pd.data[i], pd.data[i + 1], pd.data[i + 2], pd.data[i + 3]];
}

describe('floodFillFromSource', () => {
  it('fills a uniform region completely', () => {
    const source = createPixelData(4, 4, [255, 255, 255, 255]);
    const overlay = createPixelData(4, 4);
    floodFillFromSource(source, overlay, 0, 0, [255, 0, 0, 180], 0);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        expect(getPixel(overlay, x, y)).toEqual([255, 0, 0, 180]);
  });

  it('stops at color boundaries', () => {
    const source = createPixelData(4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) setPixel(source, x, y, 255, 0, 0);
      for (let x = 2; x < 4; x++) setPixel(source, x, y, 0, 0, 255);
    }
    const overlay = createPixelData(4, 4);
    floodFillFromSource(source, overlay, 0, 0, [0, 255, 0, 180], 0);
    expect(getPixel(overlay, 1, 2)).toEqual([0, 255, 0, 180]);
    expect(getPixel(overlay, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it('respects tolerance to cross subtle boundaries', () => {
    const source = createPixelData(3, 1);
    setPixel(source, 0, 0, 200, 0, 0);
    setPixel(source, 1, 0, 220, 0, 0); // 20 diff in R channel
    setPixel(source, 2, 0, 0, 0, 200); // very different

    // tolerance=0: exact match only — should NOT cross 20-unit boundary
    const ov1 = createPixelData(3, 1);
    floodFillFromSource(source, ov1, 0, 0, [0, 255, 0, 255], 0);
    expect(getPixel(ov1, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(ov1, 1, 0)).toEqual([0, 0, 0, 0]);

    // tolerance=10 (~25.5 threshold): should cross 20-unit boundary
    const ov2 = createPixelData(3, 1);
    floodFillFromSource(source, ov2, 0, 0, [0, 255, 0, 255], 10);
    expect(getPixel(ov2, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(ov2, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it('does nothing for out-of-bounds start', () => {
    const source = createPixelData(4, 4, [255, 255, 255, 255]);
    const overlay = createPixelData(4, 4);
    floodFillFromSource(source, overlay, -1, 0, [255, 0, 0, 180], 0);
    expect(getPixel(overlay, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('overlayToPixelLabels', () => {
  it('maps colors to nearest palette entry', () => {
    const overlay = createPixelData(2, 1);
    setPixel(overlay, 0, 0, 255, 0, 0, 255);
    setPixel(overlay, 1, 0, 0, 0, 255, 255);
    const palette: PaletteEntry[] = [
      { label: 0, color: [255, 0, 0] },
      { label: 1, color: [0, 0, 255] },
    ];
    const { pixelLabels, colorCentroids } = overlayToPixelLabels(overlay, palette);
    expect(pixelLabels[0]).toBe(0);
    expect(pixelLabels[1]).toBe(1);
    expect(colorCentroids[0]).toEqual([255, 0, 0]);
    expect(colorCentroids[1]).toEqual([0, 0, 255]);
  });

  it('treats transparent pixels as background (255)', () => {
    const overlay = createPixelData(2, 1);
    setPixel(overlay, 0, 0, 255, 0, 0, 255);
    const { pixelLabels } = overlayToPixelLabels(overlay, [{ label: 0, color: [255, 0, 0] }]);
    expect(pixelLabels[0]).toBe(0);
    expect(pixelLabels[1]).toBe(255);
  });
});

describe('color helpers', () => {
  it('hexToRgb', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('00ff00')).toEqual([0, 255, 0]);
  });
  it('rgbToHex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
  });
  it('parseRgbString', () => {
    expect(parseRgbString('rgb(255, 0, 0)')).toEqual([255, 0, 0]);
    expect(parseRgbString('rgb(0,128,255)')).toEqual([0, 128, 255]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `TEST_REPORT_LOCAL=1 npx vitest run frontend/src/components/admin/clusterPaintUtils.test.ts`
Expected: FAIL — module `./clusterPaintUtils` does not exist yet.

- [ ] **Step 3: Implement clusterPaintUtils.ts**

```typescript
// frontend/src/components/admin/clusterPaintUtils.ts

/** Minimal ImageData-compatible interface for testability without DOM */
export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PaletteEntry {
  label: number;
  color: [number, number, number]; // RGB
}

/**
 * Flood fill using SOURCE image for boundary detection, painting onto OVERLAY.
 * The fill checks source image colors to find region edges, then paints matching
 * pixels on the overlay with the given fill color. This means fill boundaries
 * follow the original map's color regions regardless of what's already painted.
 */
export function floodFillFromSource(
  source: PixelData,
  overlay: PixelData,
  startX: number,
  startY: number,
  fillColor: [number, number, number, number], // RGBA
  tolerance: number, // 0-100
): void {
  const { width: w, height: h } = source;
  const src = source.data;
  const dst = overlay.data;

  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

  const si0 = (sy * w + sx) * 4;
  const targetR = src[si0];
  const targetG = src[si0 + 1];
  const targetB = src[si0 + 2];

  // tolerance 0-100 → per-channel max difference 0-255
  const threshold = Math.round((tolerance / 100) * 255);

  const visited = new Uint8Array(w * h);
  const stack: number[] = [sx, sy]; // pairs: x, y

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const pi = y * w + x;
    if (visited[pi]) continue;
    visited[pi] = 1;

    const si = pi * 4;
    if (
      Math.abs(src[si] - targetR) > threshold ||
      Math.abs(src[si + 1] - targetG) > threshold ||
      Math.abs(src[si + 2] - targetB) > threshold
    ) continue;

    dst[si] = fillColor[0];
    dst[si + 1] = fillColor[1];
    dst[si + 2] = fillColor[2];
    dst[si + 3] = fillColor[3];

    if (x > 0 && !visited[pi - 1]) stack.push(x - 1, y);
    if (x < w - 1 && !visited[pi + 1]) stack.push(x + 1, y);
    if (y > 0 && !visited[pi - w]) stack.push(x, y - 1);
    if (y < h - 1 && !visited[pi + w]) stack.push(x, y + 1);
  }
}

/** Convert overlay canvas RGBA data → pipeline-compatible pixelLabels + colorCentroids */
export function overlayToPixelLabels(
  overlay: PixelData,
  palette: PaletteEntry[],
): { pixelLabels: Uint8Array; colorCentroids: Array<[number, number, number] | null> } {
  const { width: w, height: h, data } = overlay;
  const pixelLabels = new Uint8Array(w * h);
  pixelLabels.fill(255);

  for (let i = 0; i < w * h; i++) {
    const ri = i * 4;
    if (data[ri + 3] < 128) continue; // transparent = background
    const r = data[ri], g = data[ri + 1], b = data[ri + 2];
    let bestLabel = 255;
    let bestDist = Infinity;
    for (const entry of palette) {
      const dr = r - entry.color[0], dg = g - entry.color[1], db = b - entry.color[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; bestLabel = entry.label; }
    }
    pixelLabels[i] = bestLabel;
  }

  const colorCentroids: Array<[number, number, number] | null> = new Array(32).fill(null);
  for (const { label, color } of palette) colorCentroids[label] = color;
  return { pixelLabels, colorCentroids };
}

/** Compute pixel count percentage for each cluster on the overlay */
export function computeClusterPercentages(
  overlay: PixelData,
  palette: PaletteEntry[],
): Map<number, number> {
  const counts = new Map<number, number>();
  let total = 0;
  const { data, width: w, height: h } = overlay;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) continue;
    total++;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let bestLabel = -1, bestDist = Infinity;
    for (const e of palette) {
      const dr = r - e.color[0], dg = g - e.color[1], db = b - e.color[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; bestLabel = e.label; }
    }
    if (bestLabel >= 0) counts.set(bestLabel, (counts.get(bestLabel) ?? 0) + 1);
  }
  const pcts = new Map<number, number>();
  if (total > 0) {
    for (const [label, count] of counts) pcts.set(label, Math.round(count / total * 1000) / 10);
  }
  return pcts;
}

// ─── Color helpers ───

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

export function parseRgbString(rgb: string): [number, number, number] {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Invalid rgb string: ${rgb}`);
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

/** 15 visually distinct colors for cluster palette */
const DISTINCT_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336',
  '#00BCD4', '#FFEB3B', '#795548', '#E91E63', '#3F51B5',
  '#8BC34A', '#FF5722', '#009688', '#CDDC39', '#673AB7',
];

export function getDistinctColor(index: number): string {
  return DISTINCT_COLORS[index % DISTINCT_COLORS.length];
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `TEST_REPORT_LOCAL=1 npx vitest run frontend/src/components/admin/clusterPaintUtils.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/clusterPaintUtils.ts frontend/src/components/admin/clusterPaintUtils.test.ts
git commit -m "feat: add cluster paint utility functions with tests

Flood fill (source-image-aware), overlay↔pixelLabels conversion,
and color helpers for the manual cluster editor."
```

---

### Task 2: Backend — Overlay Image + Manual Clusters Handler

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchReview.ts:102-153`
- Modify: `backend/src/controllers/admin/wvImportMatchShared.ts:399-517`
- Modify: `backend/src/routes/adminRoutes.ts:350-404`

- [ ] **Step 1: Extend types and storage in wvImportMatchReview.ts**

Add after the `clusterHighlightImages` map (line 122):

```typescript
/** Full cluster overlay image — all clusters in their colors on transparent bg */
const clusterOverlayImages = new Map<string, Buffer>();
```

Add `ManualClusterDecision` type and update `ClusterReviewDecision` to a union. Replace the existing `ClusterReviewDecision` interface (lines 105-114) and `resolveClusterReview` function (lines 147-153):

```typescript
/** Standard cluster review decision — merge, exclude, split, or recluster */
export interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' };
  split?: number[];
}

/** Manual cluster painting — replaces pipeline pixelLabels entirely */
export interface ManualClusterDecision {
  type: 'manual_clusters';
  overlayPng: string; // base64 data URL of RGBA PNG
  palette: Array<{ label: number; color: [number, number, number] }>;
}

export type ClusterReviewResponse = ClusterReviewDecision | ManualClusterDecision;
```

Update `pendingClusterReviews` type (line 117):

```typescript
export const pendingClusterReviews = new Map<string, (decision: ClusterReviewResponse) => void>();
```

Update `resolveClusterReview` to accept the union:

```typescript
export function resolveClusterReview(reviewId: string, decision: ClusterReviewResponse): boolean {
  const resolve = pendingClusterReviews.get(reviewId);
  if (!resolve) return false;
  pendingClusterReviews.delete(reviewId);
  resolve(decision);
  return true;
}
```

Add overlay storage/retrieval functions after `storeClusterHighlights`:

```typescript
/** Store the full cluster overlay image for manual editing */
export function storeClusterOverlay(reviewId: string, png: Buffer): void {
  clusterOverlayImages.set(reviewId, png);
  setTimeout(() => clusterOverlayImages.delete(reviewId), 600000);
}

/** Get a stored cluster overlay image */
export function getClusterOverlayImage(reviewId: string): Buffer | undefined {
  return clusterOverlayImages.get(reviewId);
}
```

- [ ] **Step 2: Generate overlay PNG alongside preview in wvImportMatchShared.ts**

In `matchDivisionsFromClusters`, after the highlight generation loop (after line 428, `storeClusterHighlights(reviewId, highlights)`), add overlay generation:

```typescript
      // Generate full cluster overlay (RGBA, transparent bg, each cluster in its color)
      // Used as starting state when admin enters manual paint mode
      const overlayBuf = Buffer.alloc(tp * 4, 0); // RGBA, all transparent
      for (let i = 0; i < tp; i++) {
        const lbl = pixelLabels[i];
        if (lbl === 255 || !colorCentroids[lbl]) continue;
        const c = colorCentroids[lbl]!;
        overlayBuf[i * 4] = c[0];
        overlayBuf[i * 4 + 1] = c[1];
        overlayBuf[i * 4 + 2] = c[2];
        overlayBuf[i * 4 + 3] = 200; // semi-opaque
      }
      const overlayPng = await sharp(overlayBuf, { raw: { width: TW, height: TH, channels: 4 } })
        .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      storeClusterOverlay(reviewId, overlayPng);
```

Update the import at the top of wvImportMatchShared.ts to include `storeClusterOverlay`:

```typescript
import { ..., storeClusterOverlay } from './wvImportMatchReview';
```

Also update the `ClusterReviewDecision` type reference. The `await new Promise<ClusterReviewDecision>` on line 452 must change to `ClusterReviewResponse`:

```typescript
      const decision = await new Promise<ClusterReviewResponse>((resolve) => {
        pendingClusterReviews.set(reviewId, resolve);
      });
```

The locally-defined `ClusterReviewDecision` interface inside the function (lines 445-450) should be removed — import from `wvImportMatchReview.ts` instead:

```typescript
import { ..., ClusterReviewResponse } from './wvImportMatchReview';
```

- [ ] **Step 3: Handle manual_clusters in the decision processing**

In `matchDivisionsFromClusters`, right after the recluster check (after line 460), add the manual clusters branch:

```typescript
      // Check for manual cluster painting
      if ('type' in decision && decision.type === 'manual_clusters') {
        await logStep('Applying manually painted clusters...');
        const { overlayPng: pngDataUrl, palette: manualPalette } = decision;

        // Decode base64 PNG → raw RGBA pixels
        const base64Data = pngDataUrl.replace(/^data:image\/png;base64,/, '');
        const { data: rawPixels, info: rawInfo } = await sharp(Buffer.from(base64Data, 'base64'))
          .resize(TW, TH, { kernel: 'lanczos3' }) // ensure pipeline resolution
          .raw().ensureAlpha()
          .toBuffer({ resolveWithObject: true });

        // Map overlay colors → cluster labels
        const totalPx = rawInfo.width * rawInfo.height;
        for (let i = 0; i < totalPx; i++) {
          const ri = i * 4;
          if (rawPixels[ri + 3] < 128) { pixelLabels[i] = 255; continue; }
          const r = rawPixels[ri], g = rawPixels[ri + 1], b = rawPixels[ri + 2];
          let bestLabel = 255, bestDist = Infinity;
          for (const entry of manualPalette) {
            const dr = r - entry.color[0], dg = g - entry.color[1], db = b - entry.color[2];
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) { bestDist = dist; bestLabel = entry.label; }
          }
          pixelLabels[i] = bestLabel;
        }

        // Update pipeline centroids and active labels
        for (const entry of manualPalette) {
          colorCentroids[entry.label] = entry.color;
        }
        finalLabels.clear();
        for (const entry of manualPalette) finalLabels.add(entry.label);

        console.log(`  [Manual Clusters] Applied ${manualPalette.length} clusters from manual painting`);
        // Don't loop back — proceed to ICP + assignment
        break;
      }
```

Note: This `break` exits the `while (reviewLoop)` loop, proceeding to ICP alignment and division assignment — same path as the normal merge/exclude flow.

- [ ] **Step 4: Add GET overlay route and extend POST handler in adminRoutes.ts**

Add the overlay GET route after the highlight route (after line 379):

```typescript
// Cluster overlay image (all clusters colored on transparent bg — for manual paint editor)
router.get('/wv-import/cluster-overlay/:reviewId', (req: AuthenticatedRequest, res: Response) => {
  const png = getClusterOverlayImage(String(req.params.reviewId));
  if (!png) {
    res.status(404).json({ error: 'Overlay not found' });
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(png);
});
```

Update the import to include `getClusterOverlayImage`.

Extend the existing POST `/wv-import/cluster-review/:reviewId` handler (lines 382-404) to detect and pass through manual cluster decisions:

```typescript
router.post('/wv-import/cluster-review/:reviewId', (req: AuthenticatedRequest, res: Response) => {
  const reviewId = String(req.params.reviewId);

  // Manual cluster painting — pass through directly
  if (req.body?.type === 'manual_clusters') {
    const overlayPng = req.body.overlayPng;
    const palette = req.body.palette;
    if (typeof overlayPng !== 'string' || !Array.isArray(palette)) {
      res.status(400).json({ error: 'manual_clusters requires overlayPng (string) and palette (array)' });
      return;
    }
    console.log(`  [Cluster Review POST] reviewId=${reviewId} type=manual_clusters palette=${palette.length} colors`);
    const found = resolveClusterReview(reviewId, { type: 'manual_clusters', overlayPng, palette });
    if (found) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'Review not found or expired' });
    }
    return;
  }

  // Standard cluster review — existing logic unchanged
  const merges: Record<number, number> = {};
  // ... rest of existing handler unchanged ...
```

- [ ] **Step 5: Run typecheck**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchReview.ts backend/src/controllers/admin/wvImportMatchShared.ts backend/src/routes/adminRoutes.ts
git commit -m "feat(backend): overlay endpoint + manual_clusters handler

Generate RGBA cluster overlay PNG alongside preview for manual editing.
New GET /cluster-overlay/:reviewId serves it. POST handler accepts
type='manual_clusters' with overlay PNG + palette, decodes to
pixelLabels, and resumes the pipeline."
```

---

### Task 3: Frontend API Types

**Files:**
- Modify: `frontend/src/api/adminWvImportCvMatch.ts:102-233`

- [ ] **Step 1: Add ManualClusterResponse type and clusterOverlayUrl**

After the `ClusterReviewDecision` interface (line 107), add:

```typescript
/** Manual cluster painting response — sent when admin uses the paint editor */
export interface ManualClusterResponse {
  type: 'manual_clusters';
  overlayPng: string; // base64 data URL
  palette: Array<{ label: number; color: [number, number, number] }>;
}
```

After the `clusterHighlightUrl` function (line 224), add:

```typescript
/** URL for cluster overlay image (RGBA, all clusters in their colors on transparent bg) */
export function clusterOverlayUrl(reviewId: string): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/cluster-overlay/${reviewId}`;
  return token ? `${base}?token=${token}` : base;
}
```

Update `respondToClusterReview` (lines 227-233) to accept the union type:

```typescript
/** Respond to cluster review during CV match */
export async function respondToClusterReview(
  reviewId: string,
  decision: ClusterReviewDecision | ManualClusterResponse,
): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/cluster-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/adminWvImportCvMatch.ts
git commit -m "feat(api): add ManualClusterResponse type + overlay URL builder"
```

---

### Task 4: ClusterPaintEditor Component

**Files:**
- Create: `frontend/src/components/admin/ClusterPaintEditor.tsx`
- Run: `cd frontend && npm install atrament`

- [ ] **Step 1: Install atrament**

```bash
cd frontend && npm install atrament
```

Verify the package is added to `frontend/package.json`.

- [ ] **Step 2: Create the component skeleton with types and state**

```typescript
// frontend/src/components/admin/ClusterPaintEditor.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, IconButton, Slider, Tooltip, Button, Typography, Divider,
} from '@mui/material';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import BrushIcon from '@mui/icons-material/Brush';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import Atrament from 'atrament';
import { MODE_DRAW, MODE_ERASE, MODE_DISABLED } from 'atrament';
import {
  floodFillFromSource, overlayToPixelLabels, hexToRgb, rgbToHex,
  parseRgbString, getDistinctColor, computeClusterPercentages,
} from './clusterPaintUtils';
import type { PaletteEntry } from './clusterPaintUtils';
import type { ClusterReviewCluster, ManualClusterResponse } from '../../api/adminWvImportCvMatch';

type Tool = 'fill' | 'brush' | 'eraser';

interface Props {
  /** Processed source image data URL — background layer for painting */
  sourceImageUrl: string;
  /** Cluster overlay image URL — pre-painted clusters for fix mode (omit for scratch) */
  overlayImageUrl?: string;
  /** Existing clusters from CV — used to initialize palette in fix mode */
  initialClusters?: ClusterReviewCluster[];
  /** Called with the manual cluster response data when user confirms */
  onConfirm: (response: ManualClusterResponse) => void;
  /** Called when user cancels and wants to go back to review mode */
  onCancel: () => void;
}

const MAX_HISTORY = 50;

export default function ClusterPaintEditor({
  sourceImageUrl, overlayImageUrl, initialClusters, onConfirm, onCancel,
}: Props) {
  // ─── Refs ───
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null); // hidden, for flood fill
  const atramentRef = useRef<Atrament | null>(null);
  const sourceDataRef = useRef<ImageData | null>(null);

  // ─── State ───
  const [tool, setTool] = useState<Tool>('fill');
  const [brushSize, setBrushSize] = useState(12);
  const [fillTolerance, setFillTolerance] = useState(30);
  const [overlayOpacity, setOverlayOpacity] = useState(55);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<number>(-1);
  const [pcts, setPcts] = useState<Map<number, number>>(new Map());
  const [isPanning, setIsPanning] = useState(false);

  // Undo/redo
  const historyRef = useRef<ImageData[]>([]);
  const historyIdxRef = useRef(-1);

  // ─── Initialize palette from CV clusters (fix mode) or empty (scratch mode) ───
  useEffect(() => {
    if (initialClusters && initialClusters.length > 0) {
      const entries: PaletteEntry[] = initialClusters.map(c => ({
        label: c.label,
        color: parseRgbString(c.color),
      }));
      setPalette(entries);
      setActiveLabel(entries[0].label);
    }
  }, [initialClusters]);

  // ─── Load source image into hidden canvas for flood fill ───
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
      const sc = sourceCanvasRef.current;
      if (!sc) return;
      sc.width = img.naturalWidth;
      sc.height = img.naturalHeight;
      const ctx = sc.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      sourceDataRef.current = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
    };
    img.src = sourceImageUrl;
  }, [sourceImageUrl]);

  // ─── Initialize Atrament on the overlay canvas ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.w === 0) return;
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;

    // Load overlay image if in fix mode
    if (overlayImageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvasSize.w, canvasSize.h);
        saveSnapshot(); // initial state for undo
      };
      img.src = overlayImageUrl;
    } else {
      saveSnapshot(); // blank initial state
    }

    const at = new Atrament(canvas, { color: '#000000' });
    at.weight = brushSize;
    at.smoothing = 0.5;
    at.adaptiveStroke = false;
    at.mode = MODE_DISABLED; // we control mode per tool
    atramentRef.current = at;

    // Save snapshot after each stroke
    at.addEventListener('strokeend', () => saveSnapshot());

    return () => { at.destroy(); atramentRef.current = null; };
  }, [canvasSize.w, canvasSize.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sync tool → Atrament mode ───
  useEffect(() => {
    const at = atramentRef.current;
    if (!at) return;
    if (tool === 'brush') {
      at.mode = MODE_DRAW;
      const entry = palette.find(p => p.label === activeLabel);
      if (entry) at.color = rgbToHex(...entry.color);
    } else if (tool === 'eraser') {
      at.mode = MODE_ERASE;
    } else {
      // fill mode — we handle clicks ourselves
      at.mode = MODE_DISABLED;
    }
    at.weight = brushSize;
  }, [tool, brushSize, activeLabel, palette]);

  // ─── Flood fill click handler ───
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'fill' || activeLabel < 0) return;
    const canvas = canvasRef.current;
    const sourceData = sourceDataRef.current;
    if (!canvas || !sourceData) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    const ctx = canvas.getContext('2d')!;
    const overlayData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const entry = palette.find(p => p.label === activeLabel);
    if (!entry) return;

    floodFillFromSource(
      sourceData, overlayData, x, y,
      [entry.color[0], entry.color[1], entry.color[2], 200],
      fillTolerance,
    );
    ctx.putImageData(overlayData, 0, 0);
    saveSnapshot();
    updatePercentages();
  }, [tool, activeLabel, palette, fillTolerance]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Undo/redo ───
  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Discard redo history
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
    updatePercentages();
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    updatePercentages();
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    updatePercentages();
  }, []);

  const updatePercentages = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || palette.length === 0) return;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setPcts(computeClusterPercentages(data, palette));
  }, [palette]);

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'f' || e.key === 'F') { setTool('fill'); e.preventDefault(); }
      if (e.key === 'b' || e.key === 'B') { setTool('brush'); e.preventDefault(); }
      if (e.key === 'e' || e.key === 'E') { setTool('eraser'); e.preventDefault(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { undo(); e.preventDefault(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) { redo(); e.preventDefault(); }
      if (e.key === 'Z' && (e.ctrlKey || e.metaKey)) { redo(); e.preventDefault(); }
      if (e.key === '[') setBrushSize(s => Math.max(1, s - 2));
      if (e.key === ']') setBrushSize(s => Math.min(100, s + 2));
      if (e.key === ' ') { setIsPanning(true); e.preventDefault(); }
      // 1-9 quick-select cluster
      const n = parseInt(e.key);
      if (n >= 1 && n <= 9 && n <= palette.length) {
        setActiveLabel(palette[n - 1].label);
      }
    };
    const upHandler = (e: KeyboardEvent) => {
      if (e.key === ' ') setIsPanning(false);
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', upHandler);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('keyup', upHandler); };
  }, [palette, undo, redo]);

  // ─── Zoom (scroll wheel on wrapper) ───
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(5, Math.max(0.25, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  // ─── Pan (space+drag) ───
  const panRef = useRef({ startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !wrapperRef.current) return;
    const el = wrapperRef.current;
    panRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
  }, [isPanning]);
  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !wrapperRef.current || e.buttons === 0) return;
    const el = wrapperRef.current;
    el.scrollLeft = panRef.current.scrollLeft - (e.clientX - panRef.current.startX);
    el.scrollTop = panRef.current.scrollTop - (e.clientY - panRef.current.startY);
  }, [isPanning]);

  // ─── Palette management ───
  const addCluster = useCallback(() => {
    const nextLabel = palette.length > 0 ? Math.max(...palette.map(p => p.label)) + 1 : 0;
    const color = hexToRgb(getDistinctColor(nextLabel));
    setPalette(prev => [...prev, { label: nextLabel, color }]);
    setActiveLabel(nextLabel);
  }, [palette]);

  const removeCluster = useCallback((label: number) => {
    // Clear this cluster's pixels from canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const entry = palette.find(p => p.label === label);
      if (entry) {
        for (let i = 0; i < data.data.length; i += 4) {
          const dr = Math.abs(data.data[i] - entry.color[0]);
          const dg = Math.abs(data.data[i + 1] - entry.color[1]);
          const db = Math.abs(data.data[i + 2] - entry.color[2]);
          if (dr < 10 && dg < 10 && db < 10 && data.data[i + 3] > 0) {
            data.data[i + 3] = 0; // make transparent
          }
        }
        ctx.putImageData(data, 0, 0);
        saveSnapshot();
      }
    }
    setPalette(prev => prev.filter(p => p.label !== label));
    if (activeLabel === label) {
      const remaining = palette.filter(p => p.label !== label);
      setActiveLabel(remaining.length > 0 ? remaining[0].label : -1);
    }
  }, [palette, activeLabel, saveSnapshot]);

  // ─── Submit ───
  const handleConfirm = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || palette.length === 0) return;
    const dataUrl = canvas.toDataURL('image/png');
    onConfirm({
      type: 'manual_clusters',
      overlayPng: dataUrl,
      palette: palette.map(p => ({ label: p.label, color: p.color })),
    });
  }, [palette, onConfirm]);

  // ─── Render ───
  const activeEntry = palette.find(p => p.label === activeLabel);

  return (
    <Box sx={{ display: 'flex', height: '70vh', border: '2px solid', borderColor: 'info.main', borderRadius: 1, overflow: 'hidden' }}>
      {/* ═══ Left toolbar ═══ */}
      <Box sx={{ width: 56, bgcolor: 'grey.100', display: 'flex', flexDirection: 'column', alignItems: 'center', p: 1, gap: 0.5, borderRight: 1, borderColor: 'divider' }}>
        <Tooltip title="Paint bucket (F)" placement="right">
          <IconButton size="small" color={tool === 'fill' ? 'primary' : 'default'} onClick={() => setTool('fill')}>
            <FormatPaintIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Brush (B)" placement="right">
          <IconButton size="small" color={tool === 'brush' ? 'primary' : 'default'} onClick={() => setTool('brush')}>
            <BrushIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Eraser (E)" placement="right">
          <IconButton size="small" color={tool === 'eraser' ? 'primary' : 'default'} onClick={() => setTool('eraser')}>
            <AutoFixOffIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Divider flexItem sx={{ my: 0.5 }} />
        <Tooltip title="Undo (Ctrl+Z)" placement="right">
          <IconButton size="small" onClick={undo}><UndoIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Redo (Ctrl+Shift+Z)" placement="right">
          <IconButton size="small" onClick={redo}><RedoIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Divider flexItem sx={{ my: 0.5 }} />
        <Typography variant="caption" color="text.secondary">Size</Typography>
        <Slider
          orientation="vertical" size="small"
          min={1} max={60} value={brushSize}
          onChange={(_, v) => setBrushSize(v as number)}
          sx={{ height: 80 }}
        />
        <Typography variant="caption">{brushSize}px</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">Fill tol.</Typography>
        <Slider
          orientation="vertical" size="small"
          min={0} max={100} value={fillTolerance}
          onChange={(_, v) => setFillTolerance(v as number)}
          sx={{ height: 60 }}
        />
        <Typography variant="caption">{fillTolerance}</Typography>
      </Box>

      {/* ═══ Center canvas ═══ */}
      <Box
        ref={wrapperRef}
        onWheel={handleWheel}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        sx={{
          flex: 1, overflow: 'auto', position: 'relative', bgcolor: '#1a1a2e',
          cursor: isPanning ? 'grab' : tool === 'fill' ? 'crosshair' : 'default',
        }}
      >
        <Box sx={{ transform: `scale(${zoom})`, transformOrigin: '0 0', position: 'relative', width: canvasSize.w, height: canvasSize.h }}>
          {/* Background: source map image */}
          {sourceImageUrl && (
            <img
              src={sourceImageUrl}
              alt="Source map"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            />
          )}
          {/* Overlay: Atrament canvas */}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              opacity: overlayOpacity / 100,
              cursor: isPanning ? 'grab' : tool === 'fill' ? 'crosshair' : undefined,
            }}
          />
          {/* Hidden canvas for source image data */}
          <canvas ref={sourceCanvasRef} style={{ display: 'none' }} />
        </Box>
        {/* Zoom indicator */}
        <Typography
          variant="caption"
          sx={{ position: 'absolute', bottom: 8, right: 8, bgcolor: 'rgba(0,0,0,0.6)', color: '#ccc', px: 1, borderRadius: 1 }}
        >
          {Math.round(zoom * 100)}% — scroll to zoom, Space+drag to pan
        </Typography>
      </Box>

      {/* ═══ Right palette ═══ */}
      <Box sx={{ width: 200, bgcolor: 'grey.50', borderLeft: 1, borderColor: 'divider', p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, overflowY: 'auto' }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
          Clusters
        </Typography>
        {palette.map((entry, idx) => (
          <Box
            key={entry.label}
            onClick={() => setActiveLabel(entry.label)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, p: 0.75, borderRadius: 1, cursor: 'pointer',
              border: '2px solid', borderColor: entry.label === activeLabel ? 'primary.main' : 'transparent',
              bgcolor: entry.label === activeLabel ? 'primary.50' : 'transparent',
              '&:hover': { bgcolor: 'grey.200' },
            }}
          >
            <Box sx={{
              width: 24, height: 24, borderRadius: 0.5, flexShrink: 0,
              bgcolor: rgbToHex(...entry.color),
              border: entry.label === activeLabel ? '2px solid white' : undefined,
              boxShadow: entry.label === activeLabel ? '0 0 0 1px rgba(0,0,0,0.3)' : undefined,
            }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>Cluster {idx + 1}</Typography>
              <Typography variant="caption" color="text.secondary">
                {pcts.get(entry.label)?.toFixed(1) ?? '0.0'}%
              </Typography>
            </Box>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeCluster(entry.label); }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button
          size="small" variant="outlined" startIcon={<AddIcon />}
          onClick={addCluster} sx={{ mt: 0.5 }}
        >
          Add cluster
        </Button>

        <Box sx={{ flex: 1 }} />

        {/* Overlay opacity */}
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">Overlay opacity</Typography>
          <Slider
            size="small" min={0} max={100} value={overlayOpacity}
            onChange={(_, v) => setOverlayOpacity(v as number)}
          />
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button
            variant="contained" color="info" size="small"
            disabled={palette.length === 0}
            onClick={handleConfirm}
          >
            Confirm clusters
          </Button>
          <Button variant="outlined" size="small" color="inherit" onClick={onCancel}>
            Back to review
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run check`
Expected: No type errors. Verify Atrament imports resolve correctly. If Atrament lacks type declarations, create a minimal type shim at `frontend/src/types/atrament.d.ts`:

```typescript
declare module 'atrament' {
  export default class Atrament {
    constructor(canvas: HTMLCanvasElement, options?: Record<string, unknown>);
    color: string;
    weight: number;
    smoothing: number;
    adaptiveStroke: boolean;
    mode: string;
    destroy(): void;
    clear(): void;
    addEventListener(event: string, handler: (...args: unknown[]) => void): void;
    removeEventListener(event: string, handler: (...args: unknown[]) => void): void;
  }
  export const MODE_DRAW: string;
  export const MODE_ERASE: string;
  export const MODE_FILL: string;
  export const MODE_DISABLED: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/ClusterPaintEditor.tsx frontend/package.json frontend/package-lock.json
# Also add type shim if created:
# git add frontend/src/types/atrament.d.ts
git commit -m "feat: add ClusterPaintEditor component

Canvas-based paint editor using Atrament for brush/eraser and custom
flood fill for source-image-aware region filling. Three-column layout
with toolbar, canvas, and cluster palette."
```

---

### Task 5: Wire Into CvClusterReviewSection

**Files:**
- Modify: `frontend/src/components/admin/CvClusterReviewSection.tsx`

- [ ] **Step 1: Add paint mode state and entry buttons**

At the top of the component (after line 34, `const sorted = ...`), add state:

```typescript
  const [paintMode, setPaintMode] = useState<'off' | 'fix' | 'scratch'>('off');
```

Add the import for `ClusterPaintEditor` and `clusterOverlayUrl`:

```typescript
import ClusterPaintEditor from './ClusterPaintEditor';
import { clusterOverlayUrl, respondToClusterReview } from '../../api/adminWvImportCvMatch';
```

- [ ] **Step 2: Add conditional rendering**

Wrap the existing return JSX in a condition. Before the existing `return (` (line 65):

```typescript
  if (paintMode !== 'off') {
    return (
      <ClusterPaintEditor
        sourceImageUrl={sourceImg?.dataUrl ?? ''}
        overlayImageUrl={paintMode === 'fix' ? clusterOverlayUrl(cr.reviewId) : undefined}
        initialClusters={paintMode === 'fix' ? cr.clusters : undefined}
        onConfirm={async (response) => {
          setCVMatchDialog(prev => prev ? {
            ...prev,
            clusterReview: undefined,
            savedRegionAssignments: cr.regionAssignments.size > 0 ? new Map(cr.regionAssignments) : undefined,
            progressText: 'Applying manually painted clusters...',
          } : prev);
          try {
            await respondToClusterReview(cr.reviewId, response);
          } catch (e) {
            console.error('[Manual Clusters] POST failed:', e);
          }
        }}
        onCancel={() => setPaintMode('off')}
      />
    );
  }
```

- [ ] **Step 3: Add entry buttons in the toolbar**

After the "Confirm clusters" button (after line 252), before the split/recluster buttons `Box`:

```typescript
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
        <Button
          size="small" variant="outlined" color="secondary"
          startIcon={<BrushIcon />}
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
          onClick={() => setPaintMode('fix')}
        >
          Edit manually
        </Button>
        <Button
          size="small" variant="outlined" color="secondary"
          startIcon={<FormatPaintIcon />}
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
          onClick={() => setPaintMode('scratch')}
        >
          Draw from scratch
        </Button>
      </Box>
```

Add the needed icon imports at the top of the file:

```typescript
import BrushIcon from '@mui/icons-material/Brush';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
```

- [ ] **Step 4: Run typecheck + lint**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/CvClusterReviewSection.tsx
git commit -m "feat: wire manual paint editor into cluster review UI

Add 'Edit manually' (fix mode) and 'Draw from scratch' buttons to
CvClusterReviewSection. Paint editor replaces the review panel when
active, submits manual_clusters response on confirm."
```

---

### Task 6: Pre-commit Checks + Documentation

**Files:**
- Modify: `docs/tech/cv-auto-match.md` (or create if missing)
- Modify: `docs/vision/vision.md`

- [ ] **Step 1: Run all pre-commit checks**

```bash
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

Fix any issues found. Common things to watch for:
- Unused imports from refactoring
- Knip flagging Atrament type shim if unused elsewhere
- Test failures in existing tests (ensure no regressions)

- [ ] **Step 2: Update technical documentation**

Add a section to `docs/tech/cv-auto-match.md` (or create it if it doesn't exist). Key content:

- Manual cluster editor: when CV clustering fails, admin can manually paint cluster regions
- Two modes: fix (starts from CV output) and scratch (blank canvas)
- Tools: flood fill (primary, source-image-aware), brush, eraser
- Data flow: canvas overlay → PNG → backend decodes → pixelLabels → resume pipeline
- Library: Atrament (~6kB) for brush/eraser; custom flood fill reads source image for boundary detection

- [ ] **Step 3: Update vision.md**

Add under the Admin capabilities section:

- Manual cluster editor for correcting CV color clustering results
- Canvas-based paint tools (flood fill, brush, eraser) with undo/redo
- Available as fallback when automated clustering produces incorrect region boundaries

- [ ] **Step 4: Run `/security-check`**

Run the security check on all changed files.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/
git commit -m "docs: add manual cluster editor to tech docs and vision"
```

---

## Post-Implementation Notes

**Testing the feature manually:**
1. Start the dev environment: `npm run dev`
2. Navigate to Admin → World View Import → pick a region with a map image
3. Run CV color match — wait for cluster review step
4. Click "Edit manually" to enter fix mode (CV clusters pre-loaded) or "Draw from scratch"
5. Use flood fill to paint regions, brush for touch-ups
6. Click "Confirm clusters" — pipeline should resume with your manual clusters
7. Verify division assignment produces correct results downstream

**Known limitations:**
- No pressure sensitivity (Atrament supports it but we disabled `adaptiveStroke`)
- No session save/restore — if you navigate away, painting is lost
- Fill tolerance operates on per-channel max difference, which may not match intuition for all color spaces
