"""RANSAC-based GADM-to-cluster matching algorithm.

Replaces the fragile JS ICP alignment with cv2.estimateAffinePartial2D + RANSAC.
Matches GADM administrative division boundaries to color clusters detected on
Wikivoyage travel maps.
"""

import math
import time
from collections import Counter
from collections.abc import Callable
from typing import Any

import cv2
import numpy as np
from scipy.spatial import KDTree

from ..utils.image import encode_png_base64, resize_image
from .svg_parse import parse_svg_path_points, parse_svg_sub_paths, resample_path

# --- Constants (preserved from JS implementation) ---
RANSAC_REPROJ_THRESHOLD = 8.0
FALLBACK_INLIER_RATIO = 0.30
SPLIT_CONFIDENCE = 0.90
MINORITY_SHARE_FOR_SPLIT = 0.15
MINORITY_INCLUSION = 0.10
OUT_OF_BOUNDS_MIN_PX = 5
COSINE_THRESHOLD = 0.03
COUNTRY_RESAMPLE = 500
DIVISION_RESAMPLE = 50

# --- Matching optimization thresholds ---
# Projection detection (tests ~50 conic/LCC candidates) is only useful for
# regions with meaningful latitude span — for small regions near the equator
# equirectangular is essentially optimal and the pyproj candidates just add
# latency.
PROJ_DETECT_MIN_LAT_SPAN_DEG = 10.0
# Refinements (conic + shear + perspective) are only useful when the affine
# fit is "in the right ballpark". If affine F2 < this threshold the basic
# shape is misaligned; grid-searching polishes cannot recover a broken fit,
# just waste wall-clock time. Return the affine result immediately.
MIN_F2_FOR_REFINE = 0.60
# Conic search: skip when the affine fit is already essentially perfect —
# conic correction can only change F2 by a few thousandths when the shape
# is already >0.95 aligned.
SKIP_CONIC_F2 = 0.95
# Perspective grid search: same logic as conic.
SKIP_PERSPECTIVE_F2 = 0.95


def _compute_cos_lat(bbox_min_y: float, bbox_max_y: float) -> float:
    """Compute cosine latitude correction factor.

    Converts EPSG:4326 degrees to pseudo-equirectangular coordinates
    matching the map projection.
    """
    mid_lat = abs((bbox_min_y + bbox_max_y) / 2.0)
    cos_lat = math.cos(math.radians(mid_lat))
    # Only apply correction if it's meaningful
    if abs(1.0 - cos_lat) > COSINE_THRESHOLD:
        return cos_lat
    return 1.0


def _extract_cv_external_border(mask: np.ndarray) -> np.ndarray:
    """Extract external border pixels from a binary mask.

    Border pixels are mask pixels adjacent to non-mask pixels or image edge
    (4-connected neighborhood).

    Returns Nx2 array of [x, y] pixel coordinates.
    """
    # Vectorized — pad with zeros so image-edge pixels naturally count as
    # adjacent to a "background" pixel.
    padded = np.pad(mask, 1, constant_values=0)
    has_zero_neighbor = (
        (padded[1:-1, :-2] == 0) | (padded[1:-1, 2:] == 0) |
        (padded[:-2, 1:-1] == 0) | (padded[2:, 1:-1] == 0)
    )
    ys, xs = np.where((mask != 0) & has_zero_neighbor)
    if len(xs) == 0:
        return np.empty((0, 2), dtype=np.float64)
    return np.column_stack([xs, ys]).astype(np.float64)


def _extract_cv_internal_border(
    pixel_labels: np.ndarray, mask: np.ndarray
) -> np.ndarray:
    """Extract internal border pixels where adjacent cluster labels differ.

    Only considers pixels within the mask. Uses 4-connected neighborhood.

    Returns Nx2 array of [x, y] pixel coordinates.
    """
    # Vectorized — use int16 to safely represent the -1 sentinel after padding,
    # then for each direction check that the neighbor is in-mask AND has a
    # different label. A pixel is an internal border iff any direction qualifies.
    active = (mask != 0) & (pixel_labels != 255)
    lab = pixel_labels.astype(np.int16)
    padded_lab = np.pad(lab, 1, constant_values=-1)
    padded_mask = np.pad(mask, 1, constant_values=0)
    differs = (
        ((padded_mask[:-2, 1:-1] != 0) & (padded_lab[:-2, 1:-1] != lab)) |
        ((padded_mask[2:, 1:-1] != 0) & (padded_lab[2:, 1:-1] != lab)) |
        ((padded_mask[1:-1, :-2] != 0) & (padded_lab[1:-1, :-2] != lab)) |
        ((padded_mask[1:-1, 2:] != 0) & (padded_lab[1:-1, 2:] != lab))
    )
    ys, xs = np.where(active & differs)
    if len(xs) == 0:
        return np.empty((0, 2), dtype=np.float64)
    return np.column_stack([xs, ys]).astype(np.float64)


def _filter_to_mainland(
    centroids: list[dict],
    cos_lat: float,
) -> tuple[list[dict], list[int]]:
    """Spatially cluster division centroids and keep only the mainland group.

    Phantom-island problem: GADM often contains divisions for distant islands
    (Cocos for Costa Rica, Aleutians for Alaska, Clipperton for France) that
    Wikivoyage maps do not show. Their centroids stretch the GADM bbox far
    beyond the CV silhouette, inflating the scale-search extent and producing
    alignments with F2 < 0.5.

    Mirrors the JS `findBboxOutliers` (Strategy B) at the centroid level:
    union-find over centroid pairs within a dynamic margin, then keep the
    largest component as mainland. Falls back to keeping all centroids when
    the mainland group is not a clear majority (< 60% of divisions).

    Returns (mainland_centroids, excluded_ids).
    """
    n = len(centroids)
    if n < 3:
        return centroids, []

    cxs = np.array([c["cx"] for c in centroids]) * cos_lat
    cys = np.array([-c["cy"] for c in centroids])
    bbox_diag = float(np.hypot(cxs.max() - cxs.min(), cys.max() - cys.min()))
    if bbox_diag <= 0:
        return centroids, []

    # Margin: one "typical inter-division spacing" assuming uniform layout.
    # 1.5× the expected inter-centroid distance is a standard dBSCAN-ish choice.
    margin = bbox_diag / math.sqrt(n) * 1.5

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(n):
        for j in range(i + 1, n):
            d = float(np.hypot(cxs[i] - cxs[j], cys[i] - cys[j]))
            if d < margin:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[ra] = rb

    components: dict[int, list[int]] = {}
    for i in range(n):
        r = find(i)
        components.setdefault(r, []).append(i)

    if len(components) < 2:
        return centroids, []

    mainland_root = max(components, key=lambda r: len(components[r]))
    mainland_idx = set(components[mainland_root])

    # Require mainland to be a clear majority — else the clustering may be
    # wrong (e.g., archipelago nation with no real mainland).
    if len(mainland_idx) / n < 0.6:
        return centroids, []

    mainland_centroids = [centroids[i] for i in range(n) if i in mainland_idx]
    excluded_ids = [int(centroids[i].get("id", -1)) for i in range(n) if i not in mainland_idx]
    return mainland_centroids, excluded_ids


def _prepare_gadm_boundary_points(
    country_path: str,
    division_paths: list[dict],
    cos_lat: float,
) -> np.ndarray:
    """Parse and resample GADM boundaries into a single point set.

    Applies cosine latitude correction to X coordinates.
    Country boundary resampled to COUNTRY_RESAMPLE points,
    each division to DIVISION_RESAMPLE points.

    Returns Nx2 array of [corrected_x, y] coordinates in GADM space.
    """
    all_points = []

    # Country boundary
    country_pts = parse_svg_path_points(country_path)
    if len(country_pts) >= 2:
        resampled = resample_path(country_pts, COUNTRY_RESAMPLE)
        resampled[:, 0] *= cos_lat
        all_points.append(resampled)

    # Division boundaries
    for div in division_paths:
        svg = div.get("svgPath", "")
        if not svg:
            continue
        pts = parse_svg_path_points(svg)
        if len(pts) >= 2:
            resampled = resample_path(pts, DIVISION_RESAMPLE)
            resampled[:, 0] *= cos_lat
            all_points.append(resampled)

    if not all_points:
        return np.empty((0, 2), dtype=np.float64)
    return np.vstack(all_points)


def _compute_initial_transform(
    gadm_points: np.ndarray,
    tw: int,
    th: int,
) -> tuple[float, float, float, float]:
    """Compute rough initial transform from GADM bbox to CV image bbox.

    Returns (sx, sy, tx, ty) where:
        pixel_x = gadm_x * sx + tx
        pixel_y = gadm_y * sy + ty
    """
    gadm_min = gadm_points.min(axis=0)
    gadm_max = gadm_points.max(axis=0)
    gadm_w = gadm_max[0] - gadm_min[0]
    gadm_h = gadm_max[1] - gadm_min[1]

    if gadm_w == 0 or gadm_h == 0:
        return 1.0, 1.0, 0.0, 0.0

    # Add small margin (5% on each side)
    margin = 0.05
    sx = tw * (1 - 2 * margin) / gadm_w
    sy = th * (1 - 2 * margin) / gadm_h

    gadm_cx = (gadm_min[0] + gadm_max[0]) / 2.0
    gadm_cy = (gadm_min[1] + gadm_max[1]) / 2.0
    tx = tw / 2.0 - gadm_cx * sx
    ty = th / 2.0 - gadm_cy * sy

    return sx, sy, tx, ty


def _ransac_affine(
    gadm_points: np.ndarray,
    cv_border: np.ndarray,
    cv_border_mask: np.ndarray,
    tw: int,
    th: int,
) -> tuple[np.ndarray | None, float, str]:
    """Estimate affine transform from GADM to pixel space via RANSAC.

    Returns (matrix_2x3, inlier_ratio, method_name).
    Matrix is None if RANSAC fails or inlier ratio is too low.
    """
    if len(gadm_points) < 4 or len(cv_border) < 4:
        return None, 0.0, "ransac_affine"

    # Compute initial transform using actual CV border bbox, not full image.
    # This gives a better initial alignment since the CV silhouette may not
    # fill the entire image (e.g., background padding on edges).
    gadm_min = gadm_points.min(axis=0)
    gadm_max = gadm_points.max(axis=0)
    gadm_w = gadm_max[0] - gadm_min[0]
    gadm_h = gadm_max[1] - gadm_min[1]

    cv_min = cv_border.min(axis=0)
    cv_max = cv_border.max(axis=0)
    cv_w = cv_max[0] - cv_min[0]
    cv_h = cv_max[1] - cv_min[1]

    if gadm_w == 0 or gadm_h == 0:
        return None, 0.0, "ransac_affine"

    # Scale: map GADM extent to CV border extent
    sx = cv_w / gadm_w
    sy = cv_h / gadm_h
    # Translation: align centers
    gadm_cx = (gadm_min[0] + gadm_max[0]) / 2.0
    gadm_cy = (gadm_min[1] + gadm_max[1]) / 2.0
    cv_cx = (cv_min[0] + cv_max[0]) / 2.0
    cv_cy = (cv_min[1] + cv_max[1]) / 2.0
    tx = cv_cx - gadm_cx * sx
    ty = cv_cy - gadm_cy * sy

    print(f"  [RANSAC] Init: sx={sx:.1f} sy={sy:.1f} tx={tx:.1f} ty={ty:.1f}")
    print(f"  [RANSAC] GADM range: X[{gadm_min[0]:.2f},{gadm_max[0]:.2f}] Y[{gadm_min[1]:.2f},{gadm_max[1]:.2f}]")
    print(f"  [RANSAC] CV range:   X[{cv_min[0]:.0f},{cv_max[0]:.0f}] Y[{cv_min[1]:.0f},{cv_max[1]:.0f}]")

    # Project GADM points with rough transform
    projected = gadm_points.copy()
    projected[:, 0] = gadm_points[:, 0] * sx + tx
    projected[:, 1] = gadm_points[:, 1] * sy + ty

    # Pre-filter: exclude GADM points that project outside the CV mask.
    # These are from offshore islands (Isla Mona, Desecheo) not in the CV silhouette.
    # Including them biases RANSAC toward a transform that accommodates the islands.
    in_image = (
        (projected[:, 0] >= 0) & (projected[:, 0] < tw) &
        (projected[:, 1] >= 0) & (projected[:, 1] < th)
    )
    in_mask = np.zeros(len(gadm_points), dtype=bool)
    for i in range(len(gadm_points)):
        if in_image[i]:
            px, py = int(round(projected[i, 0])), int(round(projected[i, 1]))
            if 0 <= px < tw and 0 <= py < th and cv_border_mask[py, px]:
                in_mask[i] = True

    # Use only mainland points for correspondence
    mainland_gadm = gadm_points[in_mask]
    mainland_projected = projected[in_mask]
    excluded_count = len(gadm_points) - in_mask.sum()
    if excluded_count > 0:
        print(f"  [RANSAC] Pre-filtered: {excluded_count} GADM pts outside CV mask (islands/decorations)")

    if len(mainland_gadm) < 10:
        # Not enough points after filtering — use all
        mainland_gadm = gadm_points
        mainland_projected = projected

    # KDTree nearest-neighbor from projected GADM to CV border
    tree = KDTree(cv_border)
    distances, indices = tree.query(mainland_projected)

    # Filter correspondences within threshold (8% of image — generous for initial matching)
    max_dist = max(tw, th) * 0.08
    valid = distances < max_dist
    print(f"  [RANSAC] Correspondences: {valid.sum()}/{len(mainland_gadm)} within {max_dist:.0f}px (median dist={np.median(distances):.1f})")

    if valid.sum() < 4:
        return None, 0.0, "ransac_affine"

    src = mainland_gadm[valid].astype(np.float32)
    dst = cv_border[indices[valid]].astype(np.float32)

    # Full affine estimation (6-param: independent sx, sy, rotation, shear, tx, ty)
    # Using full affine instead of partial because GADM X and Y have different
    # scales (longitude degrees vs latitude degrees, even after cosine correction)
    matrix, inlier_mask = cv2.estimateAffine2D(
        src, dst,
        method=cv2.RANSAC,
        ransacReprojThreshold=RANSAC_REPROJ_THRESHOLD,
    )

    if matrix is None or inlier_mask is None:
        print("  [RANSAC] estimateAffinePartial2D returned None")
        return None, 0.0, "ransac_affine"

    inlier_ratio = float(inlier_mask.sum()) / len(inlier_mask)
    # Extract scale from the matrix: [[s*cos, -s*sin, tx], [s*sin, s*cos, ty]]
    a = matrix[0, 0]
    c = matrix[1, 0]
    scale = math.sqrt(a * a + c * c)
    rotation = math.degrees(math.atan2(c, a))
    print(f"  [RANSAC] Result: {int(inlier_mask.sum())}/{len(inlier_mask)} inliers ({inlier_ratio:.1%}), scale={scale:.1f}, rotation={rotation:.1f}°, tx={matrix[0,2]:.1f}, ty={matrix[1,2]:.1f}")

    if inlier_ratio < FALLBACK_INLIER_RATIO:
        print(f"  [RANSAC] Inlier ratio {inlier_ratio:.1%} < {FALLBACK_INLIER_RATIO:.0%} threshold — will try fallback")
        return None, inlier_ratio, "ransac_affine"

    return matrix, inlier_ratio, "ransac_affine"


