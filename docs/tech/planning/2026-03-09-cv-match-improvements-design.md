# CV Match Dialog Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix false water detection in CV color match, keep dismissed divisions visible on the map, and add color-swatch neighbor assignment.

**Architecture:** Backend adds raw-color fallback for water-masked divisions with interactive "water or region?" crops. Frontend changes `CvMatchMap` to support dismissed state (dimmed on map), color-only neighbor buttons for all divisions, and a water-question prompt.

**Tech Stack:** TypeScript, Express (backend), React + MUI + MapLibre GL (frontend), sharp + opencv4nodejs-prebuilt (image processing)

---

### Task 1: Backend — Raw-color fallback for water-masked divisions

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:2763-2791` (vote counting fallback)

**Step 1: Add raw-color fallback after vote counting**

After the existing vote-counting loop (line 2763), when a division has 0 votes (all pixels water-masked), sample raw image colors from the division's flood-filled pixels and find the nearest `colorCentroid`. Currently the fallback at line 2766-2775 checks `pixelLabels` which is 255 for water pixels.

Replace the fallback block (lines 2766-2775):

```typescript
if (!votes || votes.size === 0) {
  // Fallback: sample raw image colors from flood-filled area (handles water-masked divisions)
  // GADM divisions are land by definition — if masked as water, sample real colors
  const rawVotes = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (divisionMap[i] !== ci) continue;
    // Find nearest colorCentroid from raw image color
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    let bestDist = Infinity, bestK = 0;
    for (let k = 0; k < colorCentroids.length; k++) {
      const d = (r - colorCentroids[k][0]) ** 2 + (g - colorCentroids[k][1]) ** 2 + (b - colorCentroids[k][2]) ** 2;
      if (d < bestDist) { bestDist = d; bestK = k; }
    }
    rawVotes.set(bestK, (rawVotes.get(bestK) || 0) + 1);
  }
  if (rawVotes.size > 0) {
    const total = [...rawVotes.values()].reduce((a, b) => a + b, 0);
    const sorted = [...rawVotes.entries()].sort((a, b) => b[1] - a[1]);
    const [dominantCluster, dominantCount] = sorted[0];
    const confidence = Math.round((dominantCount / total) * 100) / 100;
    const isSplit = confidence < 0.9 && sorted.length > 1;
    if (isSplit) splitDivisionIds.push(div.id);
    divAssignments.push({
      divisionId: div.id, clusterId: dominantCluster,
      confidence: Math.min(confidence, 0.4), // cap at 0.4 — uncertain due to water mask
      isSplit,
      splitClusters: isSplit
        ? sorted.filter(([, c]) => c / total > 0.1).map(([cl, c]) => ({ clusterId: cl, share: Math.round((c / total) * 100) / 100 }))
        : undefined,
    });
  } else {
    // Truly empty (no flood-fill pixels at all) — centroid sample
    const [px, py] = gadmToPixel(div.cx, -div.cy);
    const ix = Math.round(px), iy = Math.round(py);
    let label = -1;
    if (ix >= 0 && ix < TW && iy >= 0 && iy < TH) {
      let bestDist = Infinity;
      const r = buf[iy * TW * 3 + ix * 3], g = buf[iy * TW * 3 + ix * 3 + 1], b2 = buf[iy * TW * 3 + ix * 3 + 2];
      for (let k = 0; k < colorCentroids.length; k++) {
        const d = (r - colorCentroids[k][0]) ** 2 + (g - colorCentroids[k][1]) ** 2 + (b2 - colorCentroids[k][2]) ** 2;
        if (d < bestDist) { bestDist = d; label = k; }
      }
    }
    divAssignments.push({ divisionId: div.id, clusterId: label, confidence: label >= 0 ? 0.3 : 0, isSplit: false });
  }
  continue;
}
```

**Step 2: Track water-masked division IDs**

Add a `Set<number>` to track which divisions were water-masked, right after the `divAssignments` array declaration (line 2760):

```typescript
const waterMaskedDivIds = new Set<number>();
```

In the new fallback code above, when we enter the `if (!votes || votes.size === 0)` block, add:

```typescript
waterMaskedDivIds.add(div.id);
```

**Step 3: Commit**

```
feat: raw-color fallback for water-masked GADM divisions in CV match
```

---

### Task 2: Backend — Generate crop images for water-masked divisions

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:3350-3411` (geo preview builder)

