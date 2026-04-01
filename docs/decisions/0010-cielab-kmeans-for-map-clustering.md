# ADR-0010: CIELAB color space with K-means++ for map clustering

**Date:** 2026-03-24
**Status:** Accepted

---

## Context

The CV pipeline needs to segment Wikivoyage map images into color regions that correspond to administrative divisions. K-means clustering is used to group pixels by color, but the choice of color space significantly affects clustering quality. RGB Euclidean distance does not match human color perception -- perceptually different colors (e.g., two shades of blue) can have small RGB distances, while visually similar colors can be far apart in RGB space. Wikivoyage maps use color to distinguish adjacent regions, so perceptual accuracy is critical.

## Decision

Convert pixel data to CIELAB color space before running K-means clustering, and use K-means++ initialization for centroid seeding.

The pipeline uses OpenCV's `cv.cvtColor(src, dst, cv.COLOR_RGB2Lab)` to convert the cleaned color buffer to CIELAB, then runs K-means with chromatic normalization (boosting the a* and b* channels relative to L*) to emphasize color differences over brightness differences.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| RGB K-means | Euclidean distance in RGB does not correlate with perceived color difference; adjacent map regions with perceptually distinct colors (e.g., light green vs. yellow) may cluster together |
| HSV K-means | Hue is circular (0 and 360 are the same color), requiring special distance metrics; saturation and value channels have different perceptual scales; discontinuities at low saturation where hue becomes undefined |
| Histogram-based clustering | Loses spatial information needed for connected-component labeling; cannot distinguish two regions with the same color that are spatially separate |

## Consequences

**Positive:**
- CIELAB is designed for perceptual uniformity -- equal Euclidean distances correspond to equal perceived color differences
- K-means++ initialization avoids poor centroid placement, reducing iterations and improving cluster quality
- Chromatic normalization (`chromaBoost` parameter) allows tuning the balance between color and brightness sensitivity per map style
- Integrates cleanly with OpenCV's built-in `COLOR_RGB2Lab` conversion

**Negative / Trade-offs:**
- Additional conversion step adds processing time (though minimal compared to K-means iterations)
- CIELAB is only approximately perceptually uniform; CIEDE2000 would be more accurate but is far more expensive to compute per-pixel
- Requires understanding of Lab channel ranges (L: 0-100, a/b: -128 to +127) when tuning parameters

## References

- Key file: `backend/src/controllers/admin/wvImportMatchCluster.ts` (Lab conversion, lines 23-29)
- Related ADRs: ADR-0009 (OpenCV.js for CV operations), ADR-0011 (dual pipeline)