def _iou_alignment(
    country_path: str,
    country_mask: np.ndarray,
    centroids: list[dict],
    cos_lat: float,
    tw: int,
    th: int,
) -> tuple[np.ndarray, float, str, np.ndarray | None, float]:
    """Find the affine transform that maximizes IoU between GADM outline and CV mask.

    Uses cv2.matchTemplate for fast translation search at each candidate scale,
    then refines with IoU scoring. Much faster than brute-force grid search.
    """
    # Parse GADM sub-paths (multipolygon) and filter to mainland
    all_sub_paths = parse_svg_sub_paths(country_path)
    if not all_sub_paths:
        return np.eye(2, 3, dtype=np.float64), 0.0, "iou_align"

    # CV mask bbox
    mask_ys, mask_xs = np.where(country_mask > 0)
    if len(mask_xs) < 10:
        return np.eye(2, 3, dtype=np.float64), 0.0, "iou_align"
    cv_x0, cv_x1 = float(mask_xs.min()), float(mask_xs.max())
    cv_y0, cv_y1 = float(mask_ys.min()), float(mask_ys.max())
    cv_w = cv_x1 - cv_x0
    cv_h = cv_y1 - cv_y0

    # GADM extent from centroids — filter antimeridian outliers
    # Some divisions (e.g., Aleutians West in Alaska) cross 180° longitude,
    # producing centroids far from the mainland that skew the bbox.
    raw_cx = np.array([c["cx"] for c in centroids])
    raw_cy = np.array([c["cy"] for c in centroids])
    median_cx = np.median(raw_cx)
    median_cy = np.median(raw_cy)
    # Keep centroids within 30° of median (excludes antimeridian artifacts)
    inlier_mask = (np.abs(raw_cx - median_cx) < 30) & (np.abs(raw_cy - median_cy) < 20)
    if inlier_mask.sum() < 3:
        inlier_mask = np.ones(len(raw_cx), dtype=bool)  # fallback: keep all
    excluded = int((~inlier_mask).sum())
    if excluded > 0:
        excluded_names = [centroids[i].get("id", "?") for i in range(len(centroids)) if not inlier_mask[i]]
        print(f"  [IoU] Excluded {excluded} antimeridian outlier centroids: {excluded_names}")

    cx_arr = raw_cx[inlier_mask] * cos_lat
    cy_arr = -raw_cy[inlier_mask]
    margin = 0.05
    gx_range = cx_arr.max() - cx_arr.min()
    gy_range = cy_arr.max() - cy_arr.min()
    gx0 = cx_arr.min() - gx_range * margin
    gx1 = cx_arr.max() + gx_range * margin
    gy0 = cy_arr.min() - gy_range * margin
    gy1 = cy_arr.max() + gy_range * margin
    gadm_cx = (gx0 + gx1) / 2
    gadm_cy = (gy0 + gy1) / 2
    gadm_cx_corr = gadm_cx  # cos-corrected X center for conic scaling

    sx0 = cv_w / (gx1 - gx0)
    sy0 = cv_h / (gy1 - gy0)

    # Filter sub-paths: keep only those overlapping the centroid extent (+ 15% margin)
    # This removes far-off islands (e.g., Aleutian chain) that the map doesn't show
    ext_margin_x = gx_range * 0.15 / cos_lat  # back to raw degrees for comparison
    ext_margin_y = gy_range * 0.15
    # Convert back to raw SVG coordinate space for comparison with sub-path bounds
    # cx_arr is cos-corrected, cy_arr is Y-negated
    raw_gx0 = cx_arr.min() / cos_lat - ext_margin_x
    raw_gx1 = cx_arr.max() / cos_lat + ext_margin_x
    # SVG Y is negated from geographic Y, so bounds are also negative
    raw_gy0 = cy_arr.min() - ext_margin_y  # already in SVG space (negative)
    raw_gy1 = cy_arr.max() + ext_margin_y

    sub_paths = []
    for sp in all_sub_paths:
        if len(sp) < 3:
            continue  # skip degenerate paths
        sp_min_x, sp_max_x = sp[:, 0].min(), sp[:, 0].max()
        sp_min_y, sp_max_y = sp[:, 1].min(), sp[:, 1].max()
        # Check overlap with centroid extent
        if sp_max_x >= raw_gx0 and sp_min_x <= raw_gx1 and sp_max_y >= raw_gy0 and sp_min_y <= raw_gy1:
            sub_paths.append(sp)

    if not sub_paths:
        sub_paths = all_sub_paths  # fallback: keep all
    if len(sub_paths) < len(all_sub_paths):
        print(f"  [IoU] Filtered sub-paths: {len(sub_paths)}/{len(all_sub_paths)} kept (within centroid extent)")

    # Compute scale from filtered GADM outline extent (not just centroids)
    if sub_paths:
        outline_min_x = min(sp[:, 0].min() for sp in sub_paths) * cos_lat
        outline_max_x = max(sp[:, 0].max() for sp in sub_paths) * cos_lat
        outline_min_y = min(sp[:, 1].min() for sp in sub_paths)
        outline_max_y = max(sp[:, 1].max() for sp in sub_paths)
        outline_w = outline_max_x - outline_min_x
        outline_h = outline_max_y - outline_min_y
        if outline_w > 0 and outline_h > 0:
            sx_outline = cv_w / outline_w
            sy_outline = cv_h / outline_h
        else:
            sx_outline, sy_outline = sx0, sy0
    else:
        sx_outline, sy_outline = sx0, sy0
    s_outline_avg = (sx_outline + sy_outline) / 2
    print(f"  [IoU] Outline scale: sx={sx_outline:.1f} sy={sy_outline:.1f} (centroid: sx={sx0:.1f} sy={sy0:.1f})")

    # For the scale search, use only the largest sub-paths (by point count).
    # Small island fragments add noise and slow rasterization dramatically.
    # Keep all sub-paths for final rasterization after the best scale is found.
    if len(sub_paths) > 200:
        sorted_by_size = sorted(sub_paths, key=lambda sp: len(sp), reverse=True)
        search_paths = sorted_by_size[:200]  # top 200 largest
        print(f"  [IoU] Using {len(search_paths)}/{len(sub_paths)} largest sub-paths for scale search")
    else:
        search_paths = sub_paths

    def rasterize_at_scale(sx: float, sy: float) -> tuple[np.ndarray, float, float]:
        """Rasterize GADM at given scale centered at origin. Returns (image, offset_x, offset_y)."""
        # Transform all points, find bounding box
        all_pts = []
        for sp in search_paths:
            pts = sp.copy()
            pts[:, 0] = pts[:, 0] * cos_lat * sx
            pts[:, 1] = pts[:, 1] * sy
            all_pts.append(pts)

        all_concat = np.vstack(all_pts)
        min_x, min_y = all_concat.min(axis=0)
        max_x, max_y = all_concat.max(axis=0)

        # Create image with some padding
        pad = 5
        w = int(max_x - min_x) + 2 * pad
        h = int(max_y - min_y) + 2 * pad
        if w <= 0 or h <= 0 or w > tw * 3 or h > th * 3:
            return np.zeros((1, 1), dtype=np.uint8), 0, 0

        img = np.zeros((h, w), dtype=np.uint8)
        for pts in all_pts:
            shifted = pts.copy()
            shifted[:, 0] -= min_x - pad
            shifted[:, 1] -= min_y - pad
            cv2.fillPoly(img, [shifted.astype(np.int32)], 255)

        return img, min_x - pad, min_y - pad

    # Pre-compute smoothed mask for F2 (removes coastline noise)
    smooth_k = max(9, min(tw, th) // 25) | 1
    smooth_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (smooth_k, smooth_k))
    mask_smooth = cv2.morphologyEx(
        cv2.morphologyEx((country_mask * 255).astype(np.uint8), cv2.MORPH_CLOSE, smooth_kernel),
        cv2.MORPH_OPEN, smooth_kernel
    )

    def iou_at(sx: float, sy: float, tx: float, ty: float, k_conic: float = 0.0) -> float:
        """Compute F2 on morphologically smoothed shapes.

        Both GADM rasterization and CV mask are smoothed (close+open) before F2 computation.
        This removes coastline detail noise that creates false overflow/uncovered areas,
        making F2 better reflect the actual shape alignment quality.
        """
        img = np.zeros((th, tw), dtype=np.uint8)
        for sp in search_paths:
            pts = sp.copy()
            pts[:, 0] = pts[:, 0] * cos_lat
            if k_conic != 0:
                scale_factor = 1.0 + k_conic * (pts[:, 1] - gadm_cy)
                pts[:, 0] = gadm_cx_corr + (pts[:, 0] - gadm_cx_corr) * scale_factor
            pts[:, 0] = pts[:, 0] * sx + tx
            pts[:, 1] = pts[:, 1] * sy + ty
            cv2.fillPoly(img, [pts.astype(np.int32)], 255)
        # Smooth both shapes to remove coastline noise
        gadm_smooth = cv2.morphologyEx(
            cv2.morphologyEx(img, cv2.MORPH_CLOSE, smooth_kernel),
            cv2.MORPH_OPEN, smooth_kernel
        )
        # Clip GADM to the dilated mask region — this removes overflow from
        # detailed coastline that the CV preprocessing smoothed away.
        # Use a small dilation of the smooth mask as the clipping boundary.
        clip_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        clip_mask = cv2.dilate(mask_smooth, clip_kernel)
        gadm_clipped = gadm_smooth & clip_mask

        inter = int(np.sum((gadm_clipped > 0) & (mask_smooth > 0)))
        gadm_area = int(np.sum(gadm_clipped > 0))
        mask_area = int(np.sum(mask_smooth > 0))
        if gadm_area == 0 or mask_area == 0:
            return 0.0
        precision = inter / gadm_area
        recall = inter / mask_area
        if precision + recall == 0:
            return 0.0
        beta2 = 4.0
        return (1 + beta2) * precision * recall / (beta2 * precision + recall)

    # Multi-scale template matching
    # For each candidate scale, rasterize GADM and use matchTemplate to find best translation
    best_iou_val = 0.0
    best_params = (sx0, sy0, 0.0, 0.0)

    # Build scale candidates from multiple sources:
    # 1. Centroid-based scale (sx0/sy0) — average and variations
    # 2. Outline-based scale (from GADM filtered contour extent) — may be more accurate
    s_avg = (sx0 + sy0) / 2
    s_outline_avg = (sx_outline + sy_outline) / 2

    # Uniform scales from both centroid and outline averages
    # Use fine step (2%) to avoid missing the optimal scale
    scale_set = set()
    for base_s in [s_avg, s_outline_avg]:
        for f in np.arange(0.80, 1.21, 0.02):
            scale_set.add(round(base_s * f, 2))

    scale_candidates_2d = [(s, s) for s in sorted(scale_set)]

    # Asymmetric: a few key combinations from both estimates
    for base_sx, base_sy in [(sx0, sy0), (sx_outline, sy_outline)]:
        for sxf in [0.90, 1.0, 1.10]:
            for syf in [0.90, 1.0, 1.10]:
                if abs(sxf - syf) < 0.01:
                    continue
                scale_candidates_2d.append((base_sx * sxf, base_sy * syf))

    print(f"  [IoU] Scale candidates: {len(scale_candidates_2d)} combinations")

    target = country_mask.astype(np.float32)

    _scale_search_start = time.perf_counter()
    for sx_try, sy_try in scale_candidates_2d:
        template, off_x, off_y = rasterize_at_scale(sx_try, sy_try)
        if template.shape[0] <= 1 or template.shape[1] <= 1:
            continue
        template_f = template.astype(np.float32)

        # Pad target to allow template to slide
        pad_x = max(0, template.shape[1] - tw)
        pad_y = max(0, template.shape[0] - th)
        if pad_x > 0 or pad_y > 0:
            # Template larger than target — skip this scale
            continue

        # matchTemplate finds best translation
        result = cv2.matchTemplate(target, template_f, cv2.TM_CCORR_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        # max_loc is (x, y) of top-left corner of best match
        # Convert to our tx, ty: pixel_x = gadm_x * sx + tx
        # The template's coordinate system: pixel in template = gadm * sx - off_x
        # The template placed at max_loc: pixel in target = template_pixel + max_loc
        # So: gadm * sx + tx = gadm * sx - off_x + max_loc_x
        # => tx = -off_x + max_loc_x
        tx = -off_x + max_loc[0]
        ty = -off_y + max_loc[1]

        score = iou_at(sx_try, sy_try, tx, ty)
        if score > best_iou_val:
            best_iou_val = score
            best_params = (sx_try, sy_try, tx, ty)

    print(f"  [IoU] Scale search done in {time.perf_counter() - _scale_search_start:.2f}s (F2={best_iou_val:.3f})")

    # Fine refinement: small translation adjustments around best
    _refine_start = time.perf_counter()
    bsx, bsy, btx, bty = best_params
    for dx in range(-4, 5):
        for dy in range(-4, 5):
            score = iou_at(bsx, bsy, btx + dx, bty + dy)
            if score > best_iou_val:
                best_iou_val = score
                best_params = (bsx, bsy, btx + dx, bty + dy)

    # Fine-tune scale: try ±10% in 1% steps with translation adjustment
    bsx, bsy, btx, bty = best_params
    for sd in np.arange(-0.10, 0.101, 0.01):
        sx_try = bsx * (1 + sd)
        sy_try = bsy * (1 + sd)
        tx_adj = btx + (gadm_cx * bsx - gadm_cx * sx_try)
        ty_adj = bty + (gadm_cy * bsy - gadm_cy * sy_try)
        for dx in range(-4, 5, 2):
            for dy in range(-4, 5, 2):
                score = iou_at(sx_try, sy_try, tx_adj + dx, ty_adj + dy)
                if score > best_iou_val:
                    best_iou_val = score
                    best_params = (sx_try, sy_try, tx_adj + dx, ty_adj + dy)

    print(f"  [IoU] Scale/translation refine done in {time.perf_counter() - _refine_start:.2f}s (F2={best_iou_val:.3f})")

    # Ultra-fine around winner
    bsx, bsy, btx, bty = best_params
    for sd in np.arange(-0.005, 0.0051, 0.002):
        sx_try = bsx * (1 + sd)
        sy_try = bsy * (1 + sd)
        tx_adj = btx + (gadm_cx * bsx - gadm_cx * sx_try)
        ty_adj = bty + (gadm_cy * bsy - gadm_cy * sy_try)
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                score = iou_at(sx_try, sy_try, tx_adj + dx, ty_adj + dy)
                if score > best_iou_val:
                    best_iou_val = score
                    best_params = (sx_try, sy_try, tx_adj + dx, ty_adj + dy)

    fsx, fsy, ftx, fty = best_params

    # Post-affine: filter search_paths to keep only sub-paths overlapping the mask
    # This removes islands/features not in the CV silhouette, improving precision
    filtered_search = []
    for sp in search_paths:
        pts = sp.copy()
        pts[:, 0] *= cos_lat
        pts[:, 0] = pts[:, 0] * fsx + ftx
        pts[:, 1] = pts[:, 1] * fsy + fty
        sp_img = np.zeros((th, tw), dtype=np.uint8)
        cv2.fillPoly(sp_img, [pts.astype(np.int32)], 255)
        sp_area = int(np.sum(sp_img > 0))
        sp_inter = int(np.sum((sp_img > 0) & (country_mask > 0)))
        if sp_area > 0 and sp_inter / sp_area > 0.3:
            filtered_search.append(sp)
    if len(filtered_search) >= 3:
        removed = len(search_paths) - len(filtered_search)
        if removed > 0:
            print(f"  [IoU] Post-affine filter: {len(filtered_search)}/{len(search_paths)} sub-paths overlap mask (removed {removed} islands)")
            search_paths = filtered_search
            # Recompute F2 with filtered paths
            best_iou_val = iou_at(fsx, fsy, ftx, fty)

    print(f"  [IoU] Affine: sx={fsx:.1f} sy={fsy:.1f} tx={ftx:.1f} ty={fty:.1f} F2={best_iou_val:.3f}")
    print(f"  [IoU] Init: sx={sx0:.1f} sy={sy0:.1f} s_avg={s_avg:.1f}")

    # Bail out of conic/shear/perspective when affine is fundamentally
    # misaligned. At F2 < MIN_F2_FOR_REFINE the basic shape doesn't fit and
    # refinements cannot recover it — better to return the bad result fast
    # (~5s matching) than to burn ~7 minutes on polishing searches that only
    # nudge F2 by ~0.05 at best.
    if best_iou_val < MIN_F2_FOR_REFINE:
        print(f"  [IoU] Skipping conic/shear/perspective: affine F2={best_iou_val:.3f} < {MIN_F2_FOR_REFINE} — basic fit is wrong, refinements cannot recover it")
        affine_matrix = np.array([
            [fsx, 0.0, ftx],
            [0.0, fsy, fty],
        ], dtype=np.float64)
        return affine_matrix, best_iou_val, "iou_align", None, 0.0

    # ── Conic search: vary X-scale linearly with Y (latitude) ──
    # Conic projections make the top narrower than the bottom.
    # sx_effective(y) = sx * (1 + c * (y - mid_y))
    # Positive c = wider at bottom, narrower at top
    best_k = 0.0
    best_conic_f2 = best_iou_val

    # Skip the grid when the affine fit is already near-perfect — conic
    # refinement can only add a few thousandths to F2 and is pure latency.
    _conic_start = time.perf_counter()
    if best_iou_val >= SKIP_CONIC_F2:
        print(f"  [IoU] Skipping conic search: affine F2={best_iou_val:.3f} >= {SKIP_CONIC_F2}")
    else:
        # Hierarchical coarse→fine search: first sweep coarsely over the
        # whole (c, dx, dy) volume (~120 cells), then refine tightly around
        # the winner (~125 cells). ~10× faster than the old 4840-cell dense
        # grid, with equivalent best-case F2.
        best_grid: tuple[float, int, int] = (0.0, 0, 0)
        for c_try in np.arange(-0.06, 0.061, 0.01):
            if abs(c_try) < 1e-6:
                continue
            for dx in range(-20, 21, 10):
                for dy in range(-15, 16, 10):
                    f2_val = iou_at(fsx, fsy, ftx + dx, fty + dy, k_conic=c_try)
                    if f2_val > best_conic_f2:
                        best_conic_f2 = f2_val
                        best_k = c_try
                        best_grid = (c_try, dx, dy)
                        best_params = (fsx, fsy, ftx + dx, fty + dy)

        # Refine around the coarse winner (if any improvement was found)
        if best_k != 0.0:
            c_center, dx_center, dy_center = best_grid
            for c_try in np.arange(c_center - 0.009, c_center + 0.0091, 0.003):
                for dx in range(dx_center - 9, dx_center + 10, 3):
                    for dy in range(dy_center - 9, dy_center + 10, 3):
                        f2_val = iou_at(fsx, fsy, ftx + dx, fty + dy, k_conic=c_try)
                        if f2_val > best_conic_f2:
                            best_conic_f2 = f2_val
                            best_k = c_try
                            best_params = (fsx, fsy, ftx + dx, fty + dy)
        print(f"  [IoU] Conic grid search (hierarchical) done in {time.perf_counter() - _conic_start:.2f}s")

    if best_k != 0:
        fsx, fsy, ftx, fty = best_params
        best_iou_val = best_conic_f2
        print(f"  [IoU] Conic correction: c={best_k:.4f} F2→{best_conic_f2:.3f}")
    else:
        print("  [IoU] No conic improvement found")

    # ── Shear search: try adding shear to capture conic projection distortion ──
    # Conic projections make the top narrower than the bottom (or vice versa).
    # A shear parameter tilts the vertical axis, which approximates this.
    def f2_with_matrix(m: np.ndarray) -> float:
        img = np.zeros((th, tw), dtype=np.uint8)
        for sp in sub_paths:
            pts = sp.copy()
            pts[:, 0] *= cos_lat
            ones = np.ones((len(pts), 1))
            hom = np.hstack([pts, ones])
            if m.shape == (3, 3):
                result = (m @ hom.T).T
                w = result[:, 2:3]
                w[w == 0] = 1e-10
                projected = result[:, :2] / w
            else:
                projected = (m @ hom.T).T
            cv2.fillPoly(img, [projected.astype(np.int32)], 255)
        inter = int(np.sum((img > 0) & (country_mask > 0)))
        ga = int(np.sum(img > 0))
        ma = int(np.sum(country_mask > 0))
        if ga == 0 or ma == 0:
            return 0.0
        p, r = inter/ga, inter/ma
        return 5*p*r / max(4*p+r, 1e-10)

    _shear_start = time.perf_counter()
    best_shear_f2 = best_iou_val
    for shear_x in np.arange(-0.15, 0.16, 0.03):
        for shear_y in np.arange(-0.10, 0.11, 0.05):
            if shear_x == 0 and shear_y == 0:
                continue
            m = np.array([
                [fsx, shear_x * fsx, ftx],
                [shear_y * fsy, fsy, fty],
            ], dtype=np.float64)
            f2 = f2_with_matrix(m)
            if f2 > best_shear_f2:
                best_shear_f2 = f2
                best_params = (fsx, fsy, ftx, fty, shear_x, shear_y)

    print(f"  [IoU] Shear search done in {time.perf_counter() - _shear_start:.2f}s")
    if best_shear_f2 > best_iou_val * 1.005:
        fsx, fsy, ftx, fty, shx, shy = best_params
        print(f"  [IoU] Shear improved: shear_x={shx:.3f} shear_y={shy:.3f} F2={best_iou_val:.3f} → {best_shear_f2:.3f}")
        best_iou_val = best_shear_f2
        affine_matrix = np.array([
            [fsx, shx * fsx, ftx],
            [shy * fsy, fsy, fty],
        ], dtype=np.float64)
    else:
        affine_matrix = np.array([
            [fsx, 0.0, ftx],
            [0.0, fsy, fty],
        ], dtype=np.float64)

    # ── Perspective via super-blur + F2 grid search ──
    # 1. Super-blur both masks, find projective from blurred contours
    # 2. Extract perspective terms as initial guess
    # 3. Grid-search around those terms using F2 on FILTERED sub-paths
    #
    # Skip the entire ~1920-cell warpPerspective grid when post-affine/conic F2
    # is already near-perfect — perspective refinement won't meaningfully
    # improve an already-excellent fit.
    if best_iou_val >= SKIP_PERSPECTIVE_F2:
        print(f"  [IoU] Skipping perspective search: F2={best_iou_val:.3f} >= {SKIP_PERSPECTIVE_F2}")
        return affine_matrix, best_iou_val, "iou_align", None, best_k

    _persp_start = time.perf_counter()
    gadm_img = np.zeros((th, tw), dtype=np.uint8)
    for sp in search_paths:
        pts = sp.copy()
        pts[:, 0] *= cos_lat
        if best_k != 0:
            sf_persp = 1.0 + best_k * (pts[:, 1] - gadm_cy)
            pts[:, 0] = gadm_cx_corr + (pts[:, 0] - gadm_cx_corr) * sf_persp
        pts[:, 0] = pts[:, 0] * fsx + ftx
        pts[:, 1] = pts[:, 1] * fsy + fty
        cv2.fillPoly(gadm_img, [pts.astype(np.int32)], 255)

    # Find perspective hint from super-blurred contour matching
    blur_k = max(41, min(tw, th) // 8) | 1
    gadm_blob = cv2.GaussianBlur(gadm_img, (blur_k, blur_k), 0)
    mask_u8 = (country_mask * 255).astype(np.uint8) if country_mask.max() <= 1 else country_mask
    mask_blob = cv2.GaussianBlur(mask_u8, (blur_k, blur_k), 0)
    _, gadm_thresh = cv2.threshold(gadm_blob, 40, 255, cv2.THRESH_BINARY)
    _, mask_thresh = cv2.threshold(mask_blob, 40, 255, cv2.THRESH_BINARY)

    px_hint, py_hint = 0.0, 0.0
    gc_p, _ = cv2.findContours(gadm_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    mc_p, _ = cv2.findContours(mask_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if gc_p and mc_p:
        g_cnt = max(gc_p, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)
        m_cnt = max(mc_p, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)
        if len(g_cnt) > 60:
            g_cnt = g_cnt[np.linspace(0, len(g_cnt)-1, 60, dtype=int)]
        if len(m_cnt) > 60:
            m_cnt = m_cnt[np.linspace(0, len(m_cnt)-1, 60, dtype=int)]
        if len(g_cnt) >= 6 and len(m_cnt) >= 6:
            # KDTree is already imported at module level (line 16); avoid the
            # redundant `as KDT` alias here.
            _, idxs_p = KDTree(m_cnt).query(g_cnt)
            from skimage.transform import estimate_transform
            tform = estimate_transform('projective', m_cnt[idxs_p].astype(np.float32), g_cnt.astype(np.float32))
            px_hint = float(np.clip(tform.params[2, 0], -0.002, 0.002))
            py_hint = float(np.clip(tform.params[2, 1], -0.002, 0.002))
            print(f"  [IoU] Blur perspective hint: px={px_hint:.6f} py={py_hint:.6f}")

    # Grid search around the hint — use FILTERED GADM for F2 (less overflow noise)
    mask_ys_p, mask_xs_p = np.where(country_mask > 0)
    cx_p = float(mask_xs_p.mean()) if len(mask_xs_p) > 0 else tw / 2
    cy_p = float(mask_ys_p.mean()) if len(mask_ys_p) > 0 else th / 2

    def f2_persp(px_val: float, py_val: float) -> float:
        T1 = np.array([[1, 0, -cx_p], [0, 1, -cy_p], [0, 0, 1]], dtype=np.float64)
        P = np.array([[1, 0, 0], [0, 1, 0], [px_val, py_val, 1]], dtype=np.float64)
        T2 = np.array([[1, 0, cx_p], [0, 1, cy_p], [0, 0, 1]], dtype=np.float64)
        H = T2 @ P @ T1
        warped = cv2.warpPerspective(country_mask, H, (tw, th))
        inter = int(np.sum((gadm_img > 0) & (warped > 0)))
        ga2 = int(np.sum(gadm_img > 0))
        ma2 = int(np.sum(warped > 0))
        if ga2 == 0 or ma2 == 0:
            return 0.0
        p, r = inter / ga2, inter / ma2
        return 5 * p * r / max(4 * p + r, 1e-10)

    best_px, best_py = 0.0, 0.0
    best_persp_f2 = best_iou_val

    # Hierarchical coarse→fine search around both the blur hint and zero.
    # Coarse pass catches the basin (7×7 grid × 2 centers = 98 cells);
    # fine pass refines (11×11 = 121 cells around the coarse winner). Each
    # cell is a warpPerspective — the old dense 3844-cell search spent 18s
    # to find a ~0.01 F2 improvement.
    search_range = 0.0015
    coarse_step = 0.0005
    fine_step = 0.0001
    fine_range = 0.0005

    for px_center in [0.0, px_hint]:
        for py_center in [0.0, py_hint]:
            for px in np.arange(px_center - search_range, px_center + search_range + coarse_step/2, coarse_step):
                for py in np.arange(py_center - search_range, py_center + search_range + coarse_step/2, coarse_step):
                    if px == 0 and py == 0:
                        continue
                    f2_val = f2_persp(px, py)
                    if f2_val > best_persp_f2:
                        best_persp_f2 = f2_val
                        best_px, best_py = px, py

    if best_px != 0 or best_py != 0:
        for px in np.arange(best_px - fine_range, best_px + fine_range + fine_step/2, fine_step):
            for py in np.arange(best_py - fine_range, best_py + fine_range + fine_step/2, fine_step):
                f2_val = f2_persp(px, py)
                if f2_val > best_persp_f2:
                    best_persp_f2 = f2_val
                    best_px, best_py = px, py

    print(f"  [IoU] Perspective grid (hierarchical) done in {time.perf_counter() - _persp_start:.2f}s")
    if best_px != 0 or best_py != 0:
        print(f"  [IoU] Perspective grid: px={best_px:.6f} py={best_py:.6f} F2={best_iou_val:.3f}→{best_persp_f2:.3f}")
        T1 = np.array([[1, 0, -cx_p], [0, 1, -cy_p], [0, 0, 1]], dtype=np.float64)
        P = np.array([[1, 0, 0], [0, 1, 0], [best_px, best_py, 1]], dtype=np.float64)
        T2 = np.array([[1, 0, cx_p], [0, 1, cy_p], [0, 0, 1]], dtype=np.float64)
        inverse_H = T2 @ P @ T1
        return affine_matrix, best_persp_f2, "iou_perspective", inverse_H, best_k
    print("  [IoU] No perspective improvement found")

    return affine_matrix, best_iou_val, "iou_align", None, best_k


def _inverse_homography(
    sub_paths: list[np.ndarray],
    cos_lat: float,
    country_mask: np.ndarray,
    affine_matrix: np.ndarray,
    tw: int,
    th: int,
) -> "np.ndarray | None":
    """Find a homography that warps the CV mask to match the GADM rasterization.

    Uses convex hull + angle-based vertex matching for robust correspondences.
    Convex hulls remove all coastal complexity, giving clean polygons.
    Vertices are matched by their angle from the centroid, which is
    unambiguous and works regardless of shape complexity.

    Returns a 3x3 matrix (homography or affine) to apply to pixel_labels.
    """
    # Rasterize GADM at affine
    gadm_img = np.zeros((th, tw), dtype=np.uint8)
    for sp in sorted(sub_paths, key=lambda s: len(s), reverse=True)[:100]:
        transformed = _transform_points(sp, cos_lat, affine_matrix)
        cv2.fillPoly(gadm_img, [transformed.astype(np.int32)], 255)

    # Morphological close to connect nearby components
    k = max(11, min(tw, th) // 30) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    gadm_closed = cv2.morphologyEx(gadm_img, cv2.MORPH_CLOSE, kernel)
    mask_closed = cv2.morphologyEx(country_mask, cv2.MORPH_CLOSE, kernel)

    # Find largest contour in each
    gadm_contours, _ = cv2.findContours(gadm_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv_contours, _ = cv2.findContours(mask_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not gadm_contours or not cv_contours:
        return None

    gadm_main = max(gadm_contours, key=cv2.contourArea)
    cv_main = max(cv_contours, key=cv2.contourArea)

    # Compute convex hulls
    gadm_hull = cv2.convexHull(gadm_main).reshape(-1, 2).astype(np.float64)
    cv_hull = cv2.convexHull(cv_main).reshape(-1, 2).astype(np.float64)

    if len(gadm_hull) < 4 or len(cv_hull) < 4:
        return None

    # Compute centroids
    gadm_cx = gadm_hull[:, 0].mean()
    gadm_cy = gadm_hull[:, 1].mean()
    cv_cx = cv_hull[:, 0].mean()
    cv_cy = cv_hull[:, 1].mean()

    # Compute angles from centroid for each hull vertex
    gadm_angles = np.arctan2(gadm_hull[:, 1] - gadm_cy, gadm_hull[:, 0] - gadm_cx)
    cv_angles = np.arctan2(cv_hull[:, 1] - cv_cy, cv_hull[:, 0] - cv_cx)

    # Sort both by angle
    gadm_order = np.argsort(gadm_angles)
    cv_order = np.argsort(cv_angles)
    gadm_sorted = gadm_hull[gadm_order]
    cv_sorted = cv_hull[cv_order]
    gadm_angles_sorted = gadm_angles[gadm_order]
    cv_angles_sorted = cv_angles[cv_order]

    # Resample both to same number of points (N) by angle
    N = max(len(gadm_sorted), len(cv_sorted), 20)
    target_angles = np.linspace(-np.pi, np.pi, N, endpoint=False)

    def sample_hull_at_angles(hull_pts, hull_angles, target):
        """Interpolate hull points at target angles."""
        # Extend hull cyclically
        ext_angles = np.concatenate([hull_angles, [hull_angles[0] + 2 * np.pi]])
        result = np.zeros((len(target), 2))
        for i, a in enumerate(target):
            # Find the segment containing this angle
            # Normalize angle to hull's range
            a_norm = a
            while a_norm < ext_angles[0]:
                a_norm += 2 * np.pi
            while a_norm > ext_angles[-1]:
                a_norm -= 2 * np.pi
            idx = np.searchsorted(ext_angles, a_norm, side='right') - 1
            idx = max(0, min(idx, len(hull_pts) - 1))
            next_idx = (idx + 1) % len(hull_pts)
            # Interpolate
            a0 = ext_angles[idx]
            a1 = ext_angles[idx + 1] if idx + 1 < len(ext_angles) else ext_angles[0] + 2*np.pi
            if abs(a1 - a0) < 1e-10:
                result[i] = hull_pts[idx]
            else:
                t = (a_norm - a0) / (a1 - a0)
                t = max(0, min(1, t))
                result[i] = hull_pts[idx] * (1 - t) + hull_pts[next_idx] * t
        return result

    gadm_matched = sample_hull_at_angles(gadm_sorted, gadm_angles_sorted, target_angles)
    cv_matched = sample_hull_at_angles(cv_sorted, cv_angles_sorted, target_angles)

    # Now gadm_matched[i] and cv_matched[i] correspond at the same angle
    src = cv_matched.astype(np.float32)
    dst = gadm_matched.astype(np.float32)

    print(f"  [InvHomo] Hull match: {len(gadm_hull)} GADM + {len(cv_hull)} CV hull vertices → {N} correspondences")

    # Try both affine6 and perspective, pick best by F2
    best_H = None
    best_f2 = 0.0
    best_label = ""

    for label, method_fn in [
        ("affine6", lambda s, d: cv2.estimateAffine2D(s, d, method=cv2.RANSAC, ransacReprojThreshold=8.0)),
        ("perspective", lambda s, d: cv2.findHomography(s, d, cv2.RANSAC, ransacReprojThreshold=8.0)),
    ]:
        result = method_fn(src, dst)
        H_try, mask_try = result[0], result[1]
        if H_try is None or mask_try is None:
            continue
        inl = int(mask_try.sum())
        if inl < 4:
            continue

        H_full = H_try
        if H_try.shape == (2, 3):
            H_full = np.eye(3, dtype=np.float64)
            H_full[:2, :] = H_try

        w_mask = cv2.warpPerspective(country_mask, H_full, (tw, th))
        inter = int(np.sum((gadm_img > 0) & (w_mask > 0)))
        ga2 = int(np.sum(gadm_img > 0))
        ma2 = int(np.sum(w_mask > 0))
        if ga2 > 0 and ma2 > 0:
            p, r = inter / ga2, inter / ma2
            f2 = 5 * p * r / max(4 * p + r, 1e-10)
        else:
            f2 = 0
        print(f"  [InvHomo] {label}: {inl}/{N} inliers ({inl/N:.0%}), F2={f2:.3f}")
        if f2 > best_f2:
            best_f2 = f2
            best_H = H_full
            best_label = label

    if best_H is None:
        return None

    print(f"  [InvHomo] Best: {best_label}, F2={best_f2:.3f}")
    if best_H.shape == (3, 3):
        print(f"  [InvHomo] Perspective: [{best_H[2,0]:.8f}, {best_H[2,1]:.8f}]")
    return best_H


def _combine_affine_homography(
    affine_2x3: np.ndarray,
    homography_3x3: np.ndarray,
) -> np.ndarray:
    """Combine affine + homography into a single 3x3 matrix.

    The affine is applied first (GADM coords → pixel space),
    then homography (pixel space → corrected pixel space).

    Returns a 3x3 matrix that can be used with cv2.perspectiveTransform.
    For the division rasterization, the caller should:
    1. Apply affine to get pixel coords
    2. Apply homography to those pixel coords via cv2.perspectiveTransform
    """
    # Convert 2x3 affine to 3x3
    affine_3x3 = np.eye(3, dtype=np.float64)
    affine_3x3[:2, :] = affine_2x3

    # Combined: homography @ affine
    return homography_3x3 @ affine_3x3


def _centroid_fallback(
    centroids: list[dict],
    pixel_labels: np.ndarray,
    country_mask: np.ndarray,
    cos_lat: float,
    gadm_points: np.ndarray,
    tw: int,
    th: int,
) -> tuple[np.ndarray, float, str]:
    """Grid-search centroid-based alignment fallback.

    Searches over scale and translation to maximize centroid hits on
    non-background pixels, prioritizing coverage of large clusters.

    Returns (matrix_2x3, score, method_name).
    """
    if len(gadm_points) == 0:
        return np.eye(2, 3, dtype=np.float64), 0.0, "centroid_grid"

    # Compute initial transform mapping GADM centroid extent to CV silhouette extent.
    # Use centroids (not boundary points) for GADM extent — boundary points include
    # offshore islets that inflate the bbox. Use CV mask extent (not full image)
    # because the silhouette may not fill the image.
    mask_ys, mask_xs = np.where(country_mask > 0)
    if len(mask_xs) > 10:
        cv_min_x, cv_max_x = float(mask_xs.min()), float(mask_xs.max())
        cv_min_y, cv_max_y = float(mask_ys.min()), float(mask_ys.max())
    else:
        cv_min_x, cv_max_x = 0.0, float(tw)
        cv_min_y, cv_max_y = 0.0, float(th)

    # GADM extent from centroids — filter antimeridian outliers
    raw_cx = np.array([c["cx"] for c in centroids])
    raw_cy = np.array([c["cy"] for c in centroids])
    med_cx = np.median(raw_cx)
    inlier = np.abs(raw_cx - med_cx) < 30
    if inlier.sum() < 3:
        inlier = np.ones(len(raw_cx), dtype=bool)
    cx_arr = raw_cx[inlier] * cos_lat
    cy_arr = -raw_cy[inlier]  # Y-negation for SVG
    gadm_min_x, gadm_max_x = cx_arr.min(), cx_arr.max()
    gadm_min_y, gadm_max_y = cy_arr.min(), cy_arr.max()
    # Add 5% margin to centroid extent (centroids are interior points, not edges)
    margin_x = (gadm_max_x - gadm_min_x) * 0.05
    margin_y = (gadm_max_y - gadm_min_y) * 0.05
    gadm_min_x -= margin_x
    gadm_max_x += margin_x
    gadm_min_y -= margin_y
    gadm_max_y += margin_y

    gadm_w = gadm_max_x - gadm_min_x
    gadm_h = gadm_max_y - gadm_min_y
    cv_w = cv_max_x - cv_min_x
    cv_h = cv_max_y - cv_min_y

    if gadm_w > 0 and gadm_h > 0:
        sx0 = cv_w / gadm_w
        sy0 = cv_h / gadm_h
        gadm_cx = (gadm_min_x + gadm_max_x) / 2.0
        gadm_cy = (gadm_min_y + gadm_max_y) / 2.0
        tx0 = (cv_min_x + cv_max_x) / 2.0 - gadm_cx * sx0
        ty0 = (cv_min_y + cv_max_y) / 2.0 - gadm_cy * sy0
    else:
        sx0, sy0, tx0, ty0 = _compute_initial_transform(gadm_points, tw, th)

    # Count total non-background pixels per cluster for weighting
    h, w = pixel_labels.shape
    total_country_px = max(int(country_mask.sum()), 1)
    cluster_sizes: dict[int, int] = {}
    for label_val in range(255):
        count = int(np.sum(pixel_labels == label_val))
        if count > 0:
            cluster_sizes[label_val] = count

    # Threshold for "large" cluster: > 5% of country area
    large_threshold = total_country_px * 0.05

    best_score = -1.0
    best_params = (sx0, sy0, tx0, ty0)

    # Coarse grid search: scale +-25% for X, +-20% for Y, translation +-20px
    # numpy is already imported as `np` at module top — drop the redundant alias.
    sx_factors = np.arange(0.75, 1.26, 0.05)
    sy_factors = np.arange(0.80, 1.21, 0.05)
    tx_offsets = range(-20, 21, 4)
    ty_offsets = range(-15, 16, 3)

    for sx_f in sx_factors:
        for sy_f in sy_factors:
            sx = sx0 * sx_f
            sy = sy0 * sy_f
            for tx_off in tx_offsets:
                for ty_off in ty_offsets:
                    txc = tx0 + tx_off
                    tyc = ty0 + ty_off
                    score = _score_centroid_alignment(
                        centroids, pixel_labels, cos_lat,
                        sx, sy, txc, tyc,
                        tw, th, cluster_sizes, large_threshold,
                    )
                    if score > best_score:
                        best_score = score
                        best_params = (sx, sy, txc, tyc)

    # Fine refinement: +-2% scale, +-3px translation around best
    bsx, bsy, btx, bty = best_params
    for sx_d in np.arange(-0.02, 0.021, 0.005):
        for sy_d in np.arange(-0.02, 0.021, 0.005):
            sx = bsx * (1 + sx_d)
            sy = bsy * (1 + sy_d)
            for dtx in range(-3, 4):
                for dty in range(-3, 4):
                    score = _score_centroid_alignment(
                        centroids, pixel_labels, cos_lat,
                        sx, sy, btx + dtx, bty + dty,
                        tw, th, cluster_sizes, large_threshold,
                    )
                    if score > best_score:
                        best_score = score
                        best_params = (sx, sy, btx + dtx, bty + dty)

    fsx, fsy, ftx, fty = best_params
    print(f"  [Centroid] Best: sx={fsx:.1f} sy={fsy:.1f} tx={ftx:.1f} ty={fty:.1f} score={best_score:.1f}")
    print(f"  [Centroid] Init: sx={sx0:.1f} sy={sy0:.1f} tx={tx0:.1f} ty={ty0:.1f}")
    print(f"  [Centroid] Scale factors: sx_f={fsx/sx0:.3f} sy_f={fsy/sy0:.3f}")
    # Build 2x3 affine matrix (no rotation)
    matrix = np.array([
        [fsx, 0.0, ftx],
        [0.0, fsy, fty],
    ], dtype=np.float64)

    return matrix, best_score, "centroid_grid"


def _score_centroid_alignment(
    centroids: list[dict],
    pixel_labels: np.ndarray,
    cos_lat: float,
    sx: float,
    sy: float,
    tx: float,
    ty: float,
    tw: int,
    th: int,
    cluster_sizes: dict[int, int],
    large_threshold: float,
) -> float:
    """Score a candidate alignment by centroid coverage and quality.

    Primary: how many distinct large clusters have at least one centroid
    Secondary: total centroids on non-background pixels
    Penalty: centroids outside the image or on background
    """
    h, w = pixel_labels.shape
    hits = 0
    misses = 0
    large_clusters_hit: set[int] = set()

    for c in centroids:
        px = c["cx"] * cos_lat * sx + tx
        py = -c["cy"] * sy + ty
        ix = int(round(px))
        iy = int(round(py))

        if 0 <= ix < w and 0 <= iy < h:
            label = pixel_labels[iy, ix]
            if label != 255:
                hits += 1
                if cluster_sizes.get(int(label), 0) > large_threshold:
                    large_clusters_hit.add(int(label))
            else:
                misses += 1  # on background
        else:
            misses += 1  # outside image

    # Score: distinct large clusters (primary, 1000 per cluster) +
    # hits (secondary) - misses penalty (overflow/misalignment)
    return len(large_clusters_hit) * 1000.0 + hits - misses * 0.5


def _score_centroid_placement(
    centroids: list[dict],
    pixel_labels: np.ndarray,
    cos_lat: float,
    matrix: np.ndarray,
    tw: int,
    th: int,
) -> float:
    """Score a matrix by how many centroids land on non-background pixels.
    Handles both 2x3 affine and 3x3 homography matrices."""
    h, w = pixel_labels.shape
    hits = 0
    for c in centroids:
        pt_arr = np.array([[c["cx"], -c["cy"]]], dtype=np.float64)
        transformed = _transform_points(pt_arr, cos_lat, matrix)
        ix, iy = int(round(transformed[0, 0])), int(round(transformed[0, 1]))
        if 0 <= ix < w and 0 <= iy < h and pixel_labels[iy, ix] < 255:
            hits += 1
    return float(hits)


def _transform_points(
    points: np.ndarray,
    cos_lat: float,
    matrix: np.ndarray,
) -> np.ndarray:
    """Transform GADM points through cosine correction + affine or homography matrix.

    Handles both 2x3 affine and 3x3 perspective (homography) matrices.
    For 3x3: divides by homogeneous w coordinate.
    """
    corrected = points.copy()
    corrected[:, 0] *= cos_lat

    ones = np.ones((len(corrected), 1), dtype=np.float64)
    homogeneous = np.hstack([corrected, ones])  # Nx3

    if matrix.shape == (3, 3):
        # Perspective transform: [x'w, y'w, w] = H @ [x, y, 1]
        result = (matrix @ homogeneous.T).T  # Nx3
        w = result[:, 2:3]
        w[w == 0] = 1e-10  # avoid division by zero
        return result[:, :2] / w
    # Affine transform: [x', y'] = M @ [x, y, 1]
    return (matrix @ homogeneous.T).T  # Nx2


def _rasterize_division(
    svg_path: str,
    cos_lat: float,
    matrix: np.ndarray,
    tw: int,
    th: int,
    k_conic: float = 0.0,
    gadm_mid_y: float = 0.0,
) -> np.ndarray:
    """Rasterize a GADM division polygon into a binary mask.

    Parses SVG sub-paths, applies cosine correction + optional conic correction
    + transform, then fills polygons with cv2.fillPoly.

    k_conic: conic correction factor. x += k * (y - gadm_mid_y)^2
    """
    mask = np.zeros((th, tw), dtype=np.uint8)
    sub_paths = parse_svg_sub_paths(svg_path)

    if not sub_paths:
        return mask

    for pts in sub_paths:
        if len(pts) < 3:
            continue

        if k_conic != 0:
            pts_corrected = pts.copy()
            pts_corrected[:, 0] *= cos_lat
            # Linear conic: scale X around center, varying with Y
            cx_center = pts_corrected[:, 0].mean()  # approximate center
            scale_factor = 1.0 + k_conic * (pts[:, 1] - gadm_mid_y)
            pts_corrected[:, 0] = cx_center + (pts_corrected[:, 0] - cx_center) * scale_factor
            # Now transform without cos_lat again (already applied)
            ones = np.ones((len(pts_corrected), 1), dtype=np.float64)
            homogeneous = np.hstack([pts_corrected, ones])
            if matrix.shape == (3, 3):
                result = (matrix @ homogeneous.T).T
                w = result[:, 2:3]
                w[w == 0] = 1e-10
                transformed = result[:, :2] / w
            else:
                transformed = (matrix @ homogeneous.T).T
        else:
            transformed = _transform_points(pts, cos_lat, matrix)

        poly = transformed.astype(np.int32)
        cv2.fillPoly(mask, [poly], 1)

    return mask


def _compute_cluster_votes(
    pixel_labels: np.ndarray,
    div_mask: np.ndarray,
) -> tuple[dict[int, int], int]:
    """Count cluster label votes within a division mask.

    Returns (vote_counts, total_valid_pixels).
    vote_counts maps cluster_id -> pixel count (excludes background 255).
    """
    # Extract labels where division mask is active
    active = pixel_labels[div_mask == 1]

    if len(active) == 0:
        return {}, 0

    # Count votes, excluding background
    counter = Counter(int(v) for v in active if v != 255)
    total_valid = sum(counter.values())

    return dict(counter), total_valid


def _compute_alignment_error(
    gadm_points: np.ndarray,
    cv_border: np.ndarray,
    matrix: np.ndarray,
    tw: int = 0,
    th: int = 0,
) -> tuple[float, float, float]:
    """Compute reprojection error from GADM to CV border.

    Projects GADM points through the affine matrix and measures
    nearest-neighbor distances to CV border points. Points that project
    outside the image are excluded as outliers (offshore islands etc.).

    Returns (median_dist, mean_dist, alignment_pct_within_2pct).
    alignment_pct_within_2pct = fraction of in-image GADM points whose
    nearest CV border is within 2% of the image diagonal — a visual
    quality metric (1.0 = perfect, 0.0 = totally misaligned).
    """
    if len(gadm_points) == 0 or len(cv_border) == 0:
        return 0.0, 0.0, 0.0

    # Project GADM points (handle both 2x3 and 3x3 matrices)
    ones = np.ones((len(gadm_points), 1), dtype=np.float64)
    homogeneous = np.hstack([gadm_points, ones])
    if matrix.shape == (3, 3):
        result = (matrix @ homogeneous.T).T
        w = result[:, 2:3]
        w[w == 0] = 1e-10
        projected = result[:, :2] / w
    else:
        projected = (matrix @ homogeneous.T).T

    # Filter out-of-image projected points (offshore islands, etc.)
    # These inflate mean distance without indicating real misalignment.
    if tw > 0 and th > 0:
        margin = max(tw, th) * 0.05  # 5% margin
        in_image = (
            (projected[:, 0] >= -margin) & (projected[:, 0] < tw + margin) &
            (projected[:, 1] >= -margin) & (projected[:, 1] < th + margin)
        )
        filtered = projected[in_image]
        if len(filtered) < 4:
            filtered = projected  # fallback — too few in-image points
    else:
        filtered = projected

    # Nearest-neighbor distances
    tree = KDTree(cv_border)
    distances, _ = tree.query(filtered)

    median_dist = float(np.median(distances))
    mean_dist = float(np.mean(distances))

    # Alignment percentage: fraction within 2% of image diagonal
    threshold = 0.02 * float(np.hypot(tw, th)) if tw > 0 and th > 0 else 10.0  # fallback
    within = float(np.sum(distances < threshold)) / len(distances)

    return median_dist, mean_dist, within


def _build_debug_image(
    pixel_labels: np.ndarray,
    color_centroids: list,
    division_paths: list[dict],
    centroids: list[dict],
    cos_lat: float,
    matrix: np.ndarray,
    tw: int,
    th: int,
    orig_w: int,
    orig_h: int,
) -> dict:
    """Build debug overlay image showing GADM boundaries on cluster map.

    Draws white polylines for division boundaries and orange circles
    for division centroids, overlaid on the quantized cluster map.
    """
    # Build quantized cluster map (RGB) via a 256x3 LUT — single vectorized
    # numpy index instead of an O(H*W) Python loop. Default fill is the dark
    # gray background colour for label 255 (and any label without a centroid).
    lut = np.full((256, 3), [40, 40, 40], dtype=np.uint8)
    for label, color in enumerate(color_centroids):
        if label < 255 and color is not None:
            lut[label] = [int(color[2]), int(color[1]), int(color[0])]  # RGB → BGR
    debug_img = lut[pixel_labels]

    # Draw division boundaries as white polylines
    for div in division_paths:
        svg = div.get("svgPath", "")
        if not svg:
            continue
        sub_paths = parse_svg_sub_paths(svg)
        for pts in sub_paths:
            if len(pts) < 2:
                continue
            transformed = _transform_points(pts, cos_lat, matrix)
            polyline = transformed.astype(np.int32).reshape(-1, 1, 2)
            cv2.polylines(debug_img, [polyline], isClosed=True,
                          color=(255, 255, 255), thickness=1)

    # Draw centroids as orange circles
    for c in centroids:
        pt_arr = np.array([[c["cx"], -c["cy"]]], dtype=np.float64)
        transformed = _transform_points(pt_arr, cos_lat, matrix)
        ix = int(round(transformed[0, 0]))
        iy = int(round(transformed[0, 1]))
        if 0 <= ix < tw and 0 <= iy < th:
            cv2.circle(debug_img, (ix, iy), 3, (0, 165, 255), -1)  # BGR orange

    # Resize to original dimensions
    resized = resize_image(debug_img, orig_w, orig_h)

    return {
        "label": "gadm_alignment",
        "dataUrl": encode_png_base64(resized),
    }


def _compute_total_cluster_pixels(
    pixel_labels: np.ndarray,
) -> dict[int, int]:
    """Count total pixels per cluster label across the whole image."""
    counts: dict[int, int] = {}
    unique, ucounts = np.unique(pixel_labels, return_counts=True)
    for label_val, cnt in zip(unique, ucounts, strict=False):
        lv = int(label_val)
        if lv != 255:
            counts[lv] = int(cnt)
    return counts


def _densify_polygon(pts: np.ndarray, max_seg_len: float) -> np.ndarray:
    """Add intermediate points along polygon edges longer than max_seg_len.

    This is needed before projecting polygons through a nonlinear transform:
    otherwise long edges become straight lines in the projected space
    (the corners move but the edges between them don't curve).
    """
    if len(pts) < 2:
        return pts

    result = [pts[0]]
    for i in range(1, len(pts)):
        p0 = pts[i - 1]
        p1 = pts[i]
        dx = p1[0] - p0[0]
        dy = p1[1] - p0[1]
        seg_len = np.hypot(dx, dy)
        if seg_len > max_seg_len:
            n_inserts = int(np.ceil(seg_len / max_seg_len))
            for j in range(1, n_inserts):
                t = j / n_inserts
                result.append([p0[0] + t * dx, p0[1] + t * dy])
        result.append(p1)
    return np.array(result, dtype=np.float64)


def _project_svg_path(svg_path: str, proj_fn: Callable, max_seg_len: float = 0.2) -> str:
    """Project SVG path coordinates through a projection function.

    Parses SVG sub-paths, densifies long edges (so nonlinear projections
    produce visible curves rather than just moving polygon vertices),
    applies projection, re-encodes as M/L/Z SVG.

    max_seg_len: maximum edge length in GADM (degree) space before adding
    intermediate points. 0.2 degrees ≈ 22 km at equator — fine enough for
    visible curvature on regional-scale maps.
    """
    sub_paths = parse_svg_sub_paths(svg_path)
    if not sub_paths:
        return svg_path

    parts = []
    for sp in sub_paths:
        dense = _densify_polygon(sp, max_seg_len)
        px, py = proj_fn(dense[:, 0], dense[:, 1])
        path_str = f"M {px[0]:.6f} {py[0]:.6f}"
        for i in range(1, len(dense)):
            path_str += f" L {px[i]:.6f} {py[i]:.6f}"
        path_str += " Z"
        parts.append(path_str)
    return " ".join(parts)


def _detect_projection(
    country_path: str,
    country_mask: np.ndarray,
    centroids: list[dict],
    cos_lat: float,
    tw: int,
    th: int,
) -> tuple[str, Callable] | None:
    """Detect map projection by testing conic candidates against CV mask.

    Tests several Lambert Conformal Conic projections with different cone
    constants. Picks the one with best IoU against the CV country mask.

    Returns (projection_name, project_fn) or None if equirectangular is best.
    project_fn signature: (svg_x: ndarray, svg_y: ndarray) → (proj_x, proj_y)
    """
    all_sub_paths = parse_svg_sub_paths(country_path)
    if not all_sub_paths or len(all_sub_paths) < 3:
        return None

    # Region center from centroids (filter antimeridian outliers)
    raw_cx = np.array([c["cx"] for c in centroids])
    raw_cy = np.array([c["cy"] for c in centroids])
    med_cx = float(np.median(raw_cx))
    inlier = np.abs(raw_cx - med_cx) < 30
    if inlier.sum() < 3:
        inlier = np.ones(len(raw_cx), dtype=bool)
    lat_0 = float(np.median(raw_cy[inlier]))
    lon_0 = float(np.median(raw_cx[inlier]))

    # CV mask extent
    mask_ys, mask_xs = np.where(country_mask > 0)
    if len(mask_xs) < 100:
        return None
    cv_x0, cv_x1 = float(mask_xs.min()), float(mask_xs.max())
    cv_y0, cv_y1 = float(mask_ys.min()), float(mask_ys.max())
    cv_w = cv_x1 - cv_x0
    cv_h = cv_y1 - cv_y0

    # Use only largest sub-paths for speed
    if len(all_sub_paths) > 200:
        sorted_sp = sorted(all_sub_paths, key=lambda s: len(s), reverse=True)
        test_paths = sorted_sp[:200]
    else:
        test_paths = all_sub_paths

    # Densification: without this, straight GADM edges don't become visible
    # curves after projection. Max segment length scales with region extent.
    lon_span = float(max([c["cx"] for c in centroids]) - min([c["cx"] for c in centroids]))
    max_seg_len = max(0.3, lon_span / 80)

    cv_mask_u8 = (country_mask * 255).astype(np.uint8) if country_mask.max() <= 1 else country_mask

    # Compute the convex hull of the CV country mask — this removes
    # coastline noise and captures the underlying "projection shape".
    # Different projections of the same region give different convex hulls.
    cv_contours, _ = cv2.findContours(cv_mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cv_contours:
        print("  [Proj] No CV mask contours — skipping projection detection")
        return None
    cv_main_contour = max(cv_contours, key=cv2.contourArea)
    cv_hull = cv2.convexHull(cv_main_contour)
    cv_hull_mask = np.zeros_like(cv_mask_u8)
    cv2.fillPoly(cv_hull_mask, [cv_hull], 255)
    cv_hull_ys, cv_hull_xs = np.where(cv_hull_mask > 0)
    if len(cv_hull_xs) == 0:
        return None

    def shape_score(proj_fn: Callable | None) -> float:
        """Convex hull IoU score: rasterize projected GADM, compute its convex
        hull, normalize to a canonical size, compare against the CV mask's
        convex hull. Convex hull removes coastline noise and reveals the
        underlying projection shape — different projections of the same
        region have measurably different convex hulls.
        """
        pts_list = []
        for sp in test_paths:
            dense = _densify_polygon(sp, max_seg_len)
            pts = dense.copy()
            if proj_fn:
                pts[:, 0], pts[:, 1] = proj_fn(pts[:, 0], pts[:, 1])
            else:
                pts[:, 0] *= cos_lat
            pts_list.append(pts)

        all_pts = np.vstack(pts_list)
        g_x0, g_y0 = all_pts.min(axis=0)
        g_x1, g_y1 = all_pts.max(axis=0)
        gw = g_x1 - g_x0
        gh = g_y1 - g_y0
        if gw < 1e-6 or gh < 1e-6:
            return 0.0

        # Rasterize projected GADM, compute convex hull
        canvas_size = 400
        pad = 20
        s_canvas = min((canvas_size - 2*pad) / gw, (canvas_size - 2*pad) / gh)
        gadm_img = np.zeros((canvas_size, canvas_size), dtype=np.uint8)
        for pts in pts_list:
            shifted = pts.copy()
            shifted[:, 0] = (shifted[:, 0] - g_x0) * s_canvas + pad
            shifted[:, 1] = (shifted[:, 1] - g_y0) * s_canvas + pad
            cv2.fillPoly(gadm_img, [shifted.astype(np.int32)], 255)

        if gadm_img.sum() == 0:
            return 0.0

        gadm_contours, _ = cv2.findContours(gadm_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not gadm_contours:
            return 0.0
        gadm_main_contour = max(gadm_contours, key=cv2.contourArea)
        gadm_hull = cv2.convexHull(gadm_main_contour)

        # Normalize: fit convex hulls to the same canonical box (200x200) and
        # compare pixel-wise IoU. Aspect ratio preserved.
        CANON = 200
        g_x, g_y, g_w, g_h = cv2.boundingRect(gadm_hull)
        if g_w < 5 or g_h < 5:
            return 0.0
        gadm_canon = np.zeros((CANON, CANON), dtype=np.uint8)
        gadm_hull_shifted = gadm_hull.copy().astype(np.float64)
        scale_g = (CANON - 10) / max(g_w, g_h)
        gadm_hull_shifted[:, 0, 0] = (gadm_hull_shifted[:, 0, 0] - g_x) * scale_g + (CANON - g_w * scale_g) / 2
        gadm_hull_shifted[:, 0, 1] = (gadm_hull_shifted[:, 0, 1] - g_y) * scale_g + (CANON - g_h * scale_g) / 2
        cv2.fillPoly(gadm_canon, [gadm_hull_shifted.astype(np.int32)], 255)

        c_x, c_y, c_w, c_h = cv2.boundingRect(cv_hull)
        if c_w < 5 or c_h < 5:
            return 0.0
        cv_canon = np.zeros((CANON, CANON), dtype=np.uint8)
        cv_hull_shifted = cv_hull.copy().astype(np.float64)
        scale_c = (CANON - 10) / max(c_w, c_h)
        cv_hull_shifted[:, 0, 0] = (cv_hull_shifted[:, 0, 0] - c_x) * scale_c + (CANON - c_w * scale_c) / 2
        cv_hull_shifted[:, 0, 1] = (cv_hull_shifted[:, 0, 1] - c_y) * scale_c + (CANON - c_h * scale_c) / 2
        cv2.fillPoly(cv_canon, [cv_hull_shifted.astype(np.int32)], 255)

        # Pixel-wise IoU of normalized hulls
        intersection = int(np.sum((gadm_canon > 0) & (cv_canon > 0)))
        union = int(np.sum((gadm_canon > 0) | (cv_canon > 0)))
        if union == 0:
            return 0.0
        return intersection / union

    # Baseline: equirectangular (cos_lat)
    baseline = shape_score(None)
    print(f"  [Proj] Equirectangular baseline: score={baseline:.4f}")

    best_score = baseline
    best_name = None
    best_fn = None

    # Try named standard projections via pyproj. For each, derive parameters
    # from the region's bbox. We test several parallel pairs for LCC/Albers
    # to cover common map projection conventions.
    try:
        from pyproj import CRS, Transformer
        pyproj_available = True
    except ImportError:
        pyproj_available = False
        print("  [Proj] pyproj not available — skipping projection detection")

    if pyproj_available:
        lat_min = float(raw_cy[inlier].min())
        lat_max = float(raw_cy[inlier].max())
        lat_span = lat_max - lat_min

        def make_pyproj_fn(transformer):
            def fn(svg_x, svg_y):
                lon = svg_x
                lat = -svg_y
                e, n = transformer.transform(lon, lat)
                return e, -n
            return fn

        # Parallel pairs: named by inset fraction from latitude bbox edges.
        # 0.17 = tight (≈ 1/6, cylindrical-like), 0.33 = balanced, 0.5 = full cone.
        parallel_fractions = [0.08, 0.17, 0.25, 0.33, 0.42]

        candidates_proj4 = []
        # Parallel-based projections (LCC, Albers) with typical US standard parallels
        # in addition to region-derived ones. Standard parallels commonly used:
        #   Alaska: 55, 65 | CONUS: 33, 45 | Canada: 49, 77
        STD_PAIRS = [(55, 65), (33, 45), (49, 77), (20, 60), (29.5, 45.5)]
        for sp1, sp2 in STD_PAIRS:
            # Only use if parallels are within reason of the region
            if sp1 > lat_max + 10 or sp2 < lat_min - 10:
                continue
            candidates_proj4.append((f"lcc_std_{sp1:.0f}_{sp2:.0f}",
                f"+proj=lcc +lat_1={sp1} +lat_2={sp2} +lat_0={lat_0} +lon_0={lon_0} +x_0=0 +y_0=0 +datum=WGS84 +no_defs"))
            candidates_proj4.append((f"aea_std_{sp1:.0f}_{sp2:.0f}",
                f"+proj=aea +lat_1={sp1} +lat_2={sp2} +lat_0={lat_0} +lon_0={lon_0} +x_0=0 +y_0=0 +datum=WGS84 +no_defs"))

        # Region-derived parallels
        for pf in parallel_fractions:
            sp1 = lat_min + lat_span * pf
            sp2 = lat_max - lat_span * pf
            candidates_proj4.append((f"lcc_p{pf:.2f}",
                f"+proj=lcc +lat_1={sp1} +lat_2={sp2} +lat_0={lat_0} +lon_0={lon_0} +x_0=0 +y_0=0 +datum=WGS84 +no_defs"))
            candidates_proj4.append((f"aea_p{pf:.2f}",
                f"+proj=aea +lat_1={sp1} +lat_2={sp2} +lat_0={lat_0} +lon_0={lon_0} +x_0=0 +y_0=0 +datum=WGS84 +no_defs"))

        # Single-parameter projections
        candidates_proj4.extend([
            ("stere", f"+proj=stere +lat_0={lat_0} +lon_0={lon_0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +no_defs"),
            ("merc", f"+proj=merc +lon_0={lon_0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +no_defs"),
            ("tmerc", f"+proj=tmerc +lat_0={lat_0} +lon_0={lon_0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +no_defs"),
        ])

        # Named EPSG projections that apply if the region overlaps their coverage
        EPSG_CANDIDATES = [
            (3338, "epsg3338_alaska_albers", 51, 72, -180, -130),   # NAD83 / Alaska Albers
            (5070, "epsg5070_conus_albers", 24, 49, -125, -66),      # NAD83 / Conus Albers
            (3310, "epsg3310_ca_albers", 32, 42, -125, -114),        # NAD83 / California Albers
            (3413, "epsg3413_polar_stere", 60, 90, -180, 180),       # Arctic Polar Stereographic
        ]
        for epsg, name, lat_lo, lat_hi, _lon_lo, _lon_hi in EPSG_CANDIDATES:
            if lat_max < lat_lo or lat_min > lat_hi:
                continue  # latitude range doesn't overlap
            try:
                crs = CRS.from_epsg(epsg)
                transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
                fn = make_pyproj_fn(transformer)
                score = shape_score(fn)
                print(f"  [Proj] {name} score={score:.4f}")
                if score > best_score:
                    best_score = score
                    best_name = name
                    best_fn = fn
            except Exception as e:
                print(f"  [Proj] {name} failed: {e}")

        for proj_name, proj4 in candidates_proj4:
            try:
                crs = CRS.from_proj4(proj4)
                transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
                fn = make_pyproj_fn(transformer)
                score = shape_score(fn)
                print(f"  [Proj] {proj_name} score={score:.4f}")
                if score > best_score:
                    best_score = score
                    best_name = proj_name
                    best_fn = fn
            except Exception as e:
                print(f"  [Proj] {proj_name} failed: {e}")

        # Single-parallel LCC covers any cone constant via n=sin(lat_1). We
        # search lat_1 across a wide range — this is more flexible than the
        # two-parallel pyproj LCCs above because it can model ANY cone.
        for lat_1_deg in np.arange(10, 86, 5):
            proj4 = f"+proj=lcc +lat_1={lat_1_deg} +lat_0={lat_0} +lon_0={lon_0} +x_0=0 +y_0=0 +datum=WGS84 +no_defs"
            try:
                crs = CRS.from_proj4(proj4)
                transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
                fn = make_pyproj_fn(transformer)
                score = shape_score(fn)
                if score > best_score:
                    best_score = score
                    best_name = f"lcc_lat1_{lat_1_deg:.0f}"
                    best_fn = fn
            except Exception:
                pass

        # Fine search around the best single-parallel lat_1
        if best_name and best_name.startswith("lcc_lat1_"):
            try:
                best_lat_1 = float(best_name.split("_")[-1])
                for lat_1_deg in np.arange(best_lat_1 - 4, best_lat_1 + 5, 1):
                    proj4 = f"+proj=lcc +lat_1={lat_1_deg} +lat_0={lat_0} +lon_0={lon_0} +x_0=0 +y_0=0 +datum=WGS84 +no_defs"
                    try:
                        crs = CRS.from_proj4(proj4)
                        transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
                        fn = make_pyproj_fn(transformer)
                        score = shape_score(fn)
                        if score > best_score:
                            best_score = score
                            best_name = f"lcc_lat1_{lat_1_deg:.0f}"
                            best_fn = fn
                    except Exception:
                        pass
            except Exception:
                pass

        if best_name and best_name.startswith("lcc_lat1_"):
            print(f"  [Proj] Best single-parallel LCC: {best_name} score={best_score:.4f}")

    # Require meaningful improvement to switch projections
    if best_fn and best_score > baseline * 1.05:
        print(f"  [Proj] Best: {best_name} score={best_score:.4f} (vs baseline {baseline:.4f})")
        return best_name, best_fn

    print("  [Proj] Equirectangular is optimal — no projection change")
    return None


def _compute_equirect_matrix(
    original_centroids: list[dict],
    projected_centroids: list[dict],
    matrix_lcc: np.ndarray,
    cos_lat: float,
) -> np.ndarray:
    """Compute an equirect (cos_lat) affine that maps each centroid to the
    same pixel position as matrix_lcc maps its projected counterpart.

    Uses least-squares fit over all (filtered) centroids — more accurate than
    the earlier bbox-corner-based approach which is sensitive to outliers
    and loses precision when the region is not a rectangle.
    """
    # Filter antimeridian outliers
    raw_cx = np.array([c["cx"] for c in original_centroids])
    raw_cy = np.array([c["cy"] for c in original_centroids])
    med_cx = float(np.median(raw_cx))
    inlier = np.abs(raw_cx - med_cx) < 30
    if inlier.sum() < 3:
        inlier = np.ones(len(raw_cx), dtype=bool)

    # Equirect coordinates of each centroid: (cos_lat * lon, -lat)
    eq_cx = raw_cx[inlier] * cos_lat
    eq_cy = -raw_cy[inlier]

    # Projected coordinates → pixel positions via matrix_lcc
    proj_cx = np.array([projected_centroids[i]["cx"] for i in range(len(original_centroids)) if inlier[i]])
    proj_cy = np.array([-projected_centroids[i]["cy"] for i in range(len(original_centroids)) if inlier[i]])

    pixel_x = matrix_lcc[0, 0] * proj_cx + matrix_lcc[0, 1] * proj_cy + matrix_lcc[0, 2]
    pixel_y = matrix_lcc[1, 0] * proj_cx + matrix_lcc[1, 1] * proj_cy + matrix_lcc[1, 2]

    # Least-squares fit: find [a, b, tx] and [c, d, ty] such that
    #   pixel_x = a * eq_cx + b * eq_cy + tx
    #   pixel_y = c * eq_cx + d * eq_cy + ty
    N = len(eq_cx)
    if N < 3:
        return matrix_lcc.copy()

    A = np.column_stack([eq_cx, eq_cy, np.ones(N)])
    row_x, *_ = np.linalg.lstsq(A, pixel_x, rcond=None)
    row_y, *_ = np.linalg.lstsq(A, pixel_y, rcond=None)

    return np.array([row_x, row_y], dtype=np.float64)


def _build_unproject_remap(
    matrix_eq: np.ndarray,
    matrix_proj: np.ndarray,
    proj_fn: Callable,
    cos_lat: float,
    tw: int,
    th: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Build cv2.remap fields that warp a projected image to equirect space.

    For each output pixel (x_out, y_out):
    1. Invert matrix_eq to get equirect coords (cos_lat*lon, -lat)
    2. Divide by cos_lat to get raw lon; svg_y = eq_y
    3. Apply proj_fn forward → projected (x, y)
    4. Apply matrix_proj → input pixel (x_in, y_in)

    proj_fn: (svg_x: ndarray, svg_y: ndarray) → (proj_x, proj_y)

    Returns (map_x, map_y) as float32 arrays for cv2.remap.
    """
    M3 = np.eye(3, dtype=np.float64)
    M3[:2, :] = matrix_eq
    M3_inv = np.linalg.inv(M3)

    y_grid, x_grid = np.meshgrid(
        np.arange(th, dtype=np.float64),
        np.arange(tw, dtype=np.float64),
        indexing='ij',
    )

    # Step 1: invert matrix_eq → equirect coords
    eq_x = M3_inv[0, 0] * x_grid + M3_inv[0, 1] * y_grid + M3_inv[0, 2]
    eq_y = M3_inv[1, 0] * x_grid + M3_inv[1, 1] * y_grid + M3_inv[1, 2]

    # Step 2: equirect → raw GADM (lon, svg_y=-lat)
    raw_lon = eq_x / cos_lat
    raw_svg_y = eq_y

    # Step 3: apply projection forward
    proj_x, proj_y = proj_fn(raw_lon, raw_svg_y)

    # Step 4: matrix_proj → input pixel
    in_x = matrix_proj[0, 0] * proj_x + matrix_proj[0, 1] * proj_y + matrix_proj[0, 2]
    in_y = matrix_proj[1, 0] * proj_x + matrix_proj[1, 1] * proj_y + matrix_proj[1, 2]

    return in_x.astype(np.float32), in_y.astype(np.float32)


def run_matching(
    pixel_labels: np.ndarray,
    icp_mask: np.ndarray,
    country_mask: np.ndarray,
    division_paths: list[dict],
    centroids: list[dict],
    color_centroids: list,
    country_path: str,
    country_bbox: dict,
    tw: int,
    th: int,
    orig_w: int,
    orig_h: int,
    on_progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Run GADM-to-cluster matching via RANSAC affine estimation.

    Main entry point for the matching pipeline. Takes finalized cluster
    labels and GADM division data, returns division-to-cluster assignments.

    Args:
        pixel_labels: uint8 2D array (th x tw), cluster label per pixel (255=bg).
        icp_mask: uint8 2D array (th x tw), 1=active pixel for border detection.
        country_mask: uint8 2D array (th x tw), 1=country pixel.
        division_paths: list of {"id": int, "svgPath": str} GADM boundaries.
        centroids: list of {"id": int, "cx": float, "cy": float} in EPSG:4326.
        color_centroids: list of [R,G,B] or None per cluster label.
        country_path: SVG string for country outline.
        country_bbox: {"minX", "minY", "maxX", "maxY"} from PostGIS.
        tw, th: pipeline image dimensions.
        orig_w, orig_h: original image dimensions.
        on_progress: optional callback for progress messages.

    Returns:
        dict with transform, divAssignments, outOfBounds, alignmentMethod,
        alignmentError, inlierRatio, and debugImages.
    """

    # Step-duration timer. Each call to progress(msg) closes the previous
    # step and reports its elapsed time, then opens a new step named msg.
    # Pass msg="" at the end to close the last step without opening a new one.
    _match_wall_start = time.perf_counter()
    step_start = [_match_wall_start]
    current_step = [""]

    def progress(msg: str) -> None:
        now = time.perf_counter()
        if current_step[0]:
            elapsed = now - step_start[0]
            print(f"  [Match] {current_step[0]} done in {elapsed:.2f}s")
        if msg and on_progress:
            on_progress(msg)
        current_step[0] = msg
        step_start[0] = now

    # Step 1: Cosine latitude correction
    progress("Computing cosine latitude correction")
    cos_lat = _compute_cos_lat(country_bbox["minY"], country_bbox["maxY"])

    # Step 1a: Phantom-island filter. GADM may include distant islands (Cocos
    # for Costa Rica, Aleutians for Alaska) not shown on the Wikivoyage map;
    # their centroids inflate the GADM bbox and break scale/translation search.
    # Keep only the largest spatial cluster for alignment. Division voting
    # further below still considers every division_path — missing-on-map ones
    # just fall into out_of_bounds naturally.
    mainland_centroids, excluded_ids = _filter_to_mainland(centroids, cos_lat)
    if len(mainland_centroids) < len(centroids):
        print(f"  [Match] Phantom-island filter: kept {len(mainland_centroids)}/{len(centroids)} mainland centroids (excluded divisions: {excluded_ids})")
        centroids = mainland_centroids

    # Step 1b: Projection detection — test conic projections against CV mask.
    # Small regions near the equator don't benefit from conic projection
    # detection (lat_span < threshold): skip the ~50-candidate pyproj loop.
    cy_vals = np.array([c["cy"] for c in centroids])
    lat_span_deg = float(cy_vals.max() - cy_vals.min())
    if lat_span_deg < PROJ_DETECT_MIN_LAT_SPAN_DEG:
        print(f"  [Match] Skipping projection detection: lat_span={lat_span_deg:.1f}° < {PROJ_DETECT_MIN_LAT_SPAN_DEG}°")
        proj_result = None
    else:
        progress("Detecting map projection")
        proj_result = _detect_projection(
            country_path, country_mask, centroids, cos_lat, tw, th,
        )
    original_centroids = centroids
    if proj_result is not None:
        proj_name, proj_fn = proj_result
        print(f"  [Match] Candidate projection: {proj_name}")

        # Pre-project GADM temporarily to get a good IoU alignment in projected space
        proj_country_path = _project_svg_path(country_path, proj_fn)
        proj_centroids = []
        for c in centroids:
            svg_x = np.array([c["cx"]])
            svg_y = np.array([-c["cy"]])
            lx, ly = proj_fn(svg_x, svg_y)
            proj_centroids.append({**c, "cx": float(lx[0]), "cy": float(-ly[0])})

        # Run a quick IoU alignment in projected space
        progress(f"IoU alignment in {proj_name} space")
        proj_iou = _iou_alignment(
            proj_country_path, country_mask, proj_centroids, 1.0, tw, th,
        )
        matrix_proj = proj_iou[0]
        proj_f2 = proj_iou[1]
        print(f"  [Match] {proj_name} IoU F2={proj_f2:.4f}")

        # Compute the equirect affine that maps the same GADM bbox to the same pixel region
        matrix_eq_target = _compute_equirect_matrix(
            original_centroids, proj_centroids, matrix_proj, cos_lat,
        )

        # Build the un-projection remap
        progress("Building inverse projection warp")
        map_x, map_y = _build_unproject_remap(
            matrix_eq_target, matrix_proj,
            proj_fn, cos_lat, tw, th,
        )

        # Apply the warp to all CV images — the output is in equirectangular
        # space where straight GADM lat/lon lines align with straight color
        # cluster boundaries.
        progress("Applying inverse projection warp to cluster image")
        pixel_labels = cv2.remap(
            pixel_labels, map_x, map_y,
            cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT, borderValue=255,
        )
        country_mask = cv2.remap(
            country_mask, map_x, map_y,
            cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        )
        icp_mask = cv2.remap(
            icp_mask, map_x, map_y,
            cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        )
        print(f"  [Match] Warped pixel_labels to equirectangular space via {proj_name}")

    # Step 2: Extract border points
    progress("Extracting CV border points")
    external_border = _extract_cv_external_border(icp_mask)
    internal_border = _extract_cv_internal_border(pixel_labels, icp_mask)

    # Combine external + internal borders for matching
    cv_border_parts = []
    if len(external_border) > 0:
        cv_border_parts.append(external_border)
    if len(internal_border) > 0:
        cv_border_parts.append(internal_border)

    cv_border = np.vstack(cv_border_parts) if cv_border_parts else np.empty((0, 2), dtype=np.float64)

    progress("Preparing GADM boundary points")
    gadm_points = _prepare_gadm_boundary_points(
        country_path, division_paths, cos_lat
    )

    # Step 3: IoU-based alignment (primary)
    # Maximizes overlap between rasterized GADM country outline and CV mask.
    # This directly optimizes shape fitting, handling projection distortion,
    # offshore islands, and noisy borders naturally.
    progress("IoU shape alignment")
    iou_result = _iou_alignment(
        country_path, country_mask, centroids, cos_lat, tw, th,
    )
    matrix, iou_score_val, method = iou_result[0], iou_result[1], iou_result[2]
    inverse_H = iou_result[3] if len(iou_result) > 3 else None
    k_conic = iou_result[4] if len(iou_result) > 4 else 0.0
    inlier_ratio = iou_score_val
    print(f"  [Match] Raw alignment result: F2={iou_score_val:.4f} method={method} k_conic={k_conic:.4f}")

    gadm_mid_y_ecc = float(np.median([-c["cy"] for c in centroids]))

    # Legacy inverse perspective warp from the super-blur contour search in
    # _iou_alignment. Kept as a fallback if pyproj detection finds no projection.
    if inverse_H is not None:
        progress("Applying inverse perspective warp to cluster image")
        pixel_labels = cv2.warpPerspective(
            pixel_labels, inverse_H, (tw, th), flags=cv2.INTER_NEAREST
        )
        country_mask = cv2.warpPerspective(country_mask, inverse_H, (tw, th))
        # Re-warp icp_mask too — `cv_border` is extracted from it, and we
        # re-extract cv_border below so the alignment metrics describe the
        # post-warp images that actually drive division assignment.
        icp_mask = cv2.warpPerspective(icp_mask, inverse_H, (tw, th))
        print("  [Match] Warped labels with inverse homography")

        # Re-extract cv_border from the warped masks so alignmentError and
        # alignmentPct reflect the final image rather than the pre-warp shape.
        external_border_post = _extract_cv_external_border(icp_mask)
        internal_border_post = _extract_cv_internal_border(pixel_labels, icp_mask)
        cv_border_parts_post = []
        if len(external_border_post) > 0:
            cv_border_parts_post.append(external_border_post)
        if len(internal_border_post) > 0:
            cv_border_parts_post.append(internal_border_post)
        cv_border = (
            np.vstack(cv_border_parts_post) if cv_border_parts_post
            else np.empty((0, 2), dtype=np.float64)
        )

    # Step 3b: Verify centroid placement is reasonable with the IoU transform
    centroid_score = _score_centroid_placement(centroids, pixel_labels, cos_lat, matrix, tw, th)
    print(f"  [Match] IoU alignment: F2={iou_score_val:.3f}, centroid_hits={centroid_score:.0f}/{len(centroids)}, method={method}")

    # Step 3c: If IoU alignment gives poor centroid coverage, try centroid fallback
    if centroid_score < len(centroids) * 0.6:
        progress("Centroid fallback (IoU alignment had poor centroid coverage)")
        centroid_matrix, centroid_fb_score, centroid_method = _centroid_fallback(
            centroids, pixel_labels, country_mask, cos_lat,
            gadm_points, tw, th,
        )
        centroid_fb_hits = _score_centroid_placement(centroids, pixel_labels, cos_lat, centroid_matrix, tw, th)
        if centroid_fb_hits > centroid_score:
            matrix = centroid_matrix
            method = centroid_method
            # Reset k_conic — it was learned for the rejected IoU fit and
            # would otherwise be applied to division rasterization below,
            # mixing two different transforms.
            k_conic = 0.0
            print(f"  [Match] Centroid fallback better: hits={centroid_fb_hits:.0f} vs IoU hits={centroid_score:.0f}")

    # Compute alignment metrics — median (robust), mean, and % aligned
    median_err, mean_err, align_pct = _compute_alignment_error(
        gadm_points, cv_border, matrix, tw, th,
    )
    alignment_error = median_err  # Use median for the reported metric
    print(f"  [Match] Alignment: median_err={median_err:.1f}px, mean_err={mean_err:.1f}px, "
          f"alignment_pct={align_pct*100:.1f}% (within 2% of image diagonal)")

    # Extract sx, sy from matrix for the returned transform
    # matrix = [[a, b, tx], [c, d, ty]]
    # For partial affine: a = s*cos(theta), b = -s*sin(theta)
    sx = float(math.sqrt(matrix[0, 0] ** 2 + matrix[1, 0] ** 2))
    sy = float(math.sqrt(matrix[0, 1] ** 2 + matrix[1, 1] ** 2))

    # Step 5: Division polygon rasterization + voting
    progress("Rasterizing divisions and computing assignments")
    total_cluster_pixels = _compute_total_cluster_pixels(pixel_labels)

    div_assignments = []
    out_of_bounds = []

    for div in division_paths:
        div_id = div["id"]
        svg = div.get("svgPath", "")

        if not svg:
            out_of_bounds.append(div_id)
            continue

        # Rasterize division polygon (with conic correction if found)
        div_mask = _rasterize_division(svg, cos_lat, matrix, tw, th, k_conic=k_conic, gadm_mid_y=gadm_mid_y_ecc)

        # Count cluster votes
        votes, total_valid = _compute_cluster_votes(pixel_labels, div_mask)

        if total_valid < OUT_OF_BOUNDS_MIN_PX:
            out_of_bounds.append(div_id)
            continue

        if not votes:
            out_of_bounds.append(div_id)
            continue

        # Find dominant cluster
        sorted_votes = sorted(votes.items(), key=lambda x: x[1], reverse=True)
        dominant_cluster = sorted_votes[0][0]
        dominant_count = sorted_votes[0][1]
        confidence = dominant_count / total_valid

        # Split detection
        is_split = False
        split_clusters = []

        if confidence < SPLIT_CONFIDENCE and len(sorted_votes) > 1:
            is_split = True
        else:
            # Check if minority cluster would lose significant area
            for cluster_id, count in sorted_votes[1:]:
                cluster_total = total_cluster_pixels.get(cluster_id, 1)
                share_of_cluster = count / cluster_total
                if share_of_cluster > MINORITY_SHARE_FOR_SPLIT:
                    is_split = True
                    break

        if is_split:
            for cluster_id, count in sorted_votes:
                share = count / total_valid
                if share >= MINORITY_INCLUSION:
                    split_clusters.append({
                        "clusterId": cluster_id,
                        "share": round(share, 4),
                    })

        assignment: dict[str, Any] = {
            "divisionId": div_id,
            "clusterId": dominant_cluster,
            "confidence": round(confidence, 4),
            "isSplit": is_split,
        }
        if is_split:
            assignment["splitClusters"] = split_clusters

        div_assignments.append(assignment)

    # Step 6: Debug images
    progress("Generating debug images")
    debug_image = _build_debug_image(
        pixel_labels, color_centroids, division_paths, centroids,
        cos_lat, matrix, tw, th, orig_w, orig_h,
    )

    # Build return matrix as nested list (2x3 or 3x3)
    matrix_list = []
    for row in range(matrix.shape[0]):
        matrix_list.append([float(matrix[row, col]) for col in range(matrix.shape[1])])

    # Close the last open step then report total matching time.
    progress("")
    print(f"  [Match] Total matching time: {time.perf_counter() - _match_wall_start:.2f}s")

    return {
        "transform": {
            "matrix": matrix_list,
            "cosLat": cos_lat,
            "sx": sx,
            "sy": sy,
        },
        "divAssignments": div_assignments,
        "outOfBounds": out_of_bounds,
        "alignmentMethod": method,
        "alignmentError": round(alignment_error, 2),  # median boundary distance (px)
        "alignmentErrorMean": round(mean_err, 2),
        "alignmentPct": round(align_pct, 4),  # % of GADM boundary points within 2% of image diagonal
        "inlierRatio": round(inlier_ratio, 4),  # F2 shape overlap — can be misleading
        "debugImages": [debug_image],
    }