**Step 1: Generate crop for each water-masked division**

After the geo preview feature building loop (around line 3398), generate a small crop from the source map for each water-masked division. Add to the feature properties.

Inside the geo preview builder block (the one starting at line 3352 with `const divClusterMap`), after building features, add:

```typescript
// Generate crop images for water-masked divisions
for (const feature of features) {
  const divId = feature.properties!.divisionId as number;
  if (!waterMaskedDivIds.has(divId)) continue;
  feature.properties!.wasWaterMasked = true;
  // Generate crop from source map around division bbox
  try {
    const geom = feature.geometry;
    const bbox = turf.bbox(geom);
    // Convert geo bbox to pixel coords
    const [pxMin, pyMin] = gadmToPixel(bbox[0], -bbox[3]); // top-left
    const [pxMax, pyMax] = gadmToPixel(bbox[2], -bbox[1]); // bottom-right
    const cropX = Math.max(0, Math.floor(Math.min(pxMin, pxMax)) - 10);
    const cropY = Math.max(0, Math.floor(Math.min(pyMin, pyMax)) - 10);
    const cropW = Math.min(TW - cropX, Math.ceil(Math.abs(pxMax - pxMin)) + 20);
    const cropH = Math.min(TH - cropY, Math.ceil(Math.abs(pyMax - pyMin)) + 20);
    if (cropW > 5 && cropH > 5) {
      // Extract crop from inpainted buffer (pre-bilateral, shows original colors)
      const cropBuf = Buffer.alloc(cropW * cropH * 3);
      for (let y = 0; y < cropH; y++) {
        const srcOffset = ((cropY + y) * TW + cropX) * 3;
        const dstOffset = y * cropW * 3;
        inpaintedBuf.copy(cropBuf, dstOffset, srcOffset, srcOffset + cropW * 3);
      }
      const cropPng = await sharp(cropBuf, { raw: { width: cropW, height: cropH, channels: 3 } })
        .resize(Math.min(200, cropW * 2), undefined, { kernel: 'lanczos3' })
        .png().toBuffer();
      feature.properties!.waterCropDataUrl = `data:image/png;base64,${cropPng.toString('base64')}`;
    }
  } catch { /* skip crop generation errors */ }
}
```

Note: `inpaintedBuf` is declared at line 1677 and needs to remain in scope. Check that it's accessible at this point — it's inside the same `try` block, so it should be fine.

**Step 2: Also mark in feature properties for non-geo-preview divisions**

The `wasWaterMasked` flag is already set in the feature properties above. The frontend will use this to show the water question prompt.

**Step 3: Commit**

```
feat: generate crop images for water-masked divisions in CV match
```

---

