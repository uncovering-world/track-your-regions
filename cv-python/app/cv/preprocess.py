"""
Preprocessing pipeline for the Python CV service.

Ports all JS pipeline preprocessing stages:
1. Colored line removal (HSL classification + run-length filtering + median replacement)
2. Mean-shift filtering (pyrMeanShiftFiltering, sp=10, sr=20)
3. Two-stage background detection (corner flood-fill + gray morphological opening)
4. Water detection on ORIGINAL image (edge HSV seeding + flood-fill + inland lakes)
"""

import cv2
import numpy as np

from ..utils.image import encode_png_base64, resize_image

# -- Constants (match JS pipeline) --
BG_RGB_DIST = 30
WATER_H_MIN = 70
WATER_H_MAX = 140
WATER_S_MIN = 20
CORNER_SAMPLE_PX = 8


# =============================================================================
# Step 1: Colored line removal
# =============================================================================


def _rgb_to_hsl(img_rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Convert RGB image to H (0-360), S (0-100), L (0-100) float arrays.
    Vectorized — no per-pixel loops."""
    rgb_f = img_rgb.astype(np.float32) / 255.0
    r, g, b = rgb_f[:, :, 0], rgb_f[:, :, 1], rgb_f[:, :, 2]

    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    l = (mx + mn) / 2.0
    d = mx - mn

    # Saturation (guard against division by zero for pure black pixels)
    denom_lo = np.maximum(mx + mn, 1e-10)
    denom_hi = np.maximum(2.0 - mx - mn, 1e-10)
    s = np.where(
        d == 0,
        0.0,
        np.where(l > 0.5, d / denom_hi, d / denom_lo),
    )

    # Hue
    h = np.zeros_like(l)
    mask_r = (mx == r) & (d > 0)
    mask_g = (mx == g) & (d > 0) & ~mask_r
    mask_b = (mx == b) & (d > 0) & ~mask_r & ~mask_g

    h[mask_r] = ((g[mask_r] - b[mask_r]) / d[mask_r]) % 6
    h[mask_g] = (b[mask_g] - r[mask_g]) / d[mask_g] + 2
    h[mask_b] = (r[mask_b] - g[mask_b]) / d[mask_b] + 4

    h = (h / 6.0 * 360).astype(np.float32)
    h[h < 0] += 360
    s = (s * 100).astype(np.float32)
    l = (l * 100).astype(np.float32)

    return h, s, l


def _classify_colored_pixels(img_bgr: np.ndarray) -> np.ndarray:
    """Classify pixels by HSL hue+saturation into colored line categories.
    Returns uint8 array: 0=keep, 1=blue/cyan, 2=red, 3=yellow."""
    rgb = img_bgr[:, :, ::-1]  # BGR -> RGB
    h, s, _ = _rgb_to_hsl(rgb)

    ctype = np.zeros(img_bgr.shape[:2], dtype=np.uint8)
    # Blue/cyan: H in [170, 270], S > 20
    ctype[(h >= 170) & (h <= 270) & (s > 20)] = 1
    # Red: H <= 25 or H >= 335, S > 40
    ctype[((h <= 25) | (h >= 335)) & (s > 40)] = 2
    # Yellow/orange: H in [25, 70], S > 40
    # Extends down to H=25 to cover orange roads (e.g., Inter-American Highway)
    # that fall between the red (H<=25) and old yellow (H>=40) ranges.
    ctype[(h >= 25) & (h <= 70) & (s > 40)] = 3

    return ctype


def _compute_run_lengths(ctype: np.ndarray, max_run: int) -> np.ndarray:
    """For each classified pixel, compute min(horizontal, vertical) run length.
    Vectorized approach: scan horizontally and vertically, take per-pixel min."""
    h, w = ctype.shape
    classified = (ctype > 0).astype(np.uint8)

    # Horizontal run length via cumulative sum trick
    h_run = np.zeros((h, w), dtype=np.int32)
    # Forward pass
    h_fwd = np.zeros((h, w), dtype=np.int32)
    for x in range(w):
        if x == 0:
            h_fwd[:, x] = classified[:, x]
        else:
            h_fwd[:, x] = np.where(classified[:, x] > 0, h_fwd[:, x - 1] + 1, 0)
    # Backward pass
    h_bwd = np.zeros((h, w), dtype=np.int32)
    for x in range(w - 1, -1, -1):
        if x == w - 1:
            h_bwd[:, x] = classified[:, x]
        else:
            h_bwd[:, x] = np.where(classified[:, x] > 0, h_bwd[:, x + 1] + 1, 0)
    h_run = h_fwd + h_bwd - classified  # total run through each pixel

    # Vertical run length
    v_fwd = np.zeros((h, w), dtype=np.int32)
    for y in range(h):
        if y == 0:
            v_fwd[y, :] = classified[y, :]
        else:
            v_fwd[y, :] = np.where(classified[y, :] > 0, v_fwd[y - 1, :] + 1, 0)
    v_bwd = np.zeros((h, w), dtype=np.int32)
    for y in range(h - 1, -1, -1):
        if y == h - 1:
            v_bwd[y, :] = classified[y, :]
        else:
            v_bwd[y, :] = np.where(classified[y, :] > 0, v_bwd[y + 1, :] + 1, 0)
    v_run = v_fwd + v_bwd - classified

    # Min of horizontal and vertical
    return np.minimum(h_run, v_run)


def _inpaint_colored_roads(img_bgr: np.ndarray, res_scale: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Inpaint thin yellow/orange road-like linear features before median-based line removal.

    Median replacement (in remove_colored_lines) leaves ghost residue when road pixels
    dominate the median window. This pre-step uses cv2.inpaint which propagates
    surrounding province colors from outside the mask, erasing roads cleanly.

    General (not map-specific): linearity gate via distance transform — only components
    thinner than ~6px are treated as roads. Legitimate yellow provinces stay intact.

    Returns:
        (result_bgr, road_mask) — road_mask is uint8 2D, non-zero where a road
        pixel was detected. Union into pipeline's known_noise_mask.
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    # Yellow/orange HSV range: H ∈ [15°, 50°] → OpenCV H ∈ [8, 25]
    # S > 60 (saturated), V > 150 (bright — excludes dark text)
    color_mask = ((h >= 8) & (h <= 25) & (s > 60) & (v > 150)).astype(np.uint8)

    if int(color_mask.sum()) == 0:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Close small gaps (anti-aliasing, dashed-road breaks)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_CLOSE, close_kernel)

    # Linearity gate: per-component max thickness via distance transform
    dist = cv2.distanceTransform(color_mask, cv2.DIST_L2, 3)
    max_thickness_px = max(3, round(6 * res_scale))

    n_cc, labels, stats, _ = cv2.connectedComponentsWithStats(color_mask)
    road_mask = np.zeros_like(color_mask)
    for j in range(1, n_cc):
        area = int(stats[j, cv2.CC_STAT_AREA])
        if area < 10:
            # Tiny specks (icons, markers) — inpaint regardless of linearity
            road_mask[labels == j] = 1
            continue
        comp_max_dist = float(dist[labels == j].max())
        if comp_max_dist <= max_thickness_px:
            road_mask[labels == j] = 1  # thin linear feature → road

    mask_count = int(road_mask.sum())
    if mask_count == 0:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Dilate to capture anti-aliased edges beyond the strict color threshold
    dilate_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    road_mask = cv2.dilate(road_mask, dilate_kernel)

    # Per-pixel nearest-neighbour fill: each road pixel takes the colour of
    # its nearest non-road pixel via distance transform. Unlike cv2.inpaint
    # (which diffuses from the boundary inward and leaves a gradient for
    # thick masks) or per-CC ring-median (which on connected road networks
    # gets dominated by the biggest adjacent region), this preserves LOCAL
    # context: a road pixel inside Central Valley gets green, a road pixel
    # in Guanacaste gets tan. That is exactly what we need so K-means sees
    # region colour at road positions, not a global average.
    result = _fill_via_nearest_image_pixel(img_bgr, road_mask)

    print(f"  [RoadInpaint] Nearest-neighbour filled {mask_count} road px (max_thickness={max_thickness_px}px)")
    return result, road_mask


def _fill_via_nearest_image_pixel(img_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Replace every `mask != 0` pixel with the colour of its nearest
    `mask == 0` neighbour (L2 distance, scanned via distance-transform).

    Works by building a seed map of non-mask pixels, running
    distanceTransformWithLabels to get the nearest-seed index at each mask
    pixel, then looking up that seed's (y, x) to copy its RGB. Cost is
    O(H*W) regardless of mask size or CC structure.
    """
    if int(mask.sum()) == 0:
        return img_bgr.copy()
    non_mask = ((mask == 0).astype(np.uint8)) * 255
    _, labels_idx = cv2.distanceTransformWithLabels(
        non_mask,
        cv2.DIST_L2,
        3,
        labelType=cv2.DIST_LABEL_PIXEL,
    )
    seed_ys, seed_xs = np.nonzero(non_mask > 0)
    if len(seed_ys) == 0:
        return img_bgr.copy()
    holes = mask.astype(bool)
    hole_seed_idx = np.clip(labels_idx[holes] - 1, 0, len(seed_ys) - 1)
    src_y = seed_ys[hole_seed_idx]
    src_x = seed_xs[hole_seed_idx]
    result = img_bgr.copy()
    result[holes] = img_bgr[src_y, src_x]
    return result


def _detect_saturated_text(img_bgr: np.ndarray, res_scale: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Catch highly-saturated thin features that `remove_colored_lines`'
    thickness filter misses — i.e. teal/blue text labels on Wikivoyage maps
    (e.g. "Dominical", "Gulf of Nicoya") where the letter bodies are wider
    than the 12 px run-length threshold.

    Thresholding on SATURATION (not hue) is the clean way to separate text
    from the surrounding pastel region: region fills are typically <40 %
    saturated (HSV S <= ~100 on 0-255 scale), while text ink is near 100 %
    saturated (HSV S >= ~200). A single threshold at S > 120 excludes all
    realistic region backgrounds and keeps only ink-like pixels.

    CCs are kept if they look letter-shaped: area in a letter range, max
    thickness ≤ a letter-stem ceiling. Everything else (full-saturation
    regions like a tiny red flag or large coloured polygon in some exotic
    map) is ignored.

    Returns (result_bgr, text_mask).
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    sat_mask = (hsv[:, :, 1] > 120).astype(np.uint8)

    if int(sat_mask.sum()) == 0:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(sat_mask)
    if num_cc <= 1:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Letter-size bounds. At pipeline resolution 800 px, a word like
    # "Dominical" breaks into ~8 letter CCs of 40–250 px each. Larger label
    # words ("Manuel Antonio National Park") yield CCs up to ~1500 px.
    min_area = max(10, round(15 * res_scale * res_scale))
    max_area = max(1500, round(2000 * res_scale * res_scale))
    # Stem-thickness ceiling: regions are pastel (S <= ~100) and get filtered
    # out by the S > 120 gate above; anything remaining that is highly
    # saturated is ink. Keep a generous letter-stem ceiling (~22 px) so that
    # stylized teal labels like "Dominical" — whose bodies are 18-22 px wide
    # at 800 px pipeline resolution — are still caught.
    max_thickness_px = max(8, round(22 * res_scale))

    dist = cv2.distanceTransform(sat_mask, cv2.DIST_L2, 3)

    text_mask = np.zeros_like(sat_mask)
    kept_ccs = 0
    for ci in range(1, num_cc):
        area = int(cc_stats[ci, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        cc_pixels = cc_labels == ci
        cc_max_dist = float(dist[cc_pixels].max())
        if cc_max_dist > max_thickness_px:
            continue
        text_mask[cc_pixels] = 1
        kept_ccs += 1

    if int(text_mask.sum()) == 0:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Flat-fill each CC with the median colour of its 5 px ring.
    result = img_bgr.copy()
    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    num_kept, kept_labels, _, _ = cv2.connectedComponentsWithStats(text_mask)
    flat_filled = 0
    for ci in range(1, num_kept):
        cc_mask = (kept_labels == ci).astype(np.uint8)
        dilated = cv2.dilate(cc_mask, ring_kernel)
        ring = (dilated > 0) & (cc_mask == 0) & (text_mask == 0)
        if int(ring.sum()) < 10:
            continue
        ring_pixels = img_bgr[ring]
        median_bgr = np.median(ring_pixels, axis=0).astype(np.uint8)
        result[cc_mask > 0] = median_bgr
        flat_filled += int(cc_mask.sum())

    print(
        f"  [SatText] Flat-filled {flat_filled} px in {kept_ccs} saturated CCs "
        f"(area {min_area}..{max_area}, thickness ≤ {max_thickness_px})"
    )
    return result, text_mask


def _detect_dark_text_residue(img_bgr: np.ndarray, res_scale: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Detect residual dark-on-light text features not caught by OCR, and
    flat-fill each with the median color of its surrounding ring.

    Returns (result_bgr, text_mask) — text_mask is uint8 2D, non-zero where a
    thin dark residue CC was flat-filled.

    Uses local contrast + shape analysis instead of a trained OCR model:
    - Gaussian-blur the image (σ=10) to get "smooth" reference.
    - Per-pixel absolute difference from smooth reference → local contrast.
    - Threshold contrast → binary mask.
    - Keep only thin (max distance transform ≤ 4px scaled) and small-area CCs.

    Applied between `remove_colored_lines` and mean-shift. Targets labels like
    "Dominical" that EasyOCR misses but which survive into mean-shift as
    visible text in cluster output.
    """
    # Local contrast: how far each pixel deviates from its smooth neighborhood
    smooth = cv2.GaussianBlur(img_bgr, (0, 0), sigmaX=10.0)
    diff = cv2.absdiff(img_bgr, smooth).max(axis=2)  # max across channels
    contrast_thresh = 15
    contrast_mask = (diff > contrast_thresh).astype(np.uint8)

    if int(contrast_mask.sum()) == 0:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Connected components analysis
    num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(contrast_mask)
    if num_cc <= 1:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Distance transform to find per-CC thickness
    dist = cv2.distanceTransform(contrast_mask, cv2.DIST_L2, 3)
    max_thickness_px = max(3, round(4 * res_scale))
    min_area = max(10, round(20 * res_scale * res_scale))
    max_area = max(500, round(500 * res_scale * res_scale))

    text_mask = np.zeros_like(contrast_mask)
    for ci in range(1, num_cc):
        area = int(cc_stats[ci, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        cc_pixels = cc_labels == ci
        cc_max_dist = float(dist[cc_pixels].max())
        if cc_max_dist <= max_thickness_px:
            text_mask[cc_pixels] = 1

    if int(text_mask.sum()) == 0:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Flat-fill each CC with median BGR of 5px ring
    result = img_bgr.copy()
    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    num_kept, kept_labels, _, _ = cv2.connectedComponentsWithStats(text_mask)
    flat_filled = 0
    for ci in range(1, num_kept):
        cc_mask = (kept_labels == ci).astype(np.uint8)
        dilated = cv2.dilate(cc_mask, ring_kernel)
        ring = (dilated > 0) & (cc_mask == 0) & (text_mask == 0)
        if int(ring.sum()) < 10:
            continue
        ring_pixels = img_bgr[ring]
        median_bgr = np.median(ring_pixels, axis=0).astype(np.uint8)
        result[cc_mask > 0] = median_bgr
        flat_filled += int(cc_mask.sum())

    print(
        f"  [DarkTextResidue] Flat-filled {flat_filled} px in thin-dark CCs (area {min_area}..{max_area}, thickness ≤ {max_thickness_px})"
    )
    return result, text_mask


def remove_colored_lines(img_bgr: np.ndarray, res_scale: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Detect and remove vivid colored thin lines (roads, rivers, borders).

    Returns (cleaned_bgr, line_mask) where line_mask unions colored lines + thin
    dark text CCs (non-zero where replacement happened).

    Each detected CC is flat-filled with the MEDIAN OF ITS RING (the 1-to-5
    px band around the CC, excluding other mask pixels). Using a
    neighbourhood median-blur (the old approach) bled the road/line colour
    into surrounding region pixels, because for a 3-4 px thick line even a
    5x5 median window contains line pixels — the resulting "clean" fill
    carried a tint of the road. Ring-median fill, by construction, uses
    ONLY non-line pixels, so the replacement colour matches the adjacent
    region exactly and the road contributes no colour to later mean-shift /
    K-means steps.
    """
    max_thick = max(1, round(12 * res_scale))

    ctype = _classify_colored_pixels(img_bgr)
    min_run = _compute_run_lengths(ctype, max_run=max(1, round(14 * res_scale)))

    # Thin line mask: classified pixel with small run length
    line_mask = ((ctype > 0) & (min_run <= max_thick) & (min_run > 0)).astype(np.uint8)

    # Also detect DARK text/symbols: HSV Value < 120 AND thin (run length check)
    # Catches both black text (V<80) and dark-teal text (V 80-120) common on Wikivoyage maps
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    dark_mask = (hsv[:, :, 2] < 120).astype(np.uint8)
    # Dark pixels that form thin features (not large dark regions)
    dark_run = _compute_run_lengths(dark_mask, max_run=max(1, round(14 * res_scale)))
    dark_thin = ((dark_mask > 0) & (dark_run <= max_thick) & (dark_run > 0)).astype(np.uint8)

    # Combine colored lines + dark text
    combined_mask = np.maximum(line_mask, dark_thin)

    marked_count = int(np.sum(combined_mask))
    if marked_count == 0:
        return img_bgr.copy(), np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    # Replace marked pixels with median of a 5x5 window (per channel). This
    # is the historical Python line-removal behaviour — deliberately gentle:
    # for thin region borders between same-hue regions (e.g. Egypt's dashed
    # governorate borders in identically-tinted desert), the median of a
    # small window preserves a colour transition that k-means can still
    # pick up as a boundary. A nearest-neighbour fill would destroy that
    # transition and merge the regions.
    #
    # Roads wider than the 5-px window (e.g. Costa Rica's Inter-American
    # Hwy at 4-6 px) get partial residue here; _inpaint_colored_roads (for
    # the yellow/orange roads it catches) uses nearest-fill separately.
    # For red-hued roads that fall through to this function, mean-shift +
    # post-cleanup absorb the remaining residue.
    median_r = max(1, round(5 * res_scale))
    result = img_bgr.copy()
    ksize = 2 * median_r + 1
    for c in range(3):
        channel = img_bgr[:, :, c]
        med = cv2.medianBlur(channel, ksize)
        result[:, :, c] = np.where(combined_mask > 0, med, channel)

    colored_count = int(np.sum(line_mask))
    dark_count = int(np.sum(dark_thin)) - int(np.sum(line_mask & dark_thin))
    print(
        f"  [LineRemoval] Replaced {marked_count} pixels via {ksize}x{ksize} median (colored: {colored_count}, dark text: {dark_count})"
    )
    return result, combined_mask


# =============================================================================
# Step 2: Mean-shift filtering
# =============================================================================


def _tophat_text_removal(image: np.ndarray, kernel_size: int = 15) -> tuple[np.ndarray, np.ndarray]:
    """Remove thin text/symbols using morphological top-hat transforms.

    Black-hat detects dark thin features on lighter background (dark text).
    White-hat detects bright thin features on darker background (light text).
    Both are replaced with the morphological closing/opening result (smooth background).

    Returns (result_bgr, text_mask) where text_mask unions dark+bright text
    positions across the 3 channels.
    """
    result = image.copy()
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))

    h, w = image.shape[:2]
    any_text = np.zeros((h, w), dtype=np.uint8)

    # Process each channel
    total_replaced = 0
    for c in range(3):
        ch = image[:, :, c]

        # Black-hat: closing - original = dark thin features
        blackhat = cv2.morphologyEx(ch, cv2.MORPH_BLACKHAT, kernel)
        # White-hat: original - opening = bright thin features
        whitehat = cv2.morphologyEx(ch, cv2.MORPH_TOPHAT, kernel)

        # Threshold: significant features only
        dark_text = blackhat > 25
        bright_text = whitehat > 25

        # Replace dark text with closing result (smooth background)
        closed = cv2.morphologyEx(ch, cv2.MORPH_CLOSE, kernel)
        opened = cv2.morphologyEx(ch, cv2.MORPH_OPEN, kernel)

        result[:, :, c] = np.where(dark_text, closed, result[:, :, c])
        result[:, :, c] = np.where(bright_text, opened, result[:, :, c])

        any_text |= (dark_text | bright_text).astype(np.uint8)

        if c == 0:  # count only once
            total_replaced = int(np.sum(dark_text | bright_text))

    if total_replaced > 0:
        print(f"  [TopHat] Removed {total_replaced} text/thin-feature pixels via morphological top-hat")

    return result, any_text


def _remove_outlier_pixels(
    image: np.ndarray,
    kernel_size: int = 15,
    diff_threshold: int = 20,
    max_cc_size: int = 200,
) -> tuple[np.ndarray, np.ndarray]:
    """Remove pixels that differ significantly from their local neighborhood.
    After mean-shift, text/thin features appear as outliers vs smooth regions.
    Uses local median comparison + connected component filtering.

    Returns (result_bgr, text_mask).
    """
    result = image.copy()
    empty_mask = np.zeros(image.shape[:2], dtype=np.uint8)

    # Compute per-channel median
    med = np.zeros_like(image)
    for c in range(3):
        med[:, :, c] = cv2.medianBlur(image[:, :, c], kernel_size)

    # Find pixels differing from local median by > threshold (per-channel max)
    diff = np.abs(image.astype(np.int16) - med.astype(np.int16))
    max_diff = diff.max(axis=2)
    outlier_mask = (max_diff > diff_threshold).astype(np.uint8)

    if np.sum(outlier_mask) == 0:
        return result, empty_mask

    # Filter by CC size — only small CCs are text, large ones are real edges
    num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(outlier_mask)
    text_mask = np.zeros_like(outlier_mask)
    for i in range(1, num_cc):
        area = int(cc_stats[i, cv2.CC_STAT_AREA])
        if area <= max_cc_size:
            text_mask[cc_labels == i] = 1

    text_count = int(np.sum(text_mask))
    if text_count > 0:
        # Replace text pixels with local median
        for c in range(3):
            result[:, :, c] = np.where(text_mask > 0, med[:, :, c], image[:, :, c])
        print(f"  [TextCleanup] Replaced {text_count} outlier pixels (small CCs ≤ {max_cc_size}px)")

    return result, text_mask


def _exclude_decoration_ccs(
    country_mask: np.ndarray,
    filtered: np.ndarray,
    edge_pct: float = 0.25,
) -> np.ndarray:
    """Exclude isolated decoration CCs (title boxes, compass roses, scale bars)
    near any image edge.

    Finds connected components of the country mask. CCs that are:
    1. Not in the protected set (largest CCs forming >90% of country area)
    2. Near any image edge (centroid within edge_pct of any edge)
    3. Relatively small (< 8% of country)
    4. Have a regular shape (high bounding-box fill ratio, suggesting
       artificial rectangles/circles rather than natural coastlines)

    For very tiny CCs (<0.5%) near edges, always exclude regardless of shape.
    For larger CCs (>2%), also check color uniformity (decorations are solid).
    """
    h, w = country_mask.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return country_mask

    cm_binary = (country_mask > 0).astype(np.uint8) * 255
    num_cc, cc_labels, cc_stats, cc_centroids = cv2.connectedComponentsWithStats(cm_binary)

    # Edge zone boundaries (computed early for protection logic)
    bx = int(w * edge_pct)
    by = int(h * edge_pct)

    # Pre-compute edge map for internal edge density checks
    gray_for_edges = cv2.cvtColor(filtered, cv2.COLOR_BGR2GRAY)
    edge_map = cv2.Canny(gray_for_edges, 30, 80)

    # Build protected set: largest CCs forming >90% of country area,
    # but never protect CCs that look artificial (high fill + low variance).
    cc_list = [(i, int(cc_stats[i, cv2.CC_STAT_AREA])) for i in range(1, num_cc)]
    cc_list.sort(key=lambda x: -x[1])

    protected = set()
    cumulative = 0
    for cc_id, area in cc_list:
        pct = area / country_size * 100
        # Check if this CC looks artificial (solid rectangle near edge)
        cc_cx, cc_cy = cc_centroids[cc_id]
        cc_near_edge = cc_cx < bx or cc_cx > w - bx or cc_cy < by or cc_cy > h - by
        if cc_near_edge and pct < 20:
            cc_w_val = int(cc_stats[cc_id, cv2.CC_STAT_WIDTH])
            cc_h_val = int(cc_stats[cc_id, cv2.CC_STAT_HEIGHT])
            cc_bbox = cc_w_val * cc_h_val
            cc_fill = area / cc_bbox if cc_bbox > 0 else 0
            if cc_fill > 0.70:
                # Perfect rectangles (fill > 0.90) are ALWAYS artificial
                # (title boxes, scale bars) — no natural feature is a perfect rectangle
                if cc_fill > 0.90:
                    continue  # DON'T protect — definitely artificial
                cc_px = filtered[cc_labels == cc_id]
                cc_std = np.std(cc_px.astype(np.float32), axis=0).mean()
                # Relaxed std based on size and shape:
                # Small compact CCs (< 3%): std < 40 (compass elements)
                # Elongated compact CCs (aspect > 2.5): std < 55 (scale/title bars)
                # Large compact CCs (>= 3%): std < 12 (strict for real features)
                cc_aspect = max(cc_w_val, cc_h_val) / max(min(cc_w_val, cc_h_val), 1)
                if pct < 3:
                    cc_std_limit = 40
                elif cc_aspect > 2.5:
                    cc_std_limit = 55
                else:
                    cc_std_limit = 12
                if cc_std < cc_std_limit:
                    # This is likely a decoration — DON'T protect it
                    continue
        protected.add(cc_id)
        cumulative += area
        if cumulative / country_size >= 0.90 and area / country_size < 0.05:
            break

    result = country_mask.copy()
    excluded_total = 0

    for i in range(1, num_cc):
        if i in protected:
            continue

        area = int(cc_stats[i, cv2.CC_STAT_AREA])
        pct = area / country_size * 100
        cx, cy = cc_centroids[i]
        near_edge = cx < bx or cx > w - bx or cy < by or cy > h - by

        # Compute shape properties once (needed for both edge and interior checks)
        cc_w = int(cc_stats[i, cv2.CC_STAT_WIDTH])
        cc_h_val = int(cc_stats[i, cv2.CC_STAT_HEIGHT])
        bbox_area = cc_w * cc_h_val
        fill = area / bbox_area if bbox_area > 0 else 0

        # --- Interior isolated CCs (compass roses, dots, decoration elements) ---
        # Not near edges but clearly non-geographic: isolated, very compact, very uniform, small.
        # STRICT thresholds to avoid removing real islands (which can be compact at low resolution).
        # Circles have fill ~0.78, rectangles ~0.80+. Real islands rarely exceed 0.73.
        if not near_edge:
            if 0.2 <= pct <= 3.0 and fill >= 0.73:
                # Check isolation (not touching any protected CC)
                cc_mask_i = (cc_labels == i).astype(np.uint8)
                dilated_cc = cv2.dilate(cc_mask_i, np.ones((5, 5), np.uint8))
                touches_protected = False
                for p_id in protected:
                    if np.any(dilated_cc & (cc_labels == p_id).astype(np.uint8)):
                        touches_protected = True
                        break
                if not touches_protected:
                    cc_pixels = filtered[cc_labels == i]
                    color_std = np.std(cc_pixels.astype(np.float32), axis=0).mean()
                    if color_std <= 8:
                        result[cc_labels == i] = 0
                        excluded_total += area
                        print(
                            f"  [DecoCC] Excluded INTERIOR CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), fill={fill:.2f}, std={color_std:.1f}"
                        )
            continue  # Skip edge-based checks for non-edge CCs

        # --- Tier 2: Large CCs (8-20%) with VERY strict criteria ---
        # Only catch solid-color rectangles (title boxes).
        # Perfect rectangles (fill > 0.90) are ALWAYS artificial.
        if 8.0 < pct <= 20.0 and fill > 0.70:
            # Perfect rectangles bypass std check entirely
            if fill > 0.90:
                color_std = 0  # Force exclusion
            else:
                cc_pixels = filtered[cc_labels == i]
                color_std = np.std(cc_pixels.astype(np.float32), axis=0).mean()
            if color_std < 12 or fill > 0.90:
                # Also check not adjacent to main landmass
                cc_mask_i = (cc_labels == i).astype(np.uint8)
                dilated_cc = cv2.dilate(cc_mask_i, np.ones((3, 3), np.uint8))
                touches = False
                for p_id in protected:
                    if np.any(dilated_cc & (cc_labels == p_id).astype(np.uint8)):
                        touches = True
                        break
                if not touches:
                    result[cc_labels == i] = 0
                    excluded_total += area
                    print(
                        f"  [DecoCC] Excluded LARGE CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), fill={fill:.2f}, std={color_std:.1f}"
                    )
            continue  # Skip tier 1 checks for large CCs

        # --- Tier 1: Small/medium CCs (< 8%) ---
        if pct > 8.0:
            continue

        # Very tiny CCs near edges: always exclude (scale bar fragments, dots)
        if pct < 0.3:
            result[cc_labels == i] = 0
            excluded_total += area
            continue

        # Check if this CC is adjacent to any protected CC (touching the
        # main landmass). Real geographic features (peninsulas, border areas)
        # touch the mainland; decorations are isolated.
        cc_mask_i = (cc_labels == i).astype(np.uint8)
        dilated_cc = cv2.dilate(cc_mask_i, np.ones((3, 3), np.uint8))
        touches_protected = False
        for p_id in protected:
            if np.any(dilated_cc & (cc_labels == p_id).astype(np.uint8)):
                touches_protected = True
                break
        if touches_protected:
            continue  # Adjacent to main landmass — real feature

        # Check color uniformity (needed for multiple paths below)
        cc_pixels = filtered[cc_labels == i]
        color_std = np.std(cc_pixels.astype(np.float32), axis=0).mean()

        # --- Path 0: Small isolated CCs near edges with decoration evidence ---
        # Two sub-checks:
        # (a) Very uniform (std < 5): solid dots, compass circles, scale bars
        # (b) High internal edge density (>12%): text, compass symbols with
        #     arrows/letters. Real islands are smooth after mean-shift;
        #     decorations have internal high-contrast structure.
        if pct < 2.0:
            if color_std < 5:
                result[cc_labels == i] = 0
                excluded_total += area
                print(
                    f"  [DecoCC] Excluded SMALL UNIFORM CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), fill={fill:.2f}, std={color_std:.1f}"
                )
                continue

            cc_edge_pixels = int(np.sum((edge_map > 0) & (cc_labels == i)))
            internal_edge_ratio = cc_edge_pixels / max(area, 1)
            if internal_edge_ratio > 0.12:
                result[cc_labels == i] = 0
                excluded_total += area
                print(
                    f"  [DecoCC] Excluded DECORATION CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), edge_ratio={internal_edge_ratio:.2f}, std={color_std:.1f}"
                )
                continue

        # --- Path A: Elongated uniform elements (scale bars) ---
        # Scale bars are thin horizontal/vertical bars: aspect > 4, uniform.
        # Real islands almost never have aspect > 4 (very elongated).
        aspect = max(cc_w, cc_h_val) / max(min(cc_w, cc_h_val), 1)
        if aspect > 4 and color_std < 8 and pct < 3.0:
            result[cc_labels == i] = 0
            excluded_total += area
            print(
                f"  [DecoCC] Excluded ELONGATED CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), aspect={aspect:.1f}, std={color_std:.1f}"
            )
            continue

        # --- Path B: Compact shape check (original logic) ---
        # Rectangles: fill > 0.65, circles: fill ~0.78
        # Natural coastlines/islands: fill typically < 0.6
        if fill < 0.65:
            continue  # Irregular shape — likely a real island

        # Perfect rectangles (fill > 0.90) are ALWAYS decorations — skip std check
        if fill > 0.90:
            result[cc_labels == i] = 0
            excluded_total += area
            print(f"  [DecoCC] Excluded RECT CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), fill={fill:.2f}")
            continue

        # For larger CCs, verify color uniformity (decorations are solid).
        # Compact shapes (fill > 0.70) get relaxed thresholds.
        # Elongated compact shapes (aspect > 2.5) get even more relaxed — these are
        # scale bars/title bars, not natural features (islands are rarely elongated + compact).
        if pct > 1.5:
            if fill > 0.70:
                cc_aspect = max(cc_w, cc_h_val) / max(min(cc_w, cc_h_val), 1)
                std_limit = 55 if cc_aspect > 2.5 else 40
            else:
                std_limit = 15
            if color_std > std_limit:
                continue  # Varied colors — likely a real geographic feature

        result[cc_labels == i] = 0
        excluded_total += area
        print(f"  [DecoCC] Excluded CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), fill={fill:.2f}")

    if excluded_total > 0:
        print(f"  [DecoCC] Total excluded: {excluded_total} px in edge decoration CCs")

    return result


def _detect_inset_mask(image: np.ndarray) -> np.ndarray | None:
    """Detect inset box boundaries (Alaska/Hawaii style) using Hough lines.

    Looks for strong horizontal/vertical lines that span most of the image
    width/height. These dividing lines split the image into rectangular
    sections. The largest section is assumed to be the main map; all other
    sections are returned as an inset mask (to be added to background).

    Returns a binary mask (255 = inset region to exclude) or None if no
    inset boundaries detected.
    """
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Edge detection — use tight thresholds to catch the inset boundary lines
    edges = cv2.Canny(gray, 50, 150)

    # Hough line detection — look for strong lines
    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180, threshold=100, minLineLength=int(w * 0.4), maxLineGap=20)

    if lines is None:
        return None

    h_lines = []  # Strong horizontal lines (y positions)
    v_lines = []  # Strong vertical lines (x positions)

    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))

        # Horizontal line: angle near 0 or 180, spans >70% of width
        # Strict to avoid coastlines and other curved features
        if (angle < 3 or angle > 177) and abs(x2 - x1) > w * 0.7:
            # Must be in the inner 80% of the image (not near edges)
            avg_y = (y1 + y2) / 2
            if h * 0.15 < avg_y < h * 0.85:
                h_lines.append(avg_y)

        # Vertical line: angle near 90, spans >40% of height
        if 87 < angle < 93 and abs(y2 - y1) > h * 0.4:
            avg_x = (x1 + x2) / 2
            if w * 0.15 < avg_x < w * 0.85:
                v_lines.append(avg_x)

    if not h_lines and not v_lines:
        return None

    # Cluster nearby lines (within 15px) and take the median
    def cluster_lines(positions, min_gap=15):
        if not positions:
            return []
        positions = sorted(positions)
        clusters = [[positions[0]]]
        for p in positions[1:]:
            if p - clusters[-1][-1] < min_gap:
                clusters[-1].append(p)
            else:
                clusters.append([p])
        # Only keep clusters with at least 2 detections (strong evidence)
        return [int(np.median(c)) for c in clusters if len(c) >= 2]

    h_boundaries_raw = cluster_lines(h_lines)
    v_boundaries_raw = cluster_lines(v_lines)

    if not h_boundaries_raw and not v_boundaries_raw:
        return None

    # Validate boundaries with edge CONTINUITY check
    # A real inset boundary is a straight line with edge pixels in most columns/rows.
    # Coastlines have gaps. Check what fraction of columns (for H) or rows (for V)
    # have edge pixels within the band.
    def validate_h_boundary(y_pos):
        band = edges[max(0, y_pos - 3) : min(h, y_pos + 4), :]
        # Column coverage: how many columns have at least one edge pixel?
        col_has_edge = np.any(band > 0, axis=0)
        coverage = np.sum(col_has_edge) / max(w, 1)
        return coverage > 0.75  # >75% of columns must have an edge pixel (straight line)

    def validate_v_boundary(x_pos):
        band = edges[:, max(0, x_pos - 3) : min(w, x_pos + 4)]
        row_has_edge = np.any(band > 0, axis=1)
        coverage = np.sum(row_has_edge) / max(h, 1)
        return coverage > 0.75

    h_boundaries = [b for b in h_boundaries_raw if validate_h_boundary(b)]
    v_boundaries = [b for b in v_boundaries_raw if validate_v_boundary(b)]

    if not h_boundaries and not v_boundaries:
        return None

    # Build rectangular sections from the boundary lines
    y_cuts = [0] + h_boundaries + [h]
    x_cuts = [0] + v_boundaries + [w]

    sections = []
    for i in range(len(y_cuts) - 1):
        for j in range(len(x_cuts) - 1):
            y_start, y_end = y_cuts[i], y_cuts[i + 1]
            x_start, x_end = x_cuts[j], x_cuts[j + 1]
            area = (y_end - y_start) * (x_end - x_start)
            sections.append((y_start, y_end, x_start, x_end, area))

    if len(sections) < 2:
        return None

    # Find the largest section (main map)
    sections.sort(key=lambda s: -s[4])
    main_section = sections[0]

    # Only proceed if the main section is significantly larger than others
    # (at least 40% of total image area)
    total_area = h * w
    if main_section[4] < total_area * 0.4:
        return None

    # Create mask: mark non-main sections as insets
    inset_mask = np.zeros((h, w), dtype=np.uint8)
    for y_start, y_end, x_start, x_end, area in sections[1:]:
        # Only mask sections that are significantly smaller than main
        if area < main_section[4] * 0.8:
            inset_mask[y_start:y_end, x_start:x_end] = 255

    inset_total = int(np.sum(inset_mask > 0))
    if inset_total > 0:
        print(f"  [Inset] Detected {len(sections) - 1} inset section(s), masking {inset_total} px")
        print(
            f"  [Inset] Main section: y=[{main_section[0]},{main_section[1]}], x=[{main_section[2]},{main_section[3]}]"
        )
        for s in sections[1:]:
            if s[4] < main_section[4] * 0.8:
                print(f"  [Inset] Inset: y=[{s[0]},{s[1]}], x=[{s[2]},{s[3]}] ({s[4] / total_area * 100:.1f}%)")
        return inset_mask

    return None


