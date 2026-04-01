# CV Pipeline Audit — Step-by-Step Review

**Date**: 2026-03-13
**Status**: Analysis (not an implementation plan)

## Purpose

Detailed audit of the auto CV match pipeline in `wvImportMatchController.ts` (function `colorMatchDivisionsSSE`, lines ~1664–3636). The "Clean image (Telea inpainted)" debug output shows severe artifacts: ghost text, smeared boundaries, ocean color bleeding into land. This document traces every step, identifies what data each step receives and produces, and catalogs issues.

---

## Pipeline Overview

The pipeline processes a Wikivoyage region map image to identify colored sub-regions and match them to GADM administrative divisions. It runs at 800px working resolution.

### Step Sequence

```
Input: mapBuffer (PNG/JPEG from Wikivoyage)
  │
  ├─→ origDownBuf  = downscale(800px, lanczos3, removeAlpha, raw)     [RGB, 3ch, CLEAN]
  ├─→ rawBuf       = downscale(800px, lanczos3, removeAlpha, median(5), raw)  [RGB, 3ch, FILTERED]
  │
  ├─→ removeColoredLines(rawBuf)    → thin blue/red/yellow features removed
  ├─→ colorBuf = copy(origDownBuf)
  ├─→ removeColoredLines(colorBuf)  → same removal on clean copy
  │
  ├─ Step A: Text Detection (from rawBuf)
  │   ├─→ BlackHat morphology on gray(rawBuf) → textMask
  │   ├─→ Dark spots (V < 50, small CCs) → merged into textMask
  │   ├─→ Dilate textMask (5×5 kernel) → textMaskDilated
  │   ├─→ Ocean buffer: low-sat pixels adjacent to text → added to inpaintMask
  │   │
  │   ├─→ Telea inpaint(rawBuf, inpaintMask) → cvInpainted   [for water detection]
  │   └─→ Telea inpaint(colorBuf, inpaintMask) → colorBuf updated in-place  [for ALL downstream] ⚠️
  │
  ├─ Step B: Water Detection (from cvInpainted = inpainted rawBuf)
  │   ├─→ Adaptive edge sampling → water color thresholds
  │   ├─→ Signal A: HSV tiers on inpainted image
  │   ├─→ Signal B: HSV tiers on original image
  │   ├─→ Signal C: color proximity to water centroid
  │   ├─→ Voting (≥2 agree) → waterRaw
  │   └─→ Morphological close + CC filter + dilate → waterGrown
  │
  ├─ Step C: Background Detection (from colorBuf = Telea-inpainted colorBuf)
  │   ├─→ Lab conversion of colorBuf → labBufEarly
  │   ├─→ K-means on edge pixels → background centroids (RGB → Lab)
  │   ├─→ Chrominance-weighted Lab distance → foreground mask
  │   ├─→ Gaussian blur + threshold + morph close → smoothed FG
  │   ├─→ CC analysis → country silhouette
  │   ├─→ Foreign land removal (erosion-based bridge breaking)
  │   └─→ Otsu saturation refinement → final countryMask
  │
  ├─ Step D: Park Detection + Removal (from buf = colorBuf)
  │   ├─→ Dark saturated green blobs within countryMask
  │   ├─→ BFS fill from boundary pixels (NOT Telea) ✓
  │   ├─→ Remnant cleanup via BFS ✓
  │   └─→ Harmonize: median of nearby non-filled pixels ✓
  │
  ├─ Step E: K-means Clustering (from buf = colorBuf, converted to Lab)
  │   ├─→ RGB → Lab via cv.cvtColor(COLOR_RGB2Lab)
  │   ├─→ Z-score normalization (L×0.5, a*×1.0, b*×1.0)
  │   ├─→ K-means++ init, up to 32 clusters, 40 iterations max
  │   ├─→ Phase 1: color-based label assignment (non-text pixels)
  │   ├─→ Phase 2: BFS label propagation into text gaps
  │   └─→ Spatial mode filter (pxS(5) neighborhood)
  │
  └─ Step F: Division Matching (in wvImportMatchShared.ts)
      ├─→ Spatial split (disconnected CC per cluster)
      ├─→ Cluster merge (similar adjacent clusters)
      ├─→ ICP alignment (cluster boundaries → division boundaries)
      └─→ OCR-assisted assignment
```

---

## Buffer Format Reference

