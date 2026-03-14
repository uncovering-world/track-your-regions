# Wikivoyage Map Feature Anatomy & Classification Guide

**Date**: 2026-03-14
**Status**: Reference document
**Based on**: Analysis of 120 Wikivoyage region map PNGs + SVG source inspection + official WV style guide

## Purpose

Comprehensive reference for all visual features found on Wikivoyage region maps, their color properties, spatial characteristics, and how the CV pipeline should handle each. Drives the design of text detection, background removal, and all preprocessing before K-means clustering.

---

## Map Template & Color System

Wikivoyage maps follow the [How to Draw Static Maps](https://en.wikivoyage.org/wiki/Wikivoyage:How_to_draw_static_maps) guide and use the [StdColor template](https://en.wikivoyage.org/wiki/Template:StdColor) for region fills. All maps use **DejaVu Sans Condensed** font family.

### Region Fill Palette (StdColor)

11 standard colors, described as "low-saturation, medium-luminosity":

| Name | Hex | RGB | HSV (approx) |
|------|-----|-----|--------------|
| T1 | `#ac5c91` | (172,92,145) | H 320, S 47, V 67 |
| T2 | `#d5dc76` | (213,220,118) | H 64, S 46, V 86 |
| T3 | `#b5d29f` | (181,210,159) | H 94, S 24, V 82 |
| T4 | `#b383b3` | (179,131,179) | H 300, S 27, V 70 |
| T5 | `#71b37b` | (113,179,123) | H 129, S 37, V 70 |
| T6 | `#8a84a3` | (138,132,163) | H 252, S 19, V 64 |
| T7 | `#d09440` | (208,148,64) | H 35, S 69, V 82 |
| T8 | `#578e86` | (87,142,134) | H 171, S 39, V 56 |
| T9 | `#d56d76` | (213,109,118) | H 355, S 49, V 84 |
| T10 | `#4f93c0` | (79,147,192) | H 204, S 59, V 75 |
| T11 | `#69999f` | (105,153,159) | H 187, S 34, V 62 |

**Key properties**: All fills have **S ≥ 19** and **V ≥ 56**. Not all maps use StdColor exactly — some use custom palettes — but the pattern holds: fills are pastel, medium-bright, distinctly colored.

### Quantitative Fill Analysis (120 maps)

- Saturation: P10=20, **median=38**, P90=82
- Brightness (V): P10=59, **median=78**, P90=92
- 96% of fills have V ≥ 50
- 100% of fills have S ≥ 15
- Most common hues: Light Blue (180-210), Orange (30-60), Cyan (150-180)
- 61% pastel (S 15-50, V 60+), 32% vivid (S > 50)

---

## Feature Inventory

### 1. Text — City Names

| Property | Value |
|----------|-------|
| Color | `#000000` (black) |
| HSV | H 0, S 0, V 0 |
| Style | DejaVu Sans Bold, normal, Title Case |
| Shape | Text strings, 8-20px tall at full resolution |
| Frequency | 19/20 maps |
| Classification rule | V < 50 ✓, S < 15 ✓ |
| Current handler | Text detection (ML or BlackHat) + dark CC |

### 2. Text — Region Names (inside country)

| Property | Value |
|----------|-------|
| Color | `#656565` (medium gray) |
| HSV | H 0, S 0, V 40 (8-bit: 101 in 0-255 scale, 40% in 0-100) |
| Style | DejaVu Sans Condensed, **italic**, **ALL CAPS** |
| Shape | Larger text than city names, centered on region |
| Frequency | 15/20 maps |
| Classification rule | S < 15 ✓ (S = 0) |
| Current handler | ML text detection. **Not caught by dark CC** (V too high for V<50 threshold on 0-255 scale, V=101) |

### 3. Text — Water Labels (oceans, seas, lakes)

| Property | Value |
|----------|-------|
| Color | `#006bff` (vivid blue) |
| HSV | H 215, S 100, V 100 |
| Style | DejaVu Sans Condensed, **italic**, Title Case |
| Shape | Text strings, often large for ocean names |
| Frequency | 14/20 maps (all coastal maps) |
| Classification rule | NOT caught by V<50 or S<15 (bright and saturated) |
| Current handler | `removeColoredLines` catches as blue (H 170-270, S>20) |
| Note | Same color as rivers — both removed together before water detection |

### 4. Text — Landmark/Park Names

| Property | Value |
|----------|-------|
| Color | `#383838` (dark gray) |
| HSV | H 0, S 0, V 22 |
| Style | DejaVu Sans Condensed, normal or italic |
| Frequency | 8/20 maps |
| Classification rule | V < 50 ✓, S < 15 ✓ |
| Current handler | Dark CC detection + ML text detection |

### 5. Text — Neighborhood Names

| Property | Value |
|----------|-------|
| Color | `#1a1a1a` (near-black) |
| HSV | H 0, S 0, V 10 |
| Style | DejaVu Sans Condensed, italic |
| Frequency | City-level maps (rare in region maps) |
| Classification rule | V < 50 ✓, S < 15 ✓ |
| Current handler | Dark CC detection |

### 6. Text — Neighbor Country Names

| Property | Value |
|----------|-------|
| Color | `#4a4a4a`–`#656565` (dark to medium gray) |
| HSV | H 0, S 0, V 29-40 |
| Style | Large, often ALL CAPS, on gray background |
| Frequency | 15/20 maps |
| Classification rule | V < 50 ✓ or S < 15 ✓ |
| Current handler | Falls on background → eliminated by `detectBackground` |

---

### 7. Roads — Red

| Property | Value |
|----------|-------|
| Color | `#ff0000` (pure red) to `#dc1e32` (crimson) |
| HSV | H 0-5, S 84-100, V 70-100 |
| Shape | Thin solid lines, 1-3px at 800px. Major highways |
| Frequency | 16/20 maps. 0.5-13% of image (Bavaria extreme) |
| Classification rule | NOT caught by V<50/S<15 (bright + saturated) |
| Current handler | `removeColoredLines` H≤25 or ≥335, S>40 ✓ |

### 8. Roads — Yellow

| Property | Value |
|----------|-------|
| Color | `#fad200` (golden) to `#fde352` (pale yellow) |
| HSV | H 50-61, S 100, V 98-100 |
| Shape | Thin solid lines, secondary roads |
| Frequency | 14/20 maps. 0.3-9.2% of image |
| Classification rule | NOT caught by V<50/S<15 |
| Current handler | `removeColoredLines` H 40-70, S>40 ✓ |

### 9. Roads — Orange (GAP)

| Property | Value |
|----------|-------|
| Color | `#ff9500` (pure orange) |
| HSV | H 35, S 100, V 100 |
| Shape | Small route marker shields |
| Frequency | Rare (2-3/20, city-level maps like Andorra) |
| Classification rule | NOT caught by V<50/S<15 |
| Current handler | **GAP** — H=35 falls between red (H≤25) and yellow (H≥40) ranges |
| Recommendation | Low priority. Close gap by extending yellow range to H≥30 if needed |

### 10. Roads — White

| Property | Value |
|----------|-------|
| Color | `#ffffff` (white) |
| HSV | H 0, S 0, V 100 |
| Shape | Thin lines within country areas, minor roads |
| Frequency | 14/20 maps. 0.1-3.3% |
| Classification rule | S < 15 ✓ (S = 0) — correctly classified as non-fill |
| Current handler | Median filter dissolves 1-2px white lines into surrounding region color. Surviving fragments are small and don't affect K-means significantly |

---

### 11. Rivers

| Property | Value |
|----------|-------|
| Color | `#006bff` (vivid blue), `#053bd7` (dark blue), `#9ccec9` (teal, same as ocean) |
| HSV | H 215-225, S 97-100, V 84-100 |
| Shape | Thin flowing lines, 1-3px, sometimes branching |
| Frequency | 10/20 maps. 0.1-3.5% |
| Classification rule | NOT caught by V<50/S<15 |
| Current handler | `removeColoredLines` H 170-270, S>20 ✓ |

---

### 12. Borders — External (country borders)

| Property | Value |
|----------|-------|
| Color | `#000000` (black) or very dark gray |
| HSV | V < 10, achromatic |
| Shape | Thin solid or dashed lines, 1-2px |
| Frequency | 15/20 maps |
| Classification rule | V < 50 ✓, S < 15 ✓ |
| Current handler | Text detection + median filter |

### 13. Borders — Internal (region dividers)

| Property | Value |
|----------|-------|
| Color | `#fbfdfd` (near-white) or thin gap between fill colors |
| HSV | V > 250, S < 5 |
| Shape | Very thin lines (1-2px) between region fills |
| Frequency | 14/20 maps |
| Classification rule | S < 15 ✓ |
| Current handler | Not handled and **should not be** — these ARE the boundaries K-means uses to separate regions |
| Note | Beneficial feature, not noise |

---

### 14. City Dots

| Property | Value |
|----------|-------|
| Color | `#000000` (black filled circles) |
| HSV | V = 0 |
| Shape | Solid circles, 2-4px at 800px |
| Frequency | 18/20 maps |
| Classification rule | V < 50 ✓ |
| Current handler | Dark CC analysis (V<50, CC area < 0.5%) ✓ |

### 15. Capital Stars

| Property | Value |
|----------|-------|
| Color | `#000000` (black filled 5-pointed stars) |
| HSV | V = 0 |
| Shape | 5-pointed stars, ~10-20px at full resolution |
| Frequency | 10/20 maps |
| Classification rule | V < 50 ✓ |
| Current handler | Dark CC analysis ✓ |

---

### 16. Compass Rose / North Arrow

| Property | Value |
|----------|-------|
| Color | `#1b4157` (dark teal) primary, `#d3e3e3` (light blue-gray) fill |
| HSV | Primary: H 202, S 69, V 34. Fill: H 180, S 7, V 89 |
| Shape | Decorative compass with N arrow, ~100-200px |
| Frequency | 16/20 maps. Corner positioned |
| Classification rule | Primary: V < 50 ✓. Fill: S < 15 ✓ |
| Current handler | Falls on background → eliminated by `detectBackground` ✓ |

### 17. Scale Bar

| Property | Value |
|----------|-------|
| Color | `#000000` (black) + `#ffffff` (white) |
| Shape | Horizontal bar with km/miles text |
| Frequency | 16/20 maps |
| Current handler | Falls on background → eliminated by `detectBackground` ✓ |

### 18. Title Box

| Property | Value |
|----------|-------|
| Color | Varies — dark teal background with white text, or black text on light background |
| Shape | Rectangular box in corner |
| Frequency | 18/20 maps |
| Current handler | Falls on background → eliminated by `detectBackground` ✓ |

---

### 19. Ocean / Sea

| Property | Value |
|----------|-------|
| Color | `#9ccec9` (teal). Solid in PNG (SVG wave pattern resolves to flat color at typical rasterization) |
| HSV | H 174, S 24, V 81 |
| Shape | Large contiguous areas at image edges |
| Frequency | 16/20 maps |
| Classification rule | NOT caught by V<50/S<15 (S=24 > 15, V=81 > 50) — correctly stays as "fill-like" |
| Current handler | `detectWater` with multi-signal voting + adaptive edge sampling ✓ |

### 20. Lakes / Internal Water

| Property | Value |
|----------|-------|
| Color | Same as ocean `#9ccec9` |
| Shape | Irregular shapes within country |
| Frequency | 8/20 maps |
| Current handler | `detectWater` CC analysis ✓ |

### 21. Park Overlays

| Property | Value |
|----------|-------|
| Color | `#51771f` (dark olive green). Range: R 60-100, G 90-130, B 20-45 |
| HSV | H 80-97, S 56-85, V 36-53 |
| Shape | Irregular blobs within country |
| Frequency | 8/20 maps |
| Classification rule | V < 50 for darker parks ✓, but some parks have V > 50 |
| Current handler | `detectParks` with dark+saturated+green criterion + interactive review ✓ |

---

### 22. Highway Shields (GAP)

| Property | Value |
|----------|-------|
| Color | `#408614` (vivid green box) with white/yellow number |
| HSV | H 97, S 85, V 53 |
| Shape | Small rectangles, ~10-20px |
| Frequency | Rare (2-3/20, mainly Australia) |
| Classification rule | NOT caught by V<50/S<15 |
| Current handler | **GAP** — not caught by `removeColoredLines` (only handles blue, red, yellow). Too bright/saturated for dark CC |
| Recommendation | Low priority. Dissolves into surrounding color after median filter + downscale |

### 23. Airport Symbols

| Property | Value |
|----------|-------|
| Color | `#000000` (black airplane silhouette) |
| Shape | Small airplane icon, ~10-15px |
| Frequency | 6/20 maps |
| Classification rule | V < 50 ✓ |
| Current handler | Dark CC analysis ✓ |

### 24. Railroad Lines

| Property | Value |
|----------|-------|
| Color | Black dashed or alternating black/white. Navy `#00003c` variant |
| HSV | V < 60, achromatic or very dark blue |
| Frequency | 3-4/20 maps |
| Current handler | Text detection (black dashes) + `removeColoredLines` (navy blue: H 240, S 100 → caught) ✓ |

### 25. Anti-aliasing Halos

| Property | Value |
|----------|-------|
| Color | Various intermediate colors between text/line and background |
| HSV | Typically S < 15, V 50-90 |
| Shape | 1-2px fringe around all dark features |
| Frequency | All maps |
| Classification rule | S < 15 ✓ |
| Current handler | Dilation covers most halos. Median filter smooths the rest ✓ |

### 26. Lat/Lon Grid Lines

| Property | Value |
|----------|-------|
| Color | `#000000` to `#040606` (near-black) |
| Shape | Thin straight lines crossing entire map |
| Frequency | Rare (2-3/20) |
| Classification rule | V < 50 ✓ |
| Current handler | Text detection ✓ |

---

## The Classification Rule

### Data-Validated Rule (120 maps)

After `removeColoredLines` has removed bright colored lines (roads, rivers, blue water labels):

```
region_fill  = (V >= 50) AND (S >= 15)    — bright and colored
non_fill     = (V < 50)  OR  (S < 15)     — dark or achromatic
```

Where V and S are in 0-100 scale (or equivalently V 0-255: threshold at 128, S 0-255: threshold at 38).

### What this catches correctly

| Feature | V | S | Rule match | Correct? |
|---------|---|---|------------|----------|
| Black text (#000000) | 0 | 0 | V<50 ✓ | ✓ |
| Dark gray text (#383838) | 22 | 0 | V<50 ✓ | ✓ |
| Medium gray text (#656565) | 40 | 0 | S<15 ✓ | ✓ |
| Near-black text (#1a1a1a) | 10 | 0 | V<50 ✓ | ✓ |
| City dots | 0 | 0 | V<50 ✓ | ✓ |
| Capital stars | 0 | 0 | V<50 ✓ | ✓ |
| External borders | <10 | 0 | V<50 ✓ | ✓ |
| Internal borders | >98 | <5 | S<15 ✓ | ✓ |
| White roads | 100 | 0 | S<15 ✓ | ✓ |
| Anti-aliasing halos | varies | <15 | S<15 ✓ | ✓ |
| Background gray | 56 | 2 | S<15 ✓ | ✓ |
| Region fills (all 11 StdColors) | 56-86 | 19-69 | No match | ✓ |
| Ocean (#9ccec9) | 81 | 24 | No match | ✓ (handled by water detection) |
| Parks (#51771f) | 36-53 | 56-85 | V<50 for dark parks | Acceptable (parks handled separately) |

### What this does NOT catch (correctly left for other handlers)

| Feature | Why not caught | Handler |
|---------|---------------|---------|
| Red/yellow roads | V>50, S>15 | `removeColoredLines` (runs first) |
| Blue rivers/water labels | V>50, S>15 | `removeColoredLines` (runs first) |
| Ocean | V>50, S>15 | `detectWater` |
| Parks | V≈50, S>15 | `detectParks` |

### Pipeline Order

The classification rule works because of the pipeline ordering:

1. **`removeColoredLines`** — removes bright colored lines (roads, rivers, blue text)
2. **HSV classification** (`V<50 OR S<15`) — marks remaining text, symbols, dots, borders, halos
3. **`detectWater`** — removes ocean/lakes
4. **`detectBackground`** — removes gray non-country areas
5. **`detectParks`** — removes dark green overlays
6. **K-means** — clusters only remaining region fill pixels

---

## Known Gaps (Low Severity)

| Gap | Feature | Maps affected | Impact |
|-----|---------|--------------|--------|
| Orange routes | H 25-40 markers between red/yellow ranges | 2-3 maps (Andorra) | Negligible — tiny pixel count |
| Green highway shields | H 97, S 85, V 53 | 2-3 maps (Australia) | Dissolves after median filter |
| Very dark parks | Some parks have V < 50 | 3-4 maps | Caught by V<50 rule but handled correctly by `detectParks` downstream |

None of these gaps affect K-means clustering quality in practice.

---

## Recommendations

1. **Replace ML text detection with HSV classification** — the `V<50 OR S<15` rule (after `removeColoredLines`) is simpler, faster, requires no model download, and is validated against 120 maps.

2. **Keep `removeColoredLines` as a prerequisite** — it handles the bright colored features (roads, rivers, blue labels) that the HSV rule can't catch.

3. **Keep dark CC detection** — for city dots, capital stars, and small symbols that are dark but might be too small for the HSV rule to meaningfully affect.

4. **Keep existing downstream handlers** — water, background, and park detection are well-designed and correctly ordered.

5. **Consider spatial CC analysis as refinement** — within the HSV-classified "non-fill" pixels, colors with many tiny CCs (median size < 5px) are confirmed text/symbols; colors with a few larger CCs might be borders or other linear features. This refinement is optional — the HSV rule alone is sufficient for most maps.