def mean_shift_filter(image: np.ndarray, sp: int = 10, sr: int = 20) -> np.ndarray:
    """Apply pyrMeanShiftFiltering.
    OpenCV's implementation internally converts to Luv color space."""
    return cv2.pyrMeanShiftFiltering(image, sp, sr)


# =============================================================================
# Step 3: Two-stage background detection
# =============================================================================


def _flood_fill_mask(seed_mask: np.ndarray, similarity_mask: np.ndarray) -> np.ndarray:
    """Flood-fill from seed positions through similarity_mask.
    Both inputs are 2D uint8 arrays. Returns filled mask (uint8, 255=filled)."""
    h, w = seed_mask.shape

    # Use OpenCV floodFill with a combined approach:
    # Create a binary image where fillable = similarity_mask, seeds on edges
    result = np.zeros((h, w), dtype=np.uint8)

    # BFS from all seed positions
    seeds_y, seeds_x = np.where(seed_mask > 0)
    if len(seeds_y) == 0:
        return result

    visited = np.zeros((h, w), dtype=np.uint8)
    # Use a queue-based flood fill (vectorized where possible)
    stack = list(zip(seeds_y.tolist(), seeds_x.tolist(), strict=False))

    while stack:
        batch = stack[:10000]
        stack = stack[10000:]

        for y, x in batch:
            if visited[y, x]:
                continue
            visited[y, x] = 1
            if not similarity_mask[y, x]:
                continue
            result[y, x] = 255

            if y > 0 and not visited[y - 1, x]:
                stack.append((y - 1, x))
            if y < h - 1 and not visited[y + 1, x]:
                stack.append((y + 1, x))
            if x > 0 and not visited[y, x - 1]:
                stack.append((y, x - 1))
            if x < w - 1 and not visited[y, x + 1]:
                stack.append((y, x + 1))

    return result