| Buffer | Format | Channels | Source | Color Space | Processing Applied |
|--------|--------|----------|--------|-------------|-------------------|
| `mapBuffer` | PNG/JPEG | varies | Wikivoyage fetch | varies | none |
| `origDownBuf` | raw pixels | 3 (RGB) | `sharp(mapBuffer).removeAlpha().resize(800).raw()` | RGB | Lanczos3 downscale only |
| `rawBuf` | raw pixels | 3 (RGB) | `sharp(mapBuffer).removeAlpha().resize(800).median(5).raw()` | RGB | Lanczos3 + median(5) |
| `colorBuf` / `buf` | raw pixels | 3 (RGB) | `Buffer.from(origDownBuf)` then mutated | RGB | line removal + **Telea inpaint** |
| `cvRaw` | cv.Mat CV_8UC3 | 3 | `rawBuf` copied via `.data.set()` | RGB | median + line removal |
| `cvInpainted` | cv.Mat CV_8UC3 | 3 | `cv.inpaint(cvRaw, ...)` | RGB | median + line removal + Telea |
| `inpaintedBuf` | raw pixels | 3 (RGB) | `Buffer.from(cvInpainted.data)` | RGB | same as cvInpainted |
| `hsvSharp` | raw pixels | 3 (HSV) | `cv.cvtColor(cvRaw, COLOR_RGB2HSV)` | HSV | from median-filtered rawBuf |
| `hsvClean` | raw pixels | 3 (HSV) | `cv.cvtColor(cvInpainted, COLOR_RGB2HSV)` | HSV | from Telea-inpainted rawBuf |
| `hsvOrig` | raw pixels | 3 (HSV) | `cv.cvtColor(origDownBuf, COLOR_RGB2HSV)` | HSV | from clean downscale |
| `hsvBuf` | raw pixels | 3 (HSV) | `cv.cvtColor(colorBuf, COLOR_RGB2HSV)` | HSV | from Telea-inpainted colorBuf |
| `labBufEarly` | raw pixels | 3 (Lab) | `cv.cvtColor(colorBuf, COLOR_RGB2Lab)` | CIE Lab (8-bit) | from Telea-inpainted colorBuf |
| `labBuf` | raw pixels | 3 (Lab) | `cv.cvtColor(buf, COLOR_RGB2Lab)` | CIE Lab (8-bit) | at K-means time (after park fill too) |

**Color space conversions**: All use `COLOR_RGB2*` variants (not BGR). This is correct — sharp outputs RGB. ✓

**OpenCV 8-bit Lab encoding**: L ∈ [0,255] (0→0, 255→100), a* ∈ [0,255] (128→0), b* ∈ [0,255] (128→0). ✓

---

## Issues Found

### CRITICAL: colorBuf Uses Telea Inpainting Instead of BFS Fill

**Location**: Lines 1826–1844

**Comments say** (lines 1711–1715):
```
Clean color buffer for K-means: start from origDownBuf (zero spatial filtering →
zero cross-boundary contamination). Text is removed via BFS color propagation
(nearest non-text neighbor color) instead of Telea inpainting (which bleeds ocean)
```

**Code does**: Telea inpainting on colorBuf using the exact same `inpaintMask` and `INPAINT_R` as the rawBuf pass.

**Also at line 1999**:
```
Pipeline: origDownBuf (no spatial filter) → line removal → BFS text fill.
```
Again, the comment says BFS but the code does Telea.

**Why this is the #1 problem**: Telea inpainting is a PDE-based method that interpolates from ALL non-masked pixels within its radius. For text sitting on a boundary between two differently-colored regions, Telea creates a muddy blend of both region colors. For text near coastlines, it pulls ocean blue into the land. This is exactly what the screenshot shows — smeared boundaries and ocean bleeding.