### Task 3: Frontend — Update API types for water-masked divisions

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts:819-858`

**Step 1: No type changes needed for GeoJSON properties**

The `wasWaterMasked` and `waterCropDataUrl` are GeoJSON feature properties (dynamic), so no interface changes needed. The `ColorMatchCluster` and `ClusterGeoInfo` types remain the same.

Skip this task — properties are accessed via `feature.properties?.wasWaterMasked`.

---

### Task 4: Frontend — Dismiss keeps division on map (dimmed)

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx:1756-1776` (onReject handler)
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx:210-220` (fill opacity expression)

**Step 1: Change `onReject` to mark as dismissed instead of removing**

Replace the `onReject` handler (lines 1756-1776):

```typescript
onReject={(divisionId) => {
  // Mark division as dismissed — keep on map but dimmed
  setCVMatchDialog(prev => {
    if (!prev) return prev;
    const newClusters = prev.clusters.map(c => ({
      ...c,
      divisions: c.divisions.filter(d => d.id !== divisionId),
      unsplittable: c.unsplittable.filter(d => d.id !== divisionId),
    })).filter(c => c.divisions.length > 0 || c.unsplittable.length > 0);
    const newGeo = prev.geoPreview ? {
      ...prev.geoPreview,
      featureCollection: {
        ...prev.geoPreview.featureCollection,
        features: prev.geoPreview.featureCollection.features.map(f =>
          f.properties?.divisionId === divisionId
            ? { ...f, properties: { ...f.properties, dismissed: true, color: '#999' } }
            : f
        ),
      },
    } : prev.geoPreview;
    return { ...prev, clusters: newClusters, geoPreview: newGeo };
  });
}}
```

**Step 2: Add dim styling for dismissed divisions in `CvMatchMap`**

In the fill-opacity paint expression (lines 214-220), add a case for dismissed:

```typescript
'fill-opacity': ['case',
  ['==', ['get', 'divisionId'], selectedId ?? -999], 0.7,
  ['==', ['get', 'dismissed'], true], 0.15,
  ['==', ['get', 'accepted'], true], 0.55,
  ['==', ['get', 'clusterId'], -1], 0.1,
  ['==', ['get', 'isUnsplittable'], true], 0.25,
  0.4,
],
```

Also add dashed outline for dismissed in the line layer (around line 227):

```typescript
'line-color': ['case',
  ['==', ['get', 'divisionId'], selectedId ?? -999], '#1565c0',
  ['==', ['get', 'dismissed'], true], '#999',
  '#333',
],
'line-width': ['case',
  ['==', ['get', 'divisionId'], selectedId ?? -999], 3,
  ['==', ['get', 'dismissed'], true], 0.5,
  ['==', ['get', 'isUnsplittable'], true], 1.5,
  0.8,
],
```

**Step 3: Update hover tooltip for dismissed divisions**

In the hover tooltip (line 277-281), add dismissed case:

```typescript
{hoveredFeature.dismissed ? 'Dismissed' :
 hoveredFeature.wasWaterMasked ? 'Possibly water — click to decide' :
 hoveredFeature.isUnsplittable ? 'Unsplittable — spans multiple regions' :
 hoveredFeature.clusterId === -1 ? 'Unassigned' :
 `${hoveredFeature.regionName ?? 'Unmatched cluster'} — ${Math.round((hoveredFeature.confidence ?? 0) * 100)}% confidence`}
```

**Step 4: Commit**

```
feat: dismissed divisions stay visible on CV match map (dimmed)
```

---

### Task 5: Frontend — Color-only neighbor swatches for all divisions

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx:285-407` (CvMatchMap action panel)

**Step 1: Show neighbor swatches for ALL selected divisions (not just unassigned)**

Change the `needsManualAssign` condition (line 287) to compute neighbors for all divisions, and always show the neighbor section. The existing neighbor-finding logic (lines 289-327) stays the same but runs unconditionally.

Replace lines 287-328:

