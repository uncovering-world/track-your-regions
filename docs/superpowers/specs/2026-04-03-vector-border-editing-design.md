# Vector Border Editing — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Problem:** The raster-based border editing tools (Atrament brush/eraser) don't match the user's mental model. Borders are conceptually lines/curves, but the tools treat them as pixel bands. Erasing 2px of a 5px border leaves 3px behind. Drawn borders don't match the CV pipeline's style or connect to existing borders. The user needs to edit borders as structured paths, not individual pixels.

## Overview

Replace the raster border editing tools with a vector-based SVG overlay. The CV pipeline already knows border locations (neighbor check on `pixelLabels`). Extract these as ordered polyline paths, send them to the frontend, and render them as editable SVG `<path>` elements. Erasing splits paths and highlights open endpoints. The polyline tool snaps to endpoints for clean connections. Flood fill rasterizes the vector borders on-demand to a hidden canvas for boundary detection.

## Design Decisions

- **SVG overlay over Canvas Path2D** — SVG gives native vector rendering, DOM event handling, and element-level interaction. Canvas Path2D would require manual hit testing and redraw. SVG is more natural for a PoC; can reconsider if performance is an issue.
- **Hybrid vector/raster fill** — borders are vector, but flood fill rasterizes them on-demand to a hidden canvas. Fully vector fill (point-in-polygon) would require solving border-paths-to-closed-regions, which is a hard computational geometry problem. Rasterization is simple and proven.
- **Remove Atrament entirely** — no more pixel brush/eraser. All border editing is vector. Fill writes to the color canvas programmatically. Atrament adds complexity with no remaining use case.
- **Pipeline resolution tracing, smooth rendering** — borders traced at TW x TH (~500px) for clean 1px paths. Douglas-Peucker simplification reduces point count. Catmull-Rom smoothing when rendering at display resolution.

## Data Pipeline — Border Extraction

### Backend (`wvImportMatchClusterClean.ts`)

After the existing border pixel detection (lines 554-566), add:

1. **Collect border pixels** — already done: `pixelLabels[p] !== pixelLabels[neighbor]`
2. **Chain-trace** — walk connected border pixels into ordered sequences. Start at an unvisited border pixel, follow connected neighbors (8-connectivity), output ordered `[{x,y}, ...]`. Mark visited to avoid re-tracing.
3. **Classify** — tag each path as `internal` (cluster↔cluster) or `external` (cluster↔background)
4. **Simplify** — Douglas-Peucker with tolerance ~1.5px. Reduces a 200-point raw path to ~20 simplified points.
5. **Include in cluster review event** — add `borderPaths` field to the SSE `cluster_review` event data

### Data Shape

```typescript
interface BorderPath {
  id: string;                       // unique ID for frontend tracking
  points: Array<[number, number]>;  // at TW x TH resolution
  type: 'internal' | 'external';
  clusters: [number, number];       // which two cluster labels this border separates
}
```

Sent alongside existing `clusters` data in the `cluster_review` SSE event. The `clusters` field in the SSE event `data` object gains a sibling `borderPaths: BorderPath[]`.

## Frontend Architecture

### Layer Stack

```
┌─────────────────────────────────┐
│  SVG overlay (vector borders)   │  ← editable paths, endpoint markers, polyline preview
├─────────────────────────────────┤
│  Color canvas (cluster fills)   │  ← flood fill writes here, semi-transparent (55%)
├─────────────────────────────────┤
│  Background <img>               │  ← processed image (toggleable to original)
└─────────────────────────────────┘
```

**Removed from current architecture:**
- Border canvas (replaced by SVG overlay)
- Atrament library (no pixel brush/eraser)
- Source/hidden canvas for flood fill reference (replaced by on-demand rasterization)

**SVG overlay:**
- Absolutely positioned, same size as the image
- `viewBox` set to `0 0 TW TH` (pipeline resolution) — SVG handles scaling
- Each border path is a `<path>` element with Catmull-Rom curve smoothing
- Open endpoint markers are `<circle>` elements (orange with white stroke)
- SVG inherits the zoom transform from the parent container

### Opacity Controls

- **Border opacity slider** — controls SVG overlay opacity (0% = hide borders, 100% = full)
- **Background toggle** — processed / original image switch (same as current)
- Color canvas stays at fixed 55% opacity

## Tools

### Eraser (E) — Freehand drag to cut borders
- Drag across the SVG overlay with adjustable eraser width
- Hit test: check which SVG `<path>` elements intersect the eraser stroke
- Split intersected paths at the intersection points. Remove the erased segment.
- Remaining sub-paths become separate `BorderPath` entries with open endpoints.
- Open endpoints immediately rendered as orange `<circle>` markers.

