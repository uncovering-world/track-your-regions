# Manual Cluster Editor — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Problem:** CV color clustering (K-means in CIELAB) frequently produces incorrect results — wrong boundaries, wrong cluster count, color confusion — especially on maps with subtle or similar colors (e.g., Iceland with grays/light blues). The current cluster review UI only allows merge/exclude/split/recluster, with no way to manually fix the actual cluster pixel assignments.

## Overview

A canvas-based paint editor that lets the admin manually draw or correct color cluster boundaries on the source map image. Uses **Atrament** (~6kB) for brush, eraser, and flood fill. Integrates into the existing cluster review pipeline step as an alternative mode.

## Design Decisions

- **Atrament over Fabric.js/Konva** — Atrament has brush, eraser, and flood fill built-in at 5.9kB gzipped. Fabric.js (80kB) and Konva (60kB) would require building more painting tools manually. YAGNI.
- **No AI assistance** — Good brush/fill tools are sufficient. Smart fill, edge detection, and AI re-analysis add complexity without proportional value for the typical 2-10 cluster case.
- **Pixel label output** — The editor outputs `pixelLabels: Uint8Array` and `colorCentroids: [R,G,B][]`, the same format the CV pipeline produces. Downstream division matching is completely transparent.

## Two Entry Modes

1. **Fix mode** ("Edit clusters manually") — CV runs first, its cluster overlay is loaded onto the canvas as the starting state. Cluster palette pre-populated from CV results.
2. **Scratch mode** ("Draw from scratch") — Blank canvas over the source image. Empty cluster palette; user adds clusters via color picker.

Both modes are triggered from buttons in the existing `CvClusterReviewSection` toolbar.

## UI Layout

Three-column layout replacing the cluster review panel when paint mode is active:

### Left Toolbar (56px)
- **Tool buttons:** Paint bucket (flood fill), Brush, Eraser — one active at a time
- **Undo / Redo** buttons
- **Brush size slider** (also via `[` / `]` keys)
- **Fill tolerance slider** (0-100) — controls how aggressively flood fill crosses color boundaries on the source image

### Center Canvas (flex)
- **Background layer:** Source map image (non-editable)
- **Overlay layer:** Semi-transparent cluster color paint (Atrament canvas, absolutely positioned over the background `<img>`)
- **Navigation:** Scroll to zoom, Space+drag / middle-click drag to pan
- **Cursor:** Circle showing current brush size

### Right Palette (200px)
- **Cluster list:** Color swatch + percentage for each cluster. Click to select as active painting color.
- **Add cluster** button — opens color picker to create a new cluster
- **Remove cluster** — deletes cluster and clears its pixels from the overlay
- **Overlay opacity slider** — fade overlay to see source image underneath
- **Confirm clusters** button — submits result to pipeline
- **Back to review** button — returns to standard cluster review mode (discards paint edits)

## Tools & Interactions

### Paint Bucket (Primary Tool)
- Click to flood-fill a contiguous area with the active cluster color
- Fill boundary detection uses the **source image** pixel colors (not the overlay), so it naturally stops at region borders on the map
- Tolerance slider controls edge sensitivity (low = strict, high = bleeds through)
- Expected to handle ~80% of the work (one click per region)

### Brush (Secondary)
- Freehand painting for touch-ups where fill leaked or didn't reach far enough
- Adjustable size via slider or `[` / `]` bracket keys
- Paints with active cluster color

### Eraser
- Removes cluster assignment from pixels (transparent = unassigned)
- Same size controls as brush

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `F` | Fill tool |
| `B` | Brush tool |
| `E` | Eraser tool |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `[` / `]` | Decrease / increase brush size |
| `1`-`9` | Quick-select cluster by index |

## Data Flow

### Loading (Fix Mode)
1. Backend renders current `pixelLabels` as a colored PNG (reuses existing cluster highlight endpoint)
2. Frontend loads that PNG onto the Atrament canvas as initial state
3. Palette populated from `ClusterReviewCluster[]` data

### Loading (Scratch Mode)
1. Canvas starts transparent (no overlay)
2. Palette starts empty

### Submitting
1. Frontend reads overlay canvas as `ImageData` via `getImageData()`
2. Maps each pixel's color to a cluster label (by matching to palette colors)
3. Produces `pixelLabels: Uint8Array` + `colorCentroids: [R,G,B][]`
4. Sends to backend via `respondToClusterReview()` with `{ type: 'manual_clusters', pixelLabels, colorCentroids }`

### Backend Changes
- `respondToClusterReview()` gains one new branch: `type === 'manual_clusters'`
- Overwrites `context.pixelLabels` and `context.colorCentroids` with the manual data
- Pipeline resumes at division assignment — completely transparent to downstream code (ICP alignment, division assignment, voting)

## Undo/Redo

Atrament supports stroke recording. Undo is implemented by:
1. Maintaining a history stack of canvas `ImageData` snapshots (taken after each stroke/fill completes)
2. Undo restores the previous snapshot; redo re-applies the next one
3. Max history depth: 50 steps (sufficient; each snapshot is bounded by canvas resolution)

## Component Structure

### New Files
- `frontend/src/components/admin/ClusterPaintEditor.tsx` — main editor component (canvas, toolbar, palette, interactions)
- `frontend/src/components/admin/clusterPaintUtils.ts` — pixel label conversion, color mapping helpers

### Modified Files
- `frontend/src/components/admin/CvClusterReviewSection.tsx` — add "Edit manually" and "Draw from scratch" buttons, conditional rendering of paint editor vs review mode
- `frontend/src/api/adminWvImportCvMatch.ts` — add `ManualClusterResponse` type to the response union
- `backend/src/controllers/admin/wvImportMatchReview.ts` — handle `manual_clusters` response type

## Scope Boundaries

**In scope:**
- Canvas paint editor with fill/brush/eraser
- Two entry modes (fix + scratch)
- Cluster palette management (add/remove/select)
- Overlay opacity control
- Undo/redo
- Integration with existing pipeline via pixelLabels

**Out of scope:**
- AI-assisted fill or edge detection
- Per-cluster naming or region pre-assignment from paint mode (use standard review mode for that)
- Saving/loading paint sessions (one-shot: paint, confirm, done)
- Touch/tablet pressure sensitivity