def _rgb_distance_sq(img_bgr: np.ndarray, ref_bgr: np.ndarray) -> np.ndarray:
    """Compute squared RGB distance from each pixel to a reference color.
    ref_bgr is shape (3,). Returns float32 array."""
    diff = img_bgr.astype(np.float32) - ref_bgr.astype(np.float32)
    return np.sum(diff * diff, axis=2)


def detect_background(filtered: np.ndarray, original: np.ndarray) -> np.ndarray:
    """Two-stage background detection matching the JS pipeline.

    Stage 1: Average corner colors, flood-fill from corners with RGB distance <= 30.
    Stage 2: HSV saturation < 15 (gray detection) + morphological opening + edge flood-fill.
    Combine both stages.

    Uses the ORIGINAL (pre-mean-shift) image to avoid mean-shift desaturation artifacts.
    Returns binary mask: 255 = foreground (country), 0 = background.
    """
    h, w = original.shape[:2]
    img = original  # Use original for background detection

    # --- Stage 1: RGB flood-fill from corners ---
    # Sample corner pixels (8px inset from each corner)
    cp = min(CORNER_SAMPLE_PX, h // 4, w // 4)
    corners = [
        img[0:cp, 0:cp],
        img[0:cp, w - cp : w],
        img[h - cp : h, 0:cp],
        img[h - cp : h, w - cp : w],
    ]
    avg_bgr = np.mean([c.reshape(-1, 3).mean(axis=0) for c in corners], axis=0).astype(np.float32)

    # Pixels within RGB distance of corner average
    # Use per-channel max diff (not Euclidean) to avoid over-reaching into land areas
    # that share one channel with the sea but differ in others
    diff = np.abs(img.astype(np.float32) - avg_bgr[np.newaxis, np.newaxis, :])
    max_diff = diff.max(axis=2)
    similar_to_corner = (max_diff <= BG_RGB_DIST).astype(np.uint8)

    # Edge barrier: detect coastline edges to prevent flood-fill from
    # bleeding into land regions that have similar colors to the sea.
    # This is critical for maps like Iceland where the south coast
    # uses a teal color nearly identical to the ocean.
    gray_edge = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    coastline_edges = cv2.Canny(gray_edge, 25, 75)
    coastline_barrier = cv2.dilate(coastline_edges, np.ones((3, 3), np.uint8))
    similar_to_corner[coastline_barrier > 0] = 0

    # Seed from corner pixels
    corner_seeds = np.zeros((h, w), dtype=np.uint8)
    corner_seeds[0, 0] = 1
    corner_seeds[0, w - 1] = 1
    corner_seeds[h - 1, 0] = 1
    corner_seeds[h - 1, w - 1] = 1

    bg_rgb = _flood_fill_mask(corner_seeds, similar_to_corner)

    # --- Stage 2: Gray saturation detection ---
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    gray_raw = (sat < 15).astype(np.uint8) * 255

    # Morphological opening (5x5 ellipse) to remove thin border lines
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    gray_opened = cv2.morphologyEx(gray_raw, cv2.MORPH_OPEN, kernel)

    raw_count = int(np.sum(gray_raw > 0))
    open_count = int(np.sum(gray_opened > 0))
    if raw_count != open_count:
        print(f"  [BG] Gray opening: {raw_count} -> {open_count} px (removed {raw_count - open_count} thin features)")

    # Flood-fill from ALL image edges through opened gray mask
    edge_seeds = np.zeros((h, w), dtype=np.uint8)
    edge_seeds[0, :] = 1
    edge_seeds[h - 1, :] = 1
    edge_seeds[:, 0] = 1
    edge_seeds[:, w - 1] = 1
    # Only seed where gray_opened is set
    edge_seeds = edge_seeds & (gray_opened > 0).astype(np.uint8)

    bg_gray = _flood_fill_mask(edge_seeds, (gray_opened > 0).astype(np.uint8))

    filled_count = int(np.sum(bg_gray > 0))
    if filled_count != open_count:
        print(
            f"  [BG] Gray flood fill: {open_count} -> {filled_count} px ({open_count - filled_count} interior gray pixels kept as country)"
        )

    # Combine both stages
    bg_mask = np.maximum(bg_rgb, bg_gray)

    # Stage 3: Saturated edge flood fill — catches colored oceans (teal/cyan sea)
    # that Stage 1 (corner avg) and Stage 2 (gray) miss.
    # Uses the FILTERED image (post mean-shift) where text/wave patterns are smoothed.
    hsv_f = cv2.cvtColor(filtered, cv2.COLOR_BGR2HSV)
    sat_f = hsv_f[:, :, 1]

    # Find saturated pixels on image edges that are NOT yet background
    edge_band = np.zeros((h, w), dtype=bool)
    edge_band[:5, :] = True
    edge_band[-5:, :] = True
    edge_band[:, :5] = True
    edge_band[:, -5:] = True

    sat_edge = edge_band & (sat_f > 30) & (bg_mask == 0)
    sat_edge_count = int(np.sum(sat_edge))

    if sat_edge_count > 50:
        # Average color of saturated edge pixels from filtered image
        sat_ref = filtered[sat_edge].mean(axis=0).astype(np.float32)
        # Flood fill through filtered image (smoother, no text barriers)
        sat_diff = np.abs(filtered.astype(np.float32) - sat_ref[np.newaxis, np.newaxis, :])
        sat_max_diff = sat_diff.max(axis=2)
        sat_similar = (sat_max_diff <= 35).astype(np.uint8)
        # Apply coastline edge barrier to prevent bleeding into land
        sat_similar[coastline_barrier > 0] = 0
        sat_seeds = sat_edge.astype(np.uint8)
        bg_sat = _flood_fill_mask(sat_seeds, sat_similar)
        sat_filled = int(np.sum(bg_sat > 0))
        if sat_filled > 0:
            print(
                f"  [BG] Saturated edge fill: {sat_filled} px (ref BGR({sat_ref[0]:.0f},{sat_ref[1]:.0f},{sat_ref[2]:.0f}))"
            )
            bg_mask = np.maximum(bg_mask, bg_sat)

    # Stage 4: Morphological closing to fill wave pattern gaps in the sea
    # Wave patterns (dotted texture in sea area) create small holes in the background mask.
    # Closing (dilate then erode) fills these holes without affecting the coastline.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    bg_closed = cv2.morphologyEx(bg_mask, cv2.MORPH_CLOSE, close_kernel)
    wave_filled = int(np.sum(bg_closed > 0)) - int(np.sum(bg_mask > 0))
    if wave_filled > 0:
        print(f"  [BG] Wave pattern fill: {wave_filled} px filled by morphological closing")
    bg_mask = bg_closed

    country_mask = cv2.bitwise_not(bg_mask)

    bg_total = int(np.sum(bg_mask > 0))
    print(f"  [BG] Background: {bg_total} px (RGB fill: {int(np.sum(bg_rgb > 0))}, gray fill: {filled_count})")

    return country_mask


# =============================================================================
# Step 4: Water detection on ORIGINAL image
# =============================================================================


def detect_water(
    original: np.ndarray,
    country_mask: np.ndarray,
) -> tuple[np.ndarray, list, tuple[int, int, int] | None]:
    """Water detection using edge HSV seeding + flood-fill on original image + inland lakes.

    Returns (water_mask, water_components, ref_color_bgr_or_None).
    """
    h, w = original.shape[:2]
    tp = h * w
    img = original  # Water detection on ORIGINAL, not filtered

    # Convert to HSV for edge pixel detection
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # --- Collect edge pixels that look like water ---
    # Sample 5px bands on all four edges
    edge_mask = np.zeros((h, w), dtype=bool)
    edge_mask[:5, :] = True  # top 5 rows
    edge_mask[-5:, :] = True  # bottom 5 rows
    edge_mask[:, :5] = True  # left 5 cols
    edge_mask[:, -5:] = True  # right 5 cols

    h_channel = hsv[:, :, 0].astype(np.int32)  # OpenCV HSV: H is 0-179
    s_channel = hsv[:, :, 1].astype(np.int32)

    # OpenCV HSV hue is 0-179 (half degrees). Convert thresholds:
    # JS uses 0-255 for H in OpenCV format, but our JS actually uses 0-180 range
    # WATER_H_MIN=70, WATER_H_MAX=140 are in OpenCV 0-180 scale
    water_hue = (h_channel >= WATER_H_MIN) & (h_channel <= WATER_H_MAX)
    water_sat = s_channel > WATER_S_MIN
    water_edge = edge_mask & water_hue & water_sat

    water_edge_count = int(np.sum(water_edge))
    if water_edge_count == 0:
        print("  [Water] No water-colored pixels found on edges")
        empty_mask = np.zeros((h, w), dtype=np.uint8)
        return empty_mask, [], None

    # Average water reference color from edge seed pixels (in BGR)
    water_pixels = img[water_edge]
    ref_bgr = water_pixels.mean(axis=0).astype(np.float32)
    print(
        f"  [Water] Edge seeds: {water_edge_count} px, ref color BGR({ref_bgr[0]:.0f},{ref_bgr[1]:.0f},{ref_bgr[2]:.0f})"
    )

    # --- Flood-fill from water seeds using per-channel max diff ---
    # Use slightly wider tolerance (40) than background (30) because
    # sea/ocean color varies more than gray backgrounds (lighter near
    # coast, darker in deep sea, different hue near land).
    water_tolerance = 40
    diff = np.abs(img.astype(np.float32) - ref_bgr[np.newaxis, np.newaxis, :])
    max_diff = diff.max(axis=2)
    similar = (max_diff <= water_tolerance).astype(np.uint8)

    # Edge-guided barrier: detect strong edges (coastlines) and block flood-fill
    # This prevents water from bleeding into coastal regions with similar colors
    gray_for_edges = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray_for_edges, 30, 80)
    # Dilate edges slightly to create a solid barrier
    edge_barrier = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    # Block similar pixels at edge locations
    similar[edge_barrier > 0] = 0

    seed_positions = water_edge.astype(np.uint8)
    water_mask_raw = _flood_fill_mask(seed_positions, similar)

    # --- Inland lake detection ---
    # Find connected components of pixels within per-channel max diff 25 of water reference
    inland_diff = np.abs(img.astype(np.float32) - ref_bgr[np.newaxis, np.newaxis, :])
    inland_max_diff = inland_diff.max(axis=2)
    water_like = (inland_max_diff <= 25).astype(np.uint8)
    # Exclude already-detected water and background
    water_like[water_mask_raw > 0] = 0
    water_like[country_mask == 0] = 0

    # Find CCs, keep those >= 0.5% of image area
    num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(water_like)
    min_lake_size = max(100, round(tp * 0.005))
    inland_mask = np.zeros((h, w), dtype=np.uint8)
    inland_count = 0

    for i in range(1, num_cc):
        area = int(cc_stats[i, cv2.CC_STAT_AREA])
        if area >= min_lake_size:
            inland_mask[cc_labels == i] = 255
            inland_count += area

    if inland_count > 0:
        print(f"  [Water] Inland lakes: {inland_count} px (min CC size: {min_lake_size})")

    # Combine coastal water + inland lakes
    water_mask = np.maximum(water_mask_raw, inland_mask)

    # Intersect with country mask (don't mark background as water)
    water_mask = cv2.bitwise_and(water_mask, country_mask)

    # Build component info for review
    total_country = int(np.sum(country_mask > 0))
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(water_mask)
    components = []
    for i in range(1, num_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        pct = round(area / max(total_country, 1) * 100, 1)
        if pct >= 0.5:
            components.append({"id": i, "pct": pct})

    ref_color = (int(ref_bgr[0]), int(ref_bgr[1]), int(ref_bgr[2]))
    return water_mask, components, ref_color


def _review_water_components(
    original: np.ndarray,
    water_mask: np.ndarray,
    components: list[dict],
    country_mask: np.ndarray,
    on_review: callable,
    progress: callable,
) -> np.ndarray:
    """Emit a water-review request and apply the operator's per-component decisions.

    Each detected water component gets a small data-URL crop so the frontend
    can show a thumbnail in the existing water-review UI. The operator marks
    each as 'water' (keep), 'region' (unmark as water), or 'mix' (no-op for
    now — Python path doesn't support sub-cluster approval yet).

    Returns the (possibly filtered) water_mask. If the review times out or
    returns nothing, the original mask is returned unchanged.
    """
    # Encode each component as a small cropped PNG (same shape the JS path uses)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(water_mask)
    total_country = int(np.sum(country_mask > 0))
    total_water = int(np.sum(water_mask > 0))
    water_pct = round(total_water / max(total_country, 1) * 100, 1)

    payload_components = []
    for comp in components:
        cid = comp["id"]
        if cid >= num_labels:
            continue
        x = int(stats[cid, cv2.CC_STAT_LEFT])
        y = int(stats[cid, cv2.CC_STAT_TOP])
        w = int(stats[cid, cv2.CC_STAT_WIDTH])
        h = int(stats[cid, cv2.CC_STAT_HEIGHT])
        # Crop with a small margin for context; cap crop dimension to keep
        # the data URL reasonable (we display thumbnails, not full images).
        pad = 20
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(original.shape[1], x + w + pad), min(original.shape[0], y + h + pad)
        crop = original[y0:y1, x0:x1].copy()
        if crop.size == 0:
            continue
        # Draw a magenta outline around the component's pixels so the operator
        # can tell which region is being proposed as water (matches JS path's
        # generateOutlineCrop). Uses the original un-resized label map to get
        # accurate boundaries, drawn onto the crop before any resize.
        comp_mask = ((labels[y0:y1, x0:x1] == cid).astype(np.uint8)) * 255
        contours, _ = cv2.findContours(comp_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if contours:
            cv2.drawContours(crop, contours, -1, (255, 0, 255), 2)  # BGR magenta
        # Resize very large crops down for transport
        crop_h, crop_w = crop.shape[:2]
        max_dim = 400
        if max(crop_h, crop_w) > max_dim:
            scale = max_dim / max(crop_h, crop_w)
            crop = cv2.resize(crop, (int(crop_w * scale), int(crop_h * scale)))
        # encode_png_base64 already returns a full "data:image/png;base64,..." URL
        payload_components.append(
            {
                "id": cid,
                "pct": comp["pct"],
                "cropDataUrl": encode_png_base64(crop),
                "subClusters": [],
            }
        )

    if not payload_components:
        return water_mask

    # Overlay the detected water on the original image so the operator can see
    # the whole mask at once (the per-component crops don't show overall extent).
    overlay = original.copy()
    water_pixels_mask = water_mask > 0
    if np.any(water_pixels_mask):
        tint = np.full_like(overlay, [255, 128, 80], dtype=np.uint8)  # BGR: orange-ish
        overlay[water_pixels_mask] = cv2.addWeighted(
            overlay[water_pixels_mask],
            0.45,
            tint[water_pixels_mask],
            0.55,
            0,
        )
    # encode_png_base64 already returns a full "data:image/png;base64,..." URL
    overlay_data_url = encode_png_base64(overlay)

    progress(f"Water review — {len(payload_components)} component(s), {water_pct}% of country")
    response = on_review(
        "water",
        {
            "components": payload_components,
            "waterPxPercent": water_pct,
            "waterMaskImage": overlay_data_url,
        },
    )

    if not response:
        # Timed out or empty — keep auto-detection as-is.
        return water_mask

    # Apply per-component decisions. Response shape matches the JS/frontend
    # format so the existing CvWaterReviewSection needs zero changes:
    #   { "approvedIds": [int, ...],           # components to keep as water
    #     "mixDecisions": [ { componentId, approvedSubClusters: [...] }, ... ] }
    # Any component in payload_components whose id is NOT in approvedIds AND
    # NOT in mixDecisions is treated as 'region' (unmask). Python does not
    # currently support sub-cluster approval so mix entries are kept as-is.
    approved_ids = {int(i) for i in response.get("approvedIds", [])}
    mix_ids = {int(m.get("componentId", -1)) for m in response.get("mixDecisions", [])}

    out_mask = water_mask.copy()
    removed_count = 0
    for c in payload_components:
        cid = int(c["id"])
        if cid in approved_ids or cid in mix_ids:
            continue
        if cid < num_labels:
            out_mask[labels == cid] = 0
            removed_count += 1
    progress(f"Water review applied: {removed_count} component(s) unmasked (operator marked as region)")
    return out_mask


_sam_predictor = None


def _get_sam_predictor():
    """Lazy-load SAM predictor (heavy model, ~5s first call)."""
    global _sam_predictor
    if _sam_predictor is None:
        import os

        model_path = "/app/data/sam_vit_b.pth"
        if not os.path.exists(model_path):
            return None
        try:
            from segment_anything import SamPredictor, sam_model_registry

            sam = sam_model_registry["vit_b"](checkpoint=model_path)
            _sam_predictor = SamPredictor(sam)
        except ImportError:
            print("  [SAM] segment_anything not installed — skipping SAM decoration detection")
            return None
    return _sam_predictor


def _sam_exclude_decorations(
    country_mask: np.ndarray,
    filtered: np.ndarray,
    max_cc_pct: float = 1.5,
    min_cc_area: int = 100,
) -> np.ndarray:
    """Use SAM to precisely segment and exclude remaining decoration elements.

    For each isolated CC (not connected to main landmass) that's small enough
    to be a decoration, use SAM with a point prompt at the CC's centroid.
    SAM produces a precise segmentation mask that can cover decoration pixels
    that CC analysis misses (anti-aliased edges, mixed-color areas).

    Only runs if SAM model is available. Falls back gracefully if not.
    """
    predictor = _get_sam_predictor()
    if predictor is None:
        return country_mask

    h, w = country_mask.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return country_mask

    cm_binary = (country_mask > 0).astype(np.uint8) * 255
    num_cc, cc_labels, cc_stats, cc_centroids = cv2.connectedComponentsWithStats(cm_binary)
    if num_cc <= 2:
        return country_mask

    main_idx = max(range(1, num_cc), key=lambda i: int(cc_stats[i, cv2.CC_STAT_AREA]))
    main_mask = (cc_labels == main_idx).astype(np.uint8)
    main_dil = cv2.dilate(main_mask, np.ones((7, 7), np.uint8))

    # Find isolated CCs to prompt SAM
    prompt_points = []
    for i in range(1, num_cc):
        if i == main_idx:
            continue
        area = int(cc_stats[i, cv2.CC_STAT_AREA])
        pct = area / country_size * 100
        if pct > max_cc_pct or area < min_cc_area:
            continue

        cc_m = (cc_labels == i).astype(np.uint8)
        if np.any(cv2.dilate(cc_m, np.ones((5, 5), np.uint8)) & main_dil):
            continue  # Connected to mainland

        # Only prompt SAM at COMPACT CCs (fill > 0.55) — decorations are circles/rectangles,
        # real islands have irregular coastlines with lower fill
        cc_w = int(cc_stats[i, cv2.CC_STAT_WIDTH])
        cc_h_val = int(cc_stats[i, cv2.CC_STAT_HEIGHT])
        bbox_area = cc_w * cc_h_val
        fill = area / bbox_area if bbox_area > 0 else 0
        if fill < 0.70:
            continue  # Not compact enough — likely a real island

        cx, cy = cc_centroids[i]
        prompt_points.append((int(cx), int(cy), area))

    if not prompt_points:
        return country_mask

    # Set image for SAM
    rgb = cv2.cvtColor(filtered, cv2.COLOR_BGR2RGB)
    predictor.set_image(rgb)

    result = country_mask.copy()
    total_excluded = 0

    for cx, cy, cc_area in prompt_points:
        point = np.array([[cx, cy]])
        label = np.array([1])

        masks, scores, _ = predictor.predict(point_coords=point, point_labels=label, multimask_output=True)

        # Take the smallest mask (most specific) with decent score
        valid = [(m, s) for m, s in zip(masks, scores, strict=False) if s > 0.8]
        if not valid:
            continue

        best_mask, best_score = min(valid, key=lambda x: x[0].sum())
        mask_area = int(best_mask.sum())

        # Only use if mask is reasonable size (< 5% of country, not too much bigger than CC)
        if mask_area > country_size * 0.05 or mask_area > cc_area * 10:
            continue

        result[best_mask] = 0
        total_excluded += mask_area

    if total_excluded > 0:
        print(f"  [SAM] Excluded {total_excluded} px via SAM segmentation ({len(prompt_points)} prompts)")

    return result


def _exclude_isolated_cc_groups(
    country_mask: np.ndarray,
    filtered: np.ndarray,
    group_dist: int = 60,
    min_group_size: int = 3,
    max_cc_pct: float = 5.0,
) -> np.ndarray:
    """Exclude groups of nearby isolated CCs that are likely decoration elements.

    Compass roses, legends, and scale bars consist of multiple small elements
    (circles, letters, lines, dots) that appear as separate CCs but cluster
    together. Real islands are typically spread apart or form archipelagos
    with consistent patterns.

    Groups 3+ isolated CCs within group_dist pixels of each other.
    Each CC must be < max_cc_pct and not connected to the main landmass.
    """
    h, w = country_mask.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return country_mask

    cm_binary = (country_mask > 0).astype(np.uint8) * 255
    num_cc, cc_labels, cc_stats, cc_centroids = cv2.connectedComponentsWithStats(cm_binary)
    if num_cc <= 2:
        return country_mask

    # Find main landmass
    main_idx = max(range(1, num_cc), key=lambda i: int(cc_stats[i, cv2.CC_STAT_AREA]))
    main_mask = (cc_labels == main_idx).astype(np.uint8)
    main_dil = cv2.dilate(main_mask, np.ones((7, 7), np.uint8))

    # Collect isolated small CCs
    isolated = []
    for i in range(1, num_cc):
        if i == main_idx:
            continue
        area = int(cc_stats[i, cv2.CC_STAT_AREA])
        pct = area / country_size * 100
        if pct > max_cc_pct or area < 20:
            continue
        cx, cy = cc_centroids[i]

        # Check isolation
        cc_m = (cc_labels == i).astype(np.uint8)
        if np.any(cv2.dilate(cc_m, np.ones((5, 5), np.uint8)) & main_dil):
            continue  # Touches main landmass

        isolated.append((i, cx, cy, area))

    if len(isolated) < min_group_size:
        return country_mask

    # Group isolated CCs by proximity
    used = set()
    groups = []
    for idx, (_cc_id, cx1, cy1, _a1) in enumerate(isolated):
        if idx in used:
            continue
        group = [idx]
        used.add(idx)
        for jdx, (_cc_id2, cx2, cy2, _a2) in enumerate(isolated):
            if jdx in used:
                continue
            dist = np.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)
            if dist < group_dist:
                group.append(jdx)
                used.add(jdx)
        groups.append(group)

    # Exclude groups with 3+ members
    result = country_mask.copy()
    total_excluded = 0
    for group in groups:
        if len(group) < min_group_size:
            continue
        group_area = sum(isolated[idx][3] for idx in group)
        group_pct = group_area / country_size * 100
        if group_pct > 10:
            continue  # Too large to be decoration

        for idx in group:
            cc_id = isolated[idx][0]
            result[cc_labels == cc_id] = 0
            total_excluded += isolated[idx][3]

    if total_excluded > 0:
        group_count = sum(1 for g in groups if len(g) >= min_group_size)
        print(f"  [CCGroup] Excluded {total_excluded} px in {group_count} isolated CC group(s)")

    return result


def _exclude_hough_circles(
    country_mask: np.ndarray,
    filtered: np.ndarray,
    min_radius: int = 8,
    max_radius: int = 30,
) -> np.ndarray:
    """Detect circular decoration elements using Hough circle transform.

    Compass roses, compass dots, and circular markers are characterized by
    their circular boundary — unlike geographic coastlines. HoughCircles
    with strict parameters (dp=1.0) finds only well-defined circles.

    Only excludes circles that are:
    1. Inside the country mask (not already background)
    2. In an isolated CC (not connected to the main landmass)
    3. Small relative to country (< 5%)
    """
    h, w = country_mask.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return country_mask

    gray = cv2.cvtColor(filtered, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (9, 9), 2)

    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=20,
        param1=100,
        param2=30,
        minRadius=min_radius,
        maxRadius=max_radius,
    )

    if circles is None:
        return country_mask

    # Find isolated CCs for the adjacency check
    cm_binary = (country_mask > 0).astype(np.uint8) * 255
    num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(cm_binary)
    main_cc = max(range(1, num_cc), key=lambda i: int(cc_stats[i, cv2.CC_STAT_AREA])) if num_cc > 1 else 0
    main_mask = (cc_labels == main_cc).astype(np.uint8)
    main_dilated = cv2.dilate(main_mask, np.ones((7, 7), np.uint8))

    result = country_mask.copy()
    excluded = 0

    for c in circles[0]:
        cx, cy, r = int(c[0]), int(c[1]), int(c[2])

        # Check if center is in country mask
        if 0 <= cy < h and 0 <= cx < w and country_mask[cy, cx] == 0:
            continue  # Center is in background

        # Find which CC the center belongs to
        cc_id = cc_labels[cy, cx] if 0 <= cy < h and 0 <= cx < w else 0
        if cc_id == main_cc or cc_id == 0:
            continue  # Part of main landmass or background

        # Check CC size
        cc_area = int(cc_stats[cc_id, cv2.CC_STAT_AREA])
        if cc_area / country_size > 0.05:
            continue  # Too large — likely a real island

        # Check if this CC touches the main landmass
        cc_mask = (cc_labels == cc_id).astype(np.uint8)
        if np.any(cv2.dilate(cc_mask, np.ones((3, 3), np.uint8)) & main_dilated):
            continue  # Connected to mainland

        # Exclude a circle area (with padding) from country mask
        circle_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(circle_mask, (cx, cy), r + 3, 255, -1)
        removed = int(np.sum((circle_mask > 0) & (result > 0)))
        result[circle_mask > 0] = 0
        excluded += removed

    if excluded > 0:
        print(f"  [HoughCircle] Excluded {excluded} px in {len(circles[0])} detected circles")

    return result