BFS nearest-neighbor fill would assign each text pixel the color of its single nearest non-text pixel. At region boundaries, each side gets its own color — no mixing. The comments and the design spec (Improvement #4 in the quality-improvements doc) both describe this approach, but it was never implemented for colorBuf.

**Impact**: Every downstream step consumes colorBuf:
- Lab conversion for BG detection → corrupted Lab values near text
- HSV for foreground mask → corrupted saturation near text
- Park detection → uses buf (= colorBuf) for brightness/saturation checks
- K-means → clusters on corrupted colors near boundaries
- All debug visualizations

### HIGH: Text Mask Derived from Median-Filtered Image, Applied to Non-Filtered Image

**Location**: Lines 1730–1774 (detection), 1833–1844 (application)

The text mask is computed from `rawBuf` (median(5) filtered):
- BlackHat morphology on `gray(rawBuf)` — the median filter blurs text edges
- Dark spot detection uses `hsvSharp` — HSV of the median-filtered image
- Dilation compensates somewhat (5×5 kernel)

But the mask is applied to `colorBuf` which started as `origDownBuf` (no median). Text in the original image has sharper edges than in the median-filtered version. The mask may:
- **Miss text pixels**: Sharp text edges in origDownBuf that were blurred below the BlackHat threshold in rawBuf
- **Over-mask non-text pixels**: The median filter can shift the apparent position of thin features

**Impact**: Ghost text visible in the "clean" image comes partly from missed text pixels.

### HIGH: INPAINT_R Is Too Large for Coastal Strips

**Location**: Line 1787

```typescript
const INPAINT_R = pxS(8); // = ~13 pixels at TW=800
```

At 800px, a 13-pixel Telea radius is very large. On thin coastal strips (15–20px wide), the inpainting neighborhood extends well into the ocean. Even with the ocean buffer (S < 15 guard), any coastal pixel that passes the saturation check bleeds ocean colors.

The ocean buffer helps but is too conservative: `S < 15` only catches truly gray background. Desaturated ocean (S = 20–40) near the coast passes through and contaminates.

### MEDIUM: removeColoredLines Behaves Differently on Each Buffer

**Location**: Lines 1709, 1717

```typescript
removeColoredLines(rawBuf, TW, TH, RES_SCALE);  // median-filtered input
// ...
removeColoredLines(colorBuf, TW, TH, RES_SCALE); // clean input
```

`removeColoredLines` classifies pixels by HSL hue/saturation, then measures run lengths to identify thin features. On the median-filtered image, colored lines are slightly blurred, which changes:
- Which pixels pass the hue/saturation thresholds
- Run length measurements (blurred lines appear thicker)
- Which pixels get median-replaced

Result: The two buffers have subtly different sets of pixels removed. The text mask (from rawBuf after its line removal) may reference pixels that look different in colorBuf (after its own line removal).

### MEDIUM: Ocean Buffer Uses hsvSharp (from rawBuf), Not from colorBuf

**Location**: Lines 1790–1808

The ocean buffer loop checks `hsvSharp[i * 3 + 1] < 15` to identify gray background pixels adjacent to text. But `hsvSharp` is the HSV of `rawBuf` (median-filtered). The saturation values at the same pixel positions in `colorBuf` may differ — the median filter changes local saturation by averaging with neighbors.

### MEDIUM: Two Telea Passes Share Same Mask for Different Purposes

**Location**: Lines 1810–1844

Both passes use the identical `inpaintMask` (dilated text + ocean buffer):

| Pass | Input | Purpose | Telea Justified? |
|------|-------|---------|------------------|
| rawBuf → cvInpainted | median-filtered | Water detection | **Yes** — water detection uses HSV which is robust to slight Telea smearing. The goal is just to remove text so blue water isn't interrupted. |
| colorBuf → colorBuf | clean downscale | All downstream (BG detection, K-means, viz) | **No** — K-means needs precise per-region colors. Telea smears boundary colors. BFS fill would preserve exact region colors. |

### LOW: Lab BG Detection Reads Telea-Corrupted Data

**Location**: Lines 1847–1853

```typescript
cvBufForSeam.data.set(colorBuf);  // colorBuf is already Telea-inpainted here
cv.cvtColor(cvBufForSeam, cvLabSeam, cv.COLOR_RGB2Lab);
const labBufEarly = Buffer.from(cvLabSeam.data);
```

`labBufEarly` is used for chrominance-weighted background detection (line 2576). Near text locations, the Lab values are from Telea-interpolated colors rather than true region colors. This could cause background detection to misclassify some boundary pixels.

**Practical impact**: Moderate. Background detection has multiple safeguards (coastal band, textExcluded forced-foreground, saturation refinement) that compensate.

### LOW: K-means Comment References "BFS-filled colors"

**Location**: Line 3395

```typescript
// Exclude text pixels from K-means centroids — their BFS-filled colors are
// from nearest neighbors and may be wrong at region boundaries.
```

The comment says "BFS-filled" but the actual text pixels have Telea-inpainted colors. The exclusion is correct regardless — text pixels should not participate in centroid computation — but the comment is misleading.

---

## What Works Well

Despite the issues above, several parts of the pipeline are well-designed:

1. **Park removal uses BFS** (lines 3192–3328) — correct approach. Each park pixel gets the color of its nearest non-park boundary pixel. No Telea. This is exactly what text removal should also do.

2. **K-means in Lab with z-score normalization** (lines 3361–3479) — perceptually accurate and handles muted palettes.

3. **Two-phase label assignment** (lines 3500–3535) — clean pixels get color-based labels, text pixels get spatial BFS labels. Correct architecture.

4. **Spatial mode filter** (lines 3538–3583) — cleans up noise without destroying thin features (2× guard).

5. **Multi-signal water voting** (lines 1907–1996) — robust approach using inpainted + original + centroid proximity.

6. **Ocean buffer for rawBuf inpainting** (lines 1781–1808) — good idea for the water detection pass where Telea is appropriate.

7. **Adaptive water thresholds** (lines 1864–1904) — edge sampling handles non-standard water colors.

---

## Root Cause of the Screenshot Artifacts

The Morocco "Clean image" screenshot shows:

| Artifact | Cause |
|----------|-------|
| Ghost text (labels partially visible) | Text mask derived from median-filtered rawBuf misses sharp text edges in origDownBuf. BlackHat threshold + 5×5 dilation don't fully cover text in the unfiltered image. |
| Smeared/blended colors at region boundaries | Telea inpainting on colorBuf blends colors from both sides of boundaries. A 13px radius pulls pixels from neighboring regions. |
| Ocean blue bleeding into coastal land | Telea radius (13px) extends into ocean on thin coastal strips. Ocean buffer only catches S < 15 (gray), not desaturated ocean (S = 20–40). |
| Overall "dirty" / washed-out appearance | Cumulative effect: every text location becomes a local color average of its surroundings, and there's a lot of text on Wikivoyage maps. |

**The single biggest fix** would be replacing Telea inpainting on colorBuf with BFS nearest-neighbor color fill — exactly what the comments already describe. The park removal code (lines 3192–3328) demonstrates the correct BFS approach already working in the same file.

---

## Data Dependency Graph

```
origDownBuf ──→ colorBuf ──(line removal)──→ (Telea inpaint) ──→ labBufEarly ──→ BG detection
                    │                              │                                    │
                    │                              ↓                                    ↓
                    │                         hsvBuf ──→ foreground mask           countryMask
                    │                              │                                    │
                    │                              ↓                                    ↓
                    │                    park detection ──→ BFS park fill         K-means input
                    │                                          │                        │
                    │                                          ↓                        ↓
                    └──────────────────────────→ buf ──→ Lab conversion ──→ clustering ──→ labels

rawBuf ─────(line removal)──→ (Telea inpaint) ──→ cvInpainted ──→ water detection ──→ waterGrown
                                    │
                                    ↓
                              hsvClean, hsvSharp ──→ text mask ──→ textExcluded
                                                        │
                                                        ↓
                                                  inpaintMask (shared by both Telea passes)
```

Key observation: `inpaintMask` is derived entirely from rawBuf data (hsvSharp, BlackHat on gray(rawBuf)) but applied to both rawBuf and colorBuf. The mask is tuned for the median-filtered image's characteristics.

---

## Improvement Directions (for future planning)

These are observations for when we design fixes, not an implementation plan:

1. **Replace Telea with BFS fill on colorBuf** — copy the park-fill BFS pattern (lines 3212–3238). For each text-masked pixel, propagate the color of the nearest non-masked pixel. This eliminates boundary smearing entirely. The BFS code already exists in the same file.

2. **Compute text mask from origDownBuf, not rawBuf** — since the mask is applied to colorBuf (which derives from origDownBuf), the detection should run on the same source. This may require adjusting BlackHat parameters since text is sharper without median.

3. **Consider separate masks for separate purposes** — rawBuf inpainting (for water detection) can keep its current mask. colorBuf fill can use a mask optimized for the non-filtered image. They don't need to share.

4. **Reduce INPAINT_R for rawBuf pass** — even for water detection, 13px is aggressive. Text is typically 3–8px at 800px resolution. `pxS(5)` (~8px) would be sufficient and cause less boundary smearing in the water detection pass.

5. **Add BFS seam detection** — as described in the quality-improvements design spec (Improvement #4), after BFS fill, identify seam pixels where two different-colored wavefronts met and mark them as textExcluded. This was planned but appears not yet implemented.

6. **Consider running text detection on origDownBuf** — if BlackHat needs the contrast that median filtering provides, an alternative is to run BlackHat on `origDownBuf` (which has more text contrast than the median version) and use a slightly larger dilation kernel to compensate for sharper edges.