```typescript
const isDismissed = !!selectedFeature.dismissed;
const isWaterQuestion = !!selectedFeature.wasWaterMasked && !isDismissed;
const needsManualAssign = isDismissed || selectedFeature.isUnsplittable || selectedFeature.clusterId === -1 || selectedFeature.regionId == null;

// Find neighboring regions for ALL divisions (used for reassignment)
let neighborRegions: Array<{ regionId: number; regionName: string; color: string }> = [];
if (onAccept) {
  const selFeature = geoPreview.featureCollection.features.find(
    f => f.properties?.divisionId === selectedFeature.divisionId
  );
  if (selFeature) {
    try {
      const selBbox = turf.bbox(selFeature);
      const pad = Math.max(selBbox[2] - selBbox[0], selBbox[3] - selBbox[1]) * 0.05;
      const expandedBbox = [selBbox[0] - pad, selBbox[1] - pad, selBbox[2] + pad, selBbox[3] + pad];
      const seen = new Set<number>();
      for (const f of geoPreview.featureCollection.features) {
        const rid = f.properties?.regionId as number | null;
        if (!rid || seen.has(rid)) continue;
        if (f.properties?.divisionId === selectedFeature.divisionId) continue;
        if (f.properties?.dismissed) continue;
        const fb = turf.bbox(f);
        if (fb[2] < expandedBbox[0] || fb[0] > expandedBbox[2] || fb[3] < expandedBbox[1] || fb[1] > expandedBbox[3]) continue;
        try {
          if (turf.booleanIntersects(selFeature, f)) {
            seen.add(rid);
            neighborRegions.push({
              regionId: rid,
              regionName: f.properties?.regionName ?? `Region ${rid}`,
              color: f.properties?.color ?? '#999',
            });
          }
        } catch { /* skip invalid geom */ }
      }
    } catch { /* skip */ }
  }
  if (neighborRegions.length === 0) {
    neighborRegions = geoPreview.clusterInfos
      .filter(c => c.regionId != null && c.regionName)
      .map(c => ({ regionId: c.regionId!, regionName: c.regionName!, color: c.color }));
  }
}
```

**Step 2: Replace neighbor buttons with color-only circles**

Replace the neighbor region buttons (lines 379-402):

```typescript
{neighborRegions.length > 0 && onAccept && (
  <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
      {isDismissed ? 'Reassign to:' : needsManualAssign ? 'Assign to:' : 'Reassign to:'}
    </Typography>
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {neighborRegions.map(r => (
        <Box
          key={r.regionId}
          onClick={() => {
            onAccept!(selectedFeature.divisionId, r.regionId, r.regionName);
            setSelectedId(null);
          }}
          title={r.regionName}
          sx={{
            width: 28, height: 28,
            bgcolor: r.color,
            borderRadius: '4px',
            border: '2px solid rgba(0,0,0,0.2)',
            cursor: 'pointer',
            transition: 'transform 0.1s, box-shadow 0.1s',
            '&:hover': {
              transform: 'scale(1.2)',
              boxShadow: `0 0 0 2px ${r.color}`,
              border: '2px solid rgba(0,0,0,0.5)',
            },
          }}
        />
      ))}
    </Box>
  </Box>
)}
```

**Step 3: Always show the neighbor section (remove `needsManualAssign` gate)**

The old code had `{needsManualAssign && neighborRegions.length > 0 && onAccept && ...}`. The new code above uses `{neighborRegions.length > 0 && onAccept && ...}` — neighbors shown for all divisions.

**Step 4: Commit**

```
feat: color-only neighbor swatches for all divisions in CV match map
```

---