def _remove_dark_blobs(
    image: np.ndarray,
    min_area: int = 30,
    max_area: int = 1500,
    min_circularity: float = 0.4,
    dark_threshold: int = 140,
) -> np.ndarray:
    """Detect and remove small dark circular blobs (city markers, compass dots).

    Uses OpenCV's SimpleBlobDetector to find dark circular elements, then
    replaces them with the local median color. These blobs are typically:
    - City/airport markers (dark dots on lighter regions)
    - Compass rose dots
    - National park markers (e.g., Kakadu on Australia)
    - Highway intersection markers

    Also detects high-saturation colored dots by converting to inverted
    saturation channel (catches blue/teal dots that aren't dark in grayscale).
    """
    result = image.copy()
    total_removed = 0
    all_keypoints = []

    # Pass 1: Dark blobs in grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    params = cv2.SimpleBlobDetector_Params()
    params.filterByColor = True
    params.blobColor = 0  # Dark blobs
    params.filterByArea = True
    params.minArea = min_area
    params.maxArea = max_area
    params.filterByCircularity = True
    params.minCircularity = min_circularity
    params.filterByConvexity = True
    params.minConvexity = 0.5
    params.filterByInertia = False
    params.minThreshold = 10
    params.maxThreshold = dark_threshold
    params.thresholdStep = 10

    detector = cv2.SimpleBlobDetector_create(params)
    all_keypoints.extend(detector.detect(gray))

    if not all_keypoints:
        return image

    # Deduplicate keypoints (pass 1 and 2 might find the same blob)
    used = set()
    for kp in all_keypoints:
        x, y = int(kp.pt[0]), int(kp.pt[1])
        key = (x // 5, y // 5)  # Grid-based dedup (5px tolerance)
        if key in used:
            continue
        used.add(key)

        r = max(int(kp.size / 2) + 2, 5)
        h, w = image.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(mask, (x, y), r, 255, -1)

        ksize = 2 * r + 5
        if ksize % 2 == 0:
            ksize += 1
        ksize = min(ksize, 31)
        for c in range(3):
            med = cv2.medianBlur(image[:, :, c], ksize)
            result[:, :, c] = np.where(mask > 0, med, result[:, :, c])

        total_removed += int(np.sum(mask > 0))

    if total_removed > 0:
        print(f"  [BlobRemove] Detected {len(used)} blobs (dark+colored), replaced {total_removed} px")

    return result


def _insert_edge_barriers(
    country_mask: np.ndarray,
    original: np.ndarray,
    canny_low: int = 30,
    canny_high: int = 80,
    dilate_px: int = 2,
    min_color_diff: float = 15.0,
) -> np.ndarray:
    """Insert thin barriers along strong color edges within the country mask.

    Province boundaries on maps are where one colored region meets another.
    Mean-shift filtering blurs these boundaries, causing K-means to merge
    adjacent provinces with similar colors (e.g., Heredia's pink blends into
    San José's green). By detecting edges in the ORIGINAL (pre-mean-shift)
    image and zeroing those pixels in the country mask, we create physical
    barriers that force K-means to cluster each province independently.

    Only keeps edges where the colors on both sides differ by at least
    `min_color_diff` in RGB space — this filters out texture edges within
    a single province (noise, text residue) while preserving real province
    boundaries.
    """
    h, w = country_mask.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return country_mask

    # Canny edge detection on the original image (BGR → gray)
    gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, canny_low, canny_high)

    # Only keep edges inside the country mask
    edges = edges & (country_mask > 0).astype(np.uint8) * 255

    # Filter: keep only edges where the two sides have different colors.
    # For each edge pixel, sample colors on both sides (perpendicular to
    # the local gradient direction) and keep only if they differ enough.
    # Approximate: for each edge pixel, look at the 4-neighbors' colors
    # and check if max color difference exceeds threshold.
    blurred = cv2.GaussianBlur(original, (5, 5), 0)  # slight blur for stability
    significant_edges = np.zeros((h, w), dtype=np.uint8)

    edge_ys, edge_xs = np.where(edges > 0)
    if len(edge_ys) == 0:
        return country_mask

    for ey, ex in zip(edge_ys, edge_xs, strict=False):
        # Sample colors from 4-neighbors that are inside country_mask
        colors = []
        for dy, dx in [(-2, 0), (2, 0), (0, -2), (0, 2)]:
            ny, nx = ey + dy, ex + dx
            if 0 <= ny < h and 0 <= nx < w and country_mask[ny, nx] > 0:
                colors.append(blurred[ny, nx].astype(np.float32))

        if len(colors) >= 2:
            # Max pairwise RGB distance among neighbors
            max_diff = 0.0
            for i in range(len(colors)):
                for j in range(i + 1, len(colors)):
                    diff = np.sqrt(np.sum((colors[i] - colors[j]) ** 2))
                    max_diff = max(max_diff, diff)
            if max_diff >= min_color_diff:
                significant_edges[ey, ex] = 255

    if int(np.sum(significant_edges > 0)) == 0:
        return country_mask

    # Dilate significant edges to create a thin barrier
    kernel = np.ones((dilate_px * 2 + 1, dilate_px * 2 + 1), np.uint8)
    barrier = cv2.dilate(significant_edges, kernel)

    # Zero barrier pixels in the country mask
    result = country_mask.copy()
    barrier_count = int(np.sum((barrier > 0) & (country_mask > 0)))
    result[barrier > 0] = 0

    barrier_pct = barrier_count / country_size * 100
    print(
        f"  [EdgeBarrier] Inserted {barrier_count} barrier pixels ({barrier_pct:.1f}% of country) "
        f"along {int(np.sum(significant_edges > 0))} significant edge pixels"
    )

    return result