### Polyline (L) — Draw new borders
- Click to add vertices. SVG `<polyline>` preview follows cursor.
- **Auto-snap (15px):** clicking near an open endpoint snaps to it. Snap target glows on hover.
- Enter = finish open polyline (minimum 2 points). Click near first point = close polygon (minimum 3 points).
- New path added to border data, rendered in CV border style (blue, internal).
- Escape = cancel current polyline.

### Fill (F) — Assign cluster colors
- Click inside a region bounded by borders.
- **Rasterization step:** render all current SVG border paths onto a temporary hidden canvas (full display resolution). Stroke with the border color at appropriate width.
- **Flood fill:** read boundaries from rasterized border canvas + existing fills on color canvas. Same `floodFillFromSource` algorithm.
- Write cluster color to the persistent color canvas.
- Tolerance slider available (default 30).

### Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)
- Each action = one snapshot: `{ borderPaths: BorderPath[], colorCanvasImageData: ImageData }`
- Vector paths are lightweight — much smaller snapshots than dual-canvas ImageData.
- Max 50 snapshots.

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `E` | Eraser tool |
| `L` | Polyline tool |
| `F` | Fill tool |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Enter` | Finish open polyline |
| `Escape` | Cancel polyline / clear selection |
| `[` / `]` | Eraser size |
| `1`-`9` | Select cluster |
| `Space` | Pan mode |

## SVG Rendering

### Border Paths
- Convert simplified points to SVG `<path>` `d` attribute
- Apply Catmull-Rom → cubic Bezier conversion for smooth curves between simplified points
- Internal borders: `stroke="rgb(21,101,192)"`, `stroke-width="3"` (in viewBox units ≈ 3px at TW res)
- External borders: `stroke="rgb(213,47,47)"`, `stroke-width="2"`
- `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"`

### Endpoint Markers
- Shown at open endpoints (path start/end that isn't connected to another path or border junction)
- `<circle>` with `r="4"`, `fill="#ff6600"`, `stroke="white"`, `stroke-width="1.5"`
- When polyline tool is active and cursor is near an endpoint: enlarge to `r="6"` with glow effect
- Junction detection: an endpoint is "open" if no other path endpoint is within 2px of it

### Eraser Visual
- During drag: show a translucent circle following the cursor (eraser size indicator)
- Border paths under the eraser highlight in red to preview what will be cut

## Flood Fill Rasterization

Before each fill, create a temporary canvas at display resolution:
1. Clear to transparent
2. For each border path, convert points from TW/TH to display coords, stroke the path
3. Pass this canvas as `borderData` to `floodFillFromSource`
4. After fill completes, discard the temporary canvas

The `floodFillFromSource` function signature stays the same — it already reads from a `PixelData` source. The only change: the source is rasterized from vectors instead of being the processed image.

## Component Structure

### Modified Files
- `frontend/src/components/admin/ClusterPaintEditor.tsx` — **major rewrite**: remove Atrament, remove border canvas, add SVG overlay, new tool implementations
- `frontend/src/components/admin/clusterPaintUtils.ts` — add `catmullRomToSvgPath()`, `douglasPeucker()`, `rasterizeBorderPaths()` helpers. `floodFillFromSource` stays as-is.
- `frontend/src/components/admin/clusterPaintUtils.test.ts` — tests for Douglas-Peucker, path smoothing, eraser intersection
- `frontend/src/api/adminWvImportCvMatch.ts` — add `BorderPath` type, extend SSE event type
- `frontend/src/components/admin/CvClusterReviewSection.tsx` — pass `borderPaths` prop to editor
- `backend/src/controllers/admin/wvImportMatchClusterClean.ts` — chain-trace borders, simplify, return paths
- `backend/src/controllers/admin/wvImportMatchShared.ts` — include `borderPaths` in SSE event

### New File
- `frontend/src/components/admin/borderTracing.ts` — chain-tracing algorithm (if extracted from backend for shared use, otherwise backend-only)

## Scope Boundaries

**In scope:**
- Border extraction as vector paths (backend)
- SVG overlay for border rendering + editing
- Eraser (split paths on drag)
- Polyline tool with endpoint snapping
- Open endpoint markers
- Flood fill via on-demand rasterization
- Undo/redo with vector snapshots
- Remove Atrament dependency

**Out of scope:**
- Fully vector flood fill (point-in-polygon)
- Curved drawing tool (Bezier handles) — polyline with smoothing is sufficient
- Border path merging/joining (two paths becoming one)
- Per-path color editing (all internal borders stay blue)
- Exporting vector paths back to backend on submit (only color canvas matters)

## Submission Flow

No changes to the backend submission. The frontend sends the color canvas as PNG + palette (same `ManualClusterResponse`). Vector borders are a UI-only editing aid — the pipeline consumes filled pixel labels, not border geometry.