### Task 6: Frontend — Water question prompt for water-masked divisions

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx:330-406` (CvMatchMap action panel)

**Step 1: Add water question UI in action panel**

In the selected division action panel (after the name/status line, before the Accept/Dismiss buttons), add a water question section when `isWaterQuestion` is true:

```typescript
{isWaterQuestion && selectedFeature.waterCropDataUrl && (
  <Box sx={{ my: 1, p: 1, bgcolor: 'info.50', borderRadius: 1, border: '1px solid', borderColor: 'info.200' }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>
      Detected as water — is this correct?
    </Typography>
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
      <img
        src={selectedFeature.waterCropDataUrl}
        style={{ maxWidth: 120, maxHeight: 80, borderRadius: 4, border: '1px solid #ccc' }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Button
          size="small" variant="outlined" color="info"
          onClick={() => {
            // Mark as water → dismiss
            onReject?.(selectedFeature.divisionId);
            setSelectedId(null);
          }}
        >
          Yes, water
        </Button>
        <Button
          size="small" variant="contained" color="success"
          onClick={() => {
            // Mark as region → clear water flag, keep on map for assignment
            // Update the feature to remove water flag
            // The user will then use neighbor color swatches to assign
          }}
        >
          No, it's a region
        </Button>
      </Box>
    </Box>
  </Box>
)}
```

**Step 2: Handle "No, it's a region" click**

The "No, it's a region" button needs to clear the `wasWaterMasked` flag on the feature so the division shows as a normal unassigned division. This requires an `onClearWaterFlag` callback from the parent. However, since `CvMatchMap` doesn't have direct access to `setCVMatchDialog`, we need to add a callback prop.

Add `onClearWaterFlag` to `CvMatchMap` props:

```typescript
function CvMatchMap({ geoPreview, onAccept, onReject, onClearWaterFlag }: {
  geoPreview: { featureCollection: GeoJSON.FeatureCollection; clusterInfos: ClusterGeoInfo[] };
  onAccept?: (divisionId: number, regionId: number, regionName: string) => void;
  onReject?: (divisionId: number) => void;
  onClearWaterFlag?: (divisionId: number) => void;
}) {
```

Then in the "No, it's a region" onClick:

```typescript
onClick={() => {
  onClearWaterFlag?.(selectedFeature.divisionId);
}}
```

**Step 3: Pass `onClearWaterFlag` from the dialog**

In the dialog where `CvMatchMap` is used (around line 1722), add the prop:

```typescript
<CvMatchMap
  geoPreview={geo}
  onAccept={async (divisionId, regionId, regionName) => { /* existing */ }}
  onReject={(divisionId) => { /* existing dismiss logic */ }}
  onClearWaterFlag={(divisionId) => {
    setCVMatchDialog(prev => {
      if (!prev?.geoPreview) return prev;
      return {
        ...prev,
        geoPreview: {
          ...prev.geoPreview,
          featureCollection: {
            ...prev.geoPreview.featureCollection,
            features: prev.geoPreview.featureCollection.features.map(f =>
              f.properties?.divisionId === divisionId
                ? { ...f, properties: { ...f.properties, wasWaterMasked: false } }
                : f
            ),
          },
        },
      };
    });
  }}
/>
```

**Step 4: Add blue tint for water-masked divisions on the map**

In the fill-opacity expression, add a case for water-masked (before the dismissed case):

```typescript
'fill-opacity': ['case',
  ['==', ['get', 'divisionId'], selectedId ?? -999], 0.7,
  ['==', ['get', 'wasWaterMasked'], true], 0.3,
  ['==', ['get', 'dismissed'], true], 0.15,
  ['==', ['get', 'accepted'], true], 0.55,
  ['==', ['get', 'clusterId'], -1], 0.1,
  ['==', ['get', 'isUnsplittable'], true], 0.25,
  0.4,
],
```

And give water-masked divisions a blue-ish tint via the fill-color:

```typescript
const fillColorExpr: any = ['case',
  ['==', ['get', 'wasWaterMasked'], true], '#4fc3f7',
  ['get', 'color'],
];
```

**Step 5: Commit**

```
feat: water-or-region prompt for water-masked divisions in CV match
```

---

### Task 7: Pre-commit checks

**Step 1:** Run `npm run check` (lint + typecheck)
**Step 2:** Run `npm run knip` (unused files + dependencies)
**Step 3:** Run `npm run security:all` (Semgrep SAST + npm audit)
**Step 4:** Run `TEST_REPORT_LOCAL=1 npm test` (unit tests)
**Step 5:** Run `/security-check` (Claude Code security review)

---

### Task 8: Final commit with all changes

Commit message:
```
feat: CV match improvements — water detection fix, dismiss-on-map, color swatches

- Backend: raw-color fallback for water-masked divisions (fixes Tanzania)
- Backend: crop image generation for ambiguous water-masked areas
- Frontend: dismissed divisions stay on map (dimmed gray)
- Frontend: color-only neighbor swatches for all divisions
- Frontend: "Water or region?" prompt with source map crop
```