def _exclude_gray_edge_regions(
    country_mask: np.ndarray,
    original: np.ndarray,
    sat_threshold: int = 25,
    edge_band_pct: float = 0.05,
    min_region_pct: float = 0.02,
) -> np.ndarray:
    """Remove large desaturated (gray) regions connected to the image edges.

    Maps of a country often include gray neighboring countries (Panama on a
    Costa Rica map, Nicaragua on a Honduras map, etc.). These survive
    background detection because they aren't ocean-colored, but they shouldn't
    be clustered as valid provinces.

    Algorithm:
      1. Find country-mask pixels with very low saturation (gray).
      2. Seed a flood-fill from those that touch the image edge band.
      3. Grow through connected low-saturation country pixels.
      4. If the filled region exceeds `min_region_pct` of country area,
         exclude it from the mask.

    This is general: any large gray border-touching landmass is removed,
    regardless of which country or neighbor it is.
    """
    h, w = country_mask.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return country_mask

    # HSV saturation of the original (unfiltered) image
    hsv = cv2.cvtColor(original, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]  # 0-255

    # Low-saturation country pixels
    low_sat = (country_mask > 0) & (sat < sat_threshold)

    # Edge band: pixels within edge_band_pct of any image border
    bx = max(int(w * edge_band_pct), 3)
    by = max(int(h * edge_band_pct), 3)
    edge_mask = np.zeros((h, w), dtype=bool)
    edge_mask[:by, :] = True
    edge_mask[-by:, :] = True
    edge_mask[:, :bx] = True
    edge_mask[:, -bx:] = True

    # Seeds: low-sat country pixels in the edge band
    seeds = low_sat & edge_mask
    if not np.any(seeds):
        return country_mask

    # Flood-fill from seeds through connected low-sat country pixels
    filled = seeds.astype(np.uint8) * 255
    # Use morphological dilation to flood-fill through connected low-sat pixels
    target = low_sat.astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    prev_count = 0
    while True:
        dilated = cv2.dilate(filled, kernel)
        filled = cv2.bitwise_and(dilated, target)
        cur_count = int(np.sum(filled > 0))
        if cur_count == prev_count:
            break
        prev_count = cur_count

    filled_count = int(np.sum(filled > 0))
    region_pct = filled_count / country_size

    if region_pct >= min_region_pct:
        result = country_mask.copy()
        result[filled > 0] = 0
        print(
            f"  [GrayEdge] Excluded {filled_count} px ({region_pct * 100:.1f}% of country) — "
            f"gray edge-connected region (sat<{sat_threshold})"
        )
        return result

    return country_mask


