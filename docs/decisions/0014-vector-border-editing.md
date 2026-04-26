# ADR-0014: Vector border editing for cluster paint editor

## Status
Accepted — 2026-04-26

## Context
ADR-0013 introduced a manual cluster paint editor that used a raster canvas (via
the Atrament library) for drawing and erasing magenta borders. The raster approach
had two problems:

1. **Atrament dependency**: an extra 30kB library for brush/stroke rendering that
   was only needed for border drawing, not color fill.
2. **Imprecise borders**: magenta raster lines drawn by the user were anti-aliased
   and blurry, making flood fill boundaries inconsistent and harder to control.

The CV pipeline already computes a clean pixel-label map (cluster assignments per
pixel). Running OpenCV `findContours` on each cluster's binary mask produces exact,
clean contour polygons — mathematically precise boundaries that match the cluster
output exactly. Replacing the raster border canvas with an SVG overlay of these
contours eliminates Atrament, improves visual precision, and enables vector-level
border editing (erasing path segments, drawing new polylines with endpoint snapping).

## Decision
Replace the raster border canvas with an SVG vector overlay:

1. **Backend**: Extract border paths from the pixel-label map using OpenCV
   `findContours` per cluster. Apply Douglas-Peucker simplification (tolerance 1.5)
   to reduce point count. Export as `BorderPath[]` (id, points, type, clusters).

2. **Frontend**: Render border paths as `<path>` elements in an SVG overlay
   (Catmull-Rom → cubic Bezier smoothing). Three tools:
   - **Fill** (flood fill): rasterize SVG paths to an off-screen canvas on demand,
     then run the existing magenta-border-aware flood fill algorithm.
   - **Eraser**: drag over SVG paths to split them at the hit segment; no canvas
     needed.
   - **Line** (polyline): click to add vertices, with snapping to open path
     endpoints; press Enter or click near first vertex to close.

3. **Remove Atrament**: the dependency is no longer needed; remove from
   `package.json` and `knip.json`.

## Alternatives considered
- **Keep raster borders + add OpenCV export**: rejected; raster+vector hybrid
  would have two sources of truth for borders. SVG-only is simpler.
- **Chain-tracing algorithm** (custom BFS pixel walk): prototyped but produced
  fragmented paths at junction pixels. OpenCV `findContours` is more reliable
  and already available via the WASM build (ADR loaded).
- **Keep Atrament for brush tool**: rejected; the line tool (polyline with snap)
  is sufficient for user-drawn borders and requires no external library.

## Consequences
- **+** Removes `atrament` dependency entirely.
- **+** Border display is pixel-perfect and matches the cluster output.
- **+** Vector eraser (path splitting) is more precise than raster erasing.
- **+** Endpoint snapping makes it easy to close gaps between paths.
- **−** Flood fill now requires an on-demand rasterization step
  (`rasterizeBorderPaths` in `svgBorderUtils.ts`) before each fill operation.
- **−** `traceBorderPaths` requires OpenCV (`globalThis.__cv`); falls back to
  empty paths if not loaded.

## Implementation
- Backend: `wvImportMatchBorderTrace.ts` — `BorderPath` type, `douglasPeucker()`,
  `traceBorderPaths()` using OpenCV findContours. Tests in
  `wvImportMatchBorderTrace.test.ts` (Douglas-Peucker only; OpenCV untestable
  without WASM in Node).
- Frontend: `svgBorderUtils.ts` — `pointsToSmoothSvgPath()` (Catmull-Rom),
  `findOpenEndpoints()`, `pointToSegmentDistance()`, `rasterizeBorderPaths()`,
  `findEraserIntersection()`. Tests in `svgBorderUtils.test.ts`.
- Frontend: `ClusterPaintEditor.tsx` rewritten — SVG overlay replaces border
  canvas; `borderPaths: BorderPath[]` prop replaces Atrament instance.
- Frontend API: `adminWorldViewImport.ts` — `BorderPath` interface exported so
  both backend and frontend share the same type shape.
