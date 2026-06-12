# Import Review Workflow Redesign — Plan 3d: Workspace Parity Restoration

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Close the UNINTENDED feature gaps a full legacy-vs-new audit found (audit: 2026-06-12, recorded in this plan's parent conversation; matrix highlights below). Declared Plan-4 descopes stay descoped.

**Wave A (this plan, two tasks):**

### Task A1 — restore the preview/comparison suite in the workspace
Port the legacy preview handler suite from `WorldViewImportReview.tsx:278-421` + dialog props `:812-830` into `importWorkspace/CountryWorkspacePage.tsx` (the `DivisionPreviewDialog` supports every mode already):
- `markerPoints` + `regionName` + parent-map fallback (`regionMapUrl` inherited from nearest ancestor with one, as `WorldViewImportTree.tsx:484-498` computes) plumbed into single-division previews (SuggestionList passes them through).
- `onPreviewUnion` (multi-division union via `getUnionGeometry`) — exposed as a "Preview union" button in SuggestionList when >1 clean suggestion, and used by View map.
- `onPreviewTransfer` — SuggestionList's conflict-accept (↑) goes through the 3-layer transfer preview (donor/moving/target outline via `getTransferPreview`) with Accept Transfer in the dialog, replacing the blind direct call (keep a direct path only as the dialog's confirm).
- `onViewMap` — per-node "View map comparison" button in ActionPanel (assigned-union vs geoshape/region map), legacy `handleViewMap`.
- `onSplitDeeper` + `onVisionMatch` passed to the dialog (legacy `handleSplitDeeper`/`handleVisionMatch`).
- `onAcceptAndRejectRest` passed; Accept hidden when `isAssigned` (legacy `computePreviewDialogHandlers` gating).
Commit `front: Restore preview and comparison suite in workspace.`

### Task A2 — coverage % + row signals + state hygiene + map spec items
- **Coverage %:** reuse the legacy `childrenCoverage` query (`getChildrenCoverage` + the `['admin','wvImport','childrenCoverage',wv]` cache `useTreeMutations.refreshCoverage` already maintains): WorkspaceTree container rows get the color-coded `cover NN%` chip (legacy thresholds from `TreeNodeContent.tsx:194-232`) and geoshape-% chip where present; ChecksBar shows the unit's own % next to the gap count.
- **Row signals:** suggestion rows in SuggestionList show `geoSimilarity` % (color-coded like legacy `TNC:103-109`) alongside the name score; WorkspaceTree rows get the source-page link glyph (`sourceUrl`) and top-suggestion geo-sim badge (legacy `TNR:274-298`); Sync-instances button gets "already in sync" disable using the legacy `syncedUrls` computation (`WorldViewImportTree.tsx:451-481` — port the util).
- **State hygiene:** warning ⚠ chips clickable → `dismissWarningsMutation` (with confirm tooltip); manual-fix flag rendered on rows (red icon + fixNote tooltip) and toggleable off (legacy click-to-clear).
- **Map spec items:** render the unit's reference outline (dashed) from `referenceDivisionIds` (fetch via `getUnionGeometry` or division geometry endpoint — pick the cheaper existing API), and draw `verify.overlaps` divisions with a striped/hatched paint (maplibre `fill-pattern` is heavy — use a distinct color + dashed outline and update the legend).
Commit `front: Restore coverage signals, row indicators, and map overlays.`

**Wave B (queued — fold into Plan 4):** AIReviewDrawer (global + per-subtree AI hierarchy review) migration; multi-select batch accept/reject (+ batch transfer preview); AI-suggest-children APPLY; map-image picker re-plumb; global-gaps resolution; re-match + compute-geometries relocation; gap analysis for non-unit nodes + create-region-from-gap; legacy screen deletion. (Tracked here so the audit's findings aren't lost.)