# =============================================================================
# Phase 1 orchestrator
# =============================================================================


def run_phase1(
    image: np.ndarray,
    tw: int,
    th: int,
    orig_w: int,
    orig_h: int,
    on_progress: callable = None,
    on_review: callable = None,
) -> dict:
    """Phase 1: full preprocessing pipeline.

    1. Resize to pipeline resolution
    2. Remove colored lines (roads, rivers, borders)
    3. Mean-shift filter
    4. Two-stage background detection (on original downscaled image)
    5. Water detection (on original downscaled image) — pauses for operator
       review if on_review callback is provided and any water components
       are detected.

    on_progress: optional callback(step_description: str) called before each step.
    on_review: optional callback(kind: str, data: dict, timeout: float = 600) -> dict | None
        that emits a review-request and blocks until the operator responds.
        Passed through from the HTTP layer — see app/routes/pipeline.py.
    """

    def _progress(msg: str):
        print(f"  [Phase1] {msg}")
        if on_progress:
            on_progress(msg)

    # Downscale to pipeline resolution
    pipeline_img = resize_image(image, tw, th)
    original_down = pipeline_img.copy()  # Keep original for water/background detection

    res_scale = tw / 800.0  # Scale factors relative to 800px reference

    # known_noise_mask: union of every "we know this pixel is not region" decision
    # made during preprocessing. After phase 1 we pass it to K-means so those
    # pixels (and their rings) do not vote, which kills the ghost-text boundary
    # problem where mean-shift smears label colors into neighboring land pixels.
    #
    # Scope: letter- and line-precise masks only (OCR ink strokes, dark-text,
    # tophat, outlier, road, coloured line). We deliberately do NOT union the
    # OCR rectangular bounding boxes — one bbox may straddle two regions and
    # would kill region distinction if whole rows got excluded. We DO union
    # the letter-precise OCR mask (strokes only); those pixels are ink, not
    # region, and flat-filling them leaves a slight colour shift that K-means
    # would otherwise pick up as a ghost sub-cluster. Excluding them from
    # voting + filling via nearest neighbour label absorbs them into the
    # surrounding region cleanly.
    known_noise_mask = np.zeros(pipeline_img.shape[:2], dtype=np.uint8)

    # Step 0a: OCR-based text detection and removal (BEFORE any other processing).
    # remove_text_from_image returns the letter-precise mask (not the bboxes),
    # so unioning it into known_noise_mask is safe.
    _progress("OCR text detection and removal...")
    from .text_detection import remove_text_from_image

    pipeline_img, ocr_letter_mask = remove_text_from_image(pipeline_img)
    known_noise_mask |= ocr_letter_mask

    # Step 0b: Inpaint yellow/orange road-like features (before median-based line removal)
    _progress("Inpainting colored roads...")
    pipeline_img, road_mask = _inpaint_colored_roads(pipeline_img, res_scale)
    # Ring-median flat-fill (in _inpaint_colored_roads and remove_colored_lines)
    # leaves clean region colour at road pixel positions, so the mean-shift
    # halo going forward is minimal. A small 3-px dilation still captures
    # the 1-2 px anti-aliased edge fringe the run-length detector misses.
    road_dilate_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))  # 3 px radius
    road_mask_wide = cv2.dilate(road_mask, road_dilate_kernel)
    known_noise_mask |= road_mask_wide

    # Step 1: Remove colored lines
    _progress("Removing colored lines...")
    cleaned, line_mask = remove_colored_lines(pipeline_img, res_scale)
    line_dilate_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))  # 3 px radius
    line_mask_wide = cv2.dilate(line_mask, line_dilate_kernel)
    known_noise_mask |= line_mask_wide

    # Step 1b: Saturated text residue (teal/blue labels like "Dominical" that
    # survive remove_colored_lines' thickness filter because letter bodies
    # are thicker than a colour-line run-length).
    _progress("Saturated text residue cleanup...")
    cleaned, sat_text_mask = _detect_saturated_text(cleaned, res_scale)
    known_noise_mask |= sat_text_mask

    # Step 1c: Non-OCR dark-text residue detection (catches dark-ink labels
    # like thin black feature text that EasyOCR missed). Flat-fills thin
    # high-contrast CCs.
    _progress("Dark text residue cleanup...")
    cleaned, dark_text_mask = _detect_dark_text_residue(cleaned, res_scale)
    known_noise_mask |= dark_text_mask

    # Pre-mean-shift nearest-neighbour fill for ROAD + SATURATED/DARK TEXT
    # residue. These are lines INSIDE regions (not borders BETWEEN them), so
    # it's safe to replace them with local region colour — and doing so
    # prevents mean-shift from smearing their residue into adjacent pixels.
    #
    # We DELIBERATELY EXCLUDE line_mask: `remove_colored_lines` uses a
    # median-blur that leaves a tiny colour transition at thin region
    # borders (e.g. Egypt's dashed governorate borders between same-hue
    # desert regions). That transition is the ONLY signal k-means has to
    # tell same-coloured governorates apart — destroying it via
    # nearest-fill would merge them.
    pre_ms_mask = np.maximum(
        np.maximum(road_mask, sat_text_mask),
        dark_text_mask,
    )
    if int(pre_ms_mask.sum()) > 0:
        cleaned = _fill_via_nearest_image_pixel(cleaned, pre_ms_mask)
        print(
            f"  [PreMeanShift] Nearest-neighbour-filled {int(pre_ms_mask.sum())} px (roads+sat_text+dark_text; line_mask EXCLUDED to preserve thin region borders)"
        )

    # Step 2: Mean-shift filtering — two passes to thoroughly absorb text
    _progress("Mean-shift filtering pass 1/2 (sp=10, sr=20)...")
    pass1 = mean_shift_filter(cleaned, sp=10, sr=20)
    _progress("Mean-shift filtering pass 2/2 (sp=20, sr=30)...")
    filtered = mean_shift_filter(pass1, sp=20, sr=30)

    # Step 2b: Morphological top-hat text removal
    _progress("Top-hat text/symbol removal...")
    filtered, tophat_mask = _tophat_text_removal(filtered, kernel_size=15)
    known_noise_mask |= tophat_mask

    # Step 2c: Outlier pixel removal
    _progress("Outlier pixel cleanup...")
    filtered, outlier_mask = _remove_outlier_pixels(filtered, kernel_size=21, diff_threshold=12, max_cc_size=500)
    known_noise_mask |= outlier_mask

    # Step 2d: Bilateral filter
    _progress("Bilateral filter (edge-preserving smoothing)...")
    filtered = cv2.bilateralFilter(filtered, d=9, sigmaColor=50, sigmaSpace=50)

    # Step 2e: Late blob removal
    _progress("Late dark blob detection...")
    filtered = _remove_dark_blobs(filtered, max_area=1500)

    # Step 2f: Inset box detection
    _progress("Inset box detection...")
    inset_mask = _detect_inset_mask(original_down)

    # Step 3: Two-stage background detection (on ORIGINAL, not filtered)
    _progress("Two-stage background detection...")
    country_mask = detect_background(filtered, original_down)

    # Apply inset mask: add inset regions to background
    if inset_mask is not None:
        country_mask[inset_mask > 0] = 0

    country_size = int(np.sum(country_mask > 0))

    # Step 3b: Hough circle detection
    _progress("Hough circle detection...")
    country_mask = _exclude_hough_circles(country_mask, filtered)

    # Step 3c: Isolated CC grouping
    _progress("Isolated CC group detection...")
    country_mask = _exclude_isolated_cc_groups(country_mask, filtered)

    # Step 3d: SAM-based decoration segmentation
    _progress("SAM decoration segmentation...")
    country_mask = _sam_exclude_decorations(country_mask, filtered)

    # Step 3e: Edge decoration exclusion
    _progress("Edge decoration exclusion...")
    country_mask = _exclude_decoration_ccs(country_mask, filtered, edge_pct=0.28)

    # Step 3f: Gray edge region exclusion (neighboring countries)
    _progress("Gray edge region exclusion...")
    country_mask = _exclude_gray_edge_regions(country_mask, original_down)

    # Step 4: Water detection (on ORIGINAL, not filtered)
    _progress("Water detection (edge seeding + inland lakes)...")
    water_mask, water_components, water_ref = detect_water(original_down, country_mask)

    # Step 4b: Operator review of water components (optional — only when
    # an on_review callback is wired up, i.e. interactive HTTP mode).
    if on_review is not None and water_components:
        water_mask = _review_water_components(
            original_down,
            water_mask,
            water_components,
            country_mask,
            on_review,
            _progress,
        )

    # Remove water from country mask
    country_mask[water_mask > 0] = 0

    # Step 5: Coastal fringe cleanup — remove thin strips of sea color along the coastline
    # These are pixels that survived background detection but are really sea/ocean
    if water_ref is not None:
        bg_mask = (country_mask == 0).astype(np.uint8) * 255
        # Dilate background by 5px to find the coastal fringe
        fringe_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
        dilated_bg = cv2.dilate(bg_mask, fringe_kernel)
        fringe = (dilated_bg > 0) & (country_mask > 0)  # pixels near background that are still "country"

        # Check if fringe pixels match the water reference color
        ref_bgr = np.array(water_ref, dtype=np.float32)
        fringe_diff = np.abs(original_down.astype(np.float32) - ref_bgr[np.newaxis, np.newaxis, :])
        fringe_max_diff = fringe_diff.max(axis=2)
        sea_like_fringe = fringe & (fringe_max_diff <= 35)  # slightly more permissive than BG_RGB_DIST

        fringe_removed = int(np.sum(sea_like_fringe))
        if fringe_removed > 0:
            country_mask[sea_like_fringe] = 0
            print(f"  [Phase1] Coastal fringe cleanup: removed {fringe_removed} sea-like pixels along coastline")

    # Step 6: Water-colored edge CC removal — find CCs in the country mask
    # that match the water/ocean reference color and are near image edges.
    # These are typically title box backgrounds (Wikivoyage uses ocean color
    # for title boxes). They survived water detection because they weren't
    # connected to the ocean flood-fill seeds.
    if water_ref is not None:
        ref_bgr = np.array(water_ref, dtype=np.float32)
        h_img, w_img = country_mask.shape
        bx_w = int(w_img * 0.25)
        by_w = int(h_img * 0.25)

        cm_bin = (country_mask > 0).astype(np.uint8) * 255
        n_cc, cc_lbl, cc_st, cc_ctr = cv2.connectedComponentsWithStats(cm_bin)
        cs = int(np.sum(country_mask > 0))

        # Find main landmass
        main_id_w = max(range(1, n_cc), key=lambda j: int(cc_st[j, cv2.CC_STAT_AREA]), default=0)

        water_cc_removed = 0
        for j in range(1, n_cc):
            if j == main_id_w:
                continue
            a = int(cc_st[j, cv2.CC_STAT_AREA])
            p = a / max(cs, 1) * 100
            if p > 8.0 or p < 0.1:
                continue
            jcx, jcy = cc_ctr[j]
            if not (jcx < bx_w or jcx > w_img - bx_w or jcy < by_w or jcy > h_img - by_w):
                continue

            # Check if CC color matches water reference
            cc_pixels = original_down[cc_lbl == j]
            cc_avg = cc_pixels.mean(axis=0).astype(np.float32)
            color_diff = np.abs(cc_avg - ref_bgr).max()
            if color_diff > 40:
                continue  # Color too different from water

            # This CC looks like water near an edge — likely title box background
            country_mask[cc_lbl == j] = 0
            water_cc_removed += a
            print(
                f"  [WaterCC] Removed water-colored edge CC: {a}px ({p:.1f}%), pos=({jcx:.0f},{jcy:.0f}), diff={color_diff:.0f}"
            )

        if water_cc_removed > 0:
            print(f"  [WaterCC] Total removed: {water_cc_removed} px")

    country_size = int(np.sum(country_mask > 0))

    # Dilate the accumulated noise mask so the anti-aliased halo around each
    # detected text/road/line feature (the pixels mean-shift smeared colour
    # into) is also excluded from K-means voting.
    #
    # Final uniform dilation: small — road_mask and line_mask have already
    # been dilated per-mask (5 px / 3 px) before unioning, which targets the
    # wide mean-shift halos only where they occur. This final pass just
    # catches the 1-2 px halo around letter-precise masks (OCR ink, saturated
    # text, dark text, tophat, outlier) without over-absorbing their areas.
    noise_dilate_px = 1
    if noise_dilate_px > 0 and known_noise_mask.any():
        dilate_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * noise_dilate_px + 1, 2 * noise_dilate_px + 1))
        known_noise_mask = cv2.dilate(known_noise_mask, dilate_kernel)
    noise_px_total = int(known_noise_mask.sum())
    # Only pixels that are inside the country count for K-means exclusion;
    # pixels outside country are already masked off by country_mask.
    known_noise_mask &= (country_mask > 0).astype(np.uint8)
    print(f"  [Phase1] Known-noise mask: {noise_px_total} total pixels, {int(known_noise_mask.sum())} inside country")

    # Debug images
    filtered_display = resize_image(filtered, orig_w, orig_h)
    debug_images = [
        {"label": "Mean-shift filtered (Python)", "dataUrl": encode_png_base64(filtered_display)},
    ]

    # Debug: background (gray) + water (blue) + known-noise (red, semi-transparent)
    # This honestly represents what K-means sees: gray = excluded by country_mask,
    # red = inside country but excluded via known_noise_mask (OCR/road/line/text residue).
    h, w = filtered.shape[:2]
    debug_overlay = filtered.copy()
    debug_overlay[country_mask == 0] = [200, 200, 200]  # background = gray
    debug_overlay[water_mask > 0] = [255, 150, 100]  # water = blue-ish (BGR)
    # Known-noise tint: blend red at 60% opacity so underlying colors are visible
    noise_in_country = (known_noise_mask > 0) & (country_mask > 0)
    if noise_in_country.any():
        red_bgr = np.array([50, 50, 230], dtype=np.float32)
        orig_vals = debug_overlay[noise_in_country].astype(np.float32)
        blended = (orig_vals * 0.4 + red_bgr * 0.6).astype(np.uint8)
        debug_overlay[noise_in_country] = blended
    debug_display = resize_image(debug_overlay, orig_w, orig_h)
    debug_images.append(
        {"label": "Background (gray) + Water (blue) + Known noise (red)", "dataUrl": encode_png_base64(debug_display)}
    )

    return {
        "filteredImage": encode_png_base64(filtered),
        "waterMask": encode_png_base64(water_mask),
        "waterComponents": water_components,
        "countryMask": encode_png_base64(country_mask),
        "knownNoiseMask": encode_png_base64(known_noise_mask * 255),
        "countrySize": country_size,
        "debugImages": debug_images,
    }
