"""GADM-to-cluster matching algorithm.

Aligns the GADM outline to the map's mask by IoU (app/cv/iou_alignment.py),
with a centroid grid search as its fallback.
Matches GADM administrative division boundaries to color clusters detected on
Wikivoyage travel maps.
"""

import logging
import math
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
from scipy.spatial import KDTree

from ..utils.image import encode_png_base64, resize_image
from .iou_alignment import iou_alignment
from .projection import detect_projection, project_svg_path
from .svg_parse import parse_svg_path_points, parse_svg_sub_paths, resample_path

logger = logging.getLogger(__name__)

# --- Constants (preserved from JS implementation) ---
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
        (padded[1:-1, :-2] == 0) | (padded[1:-1, 2:] == 0) | (padded[:-2, 1:-1] == 0) | (padded[2:, 1:-1] == 0)
    )
    ys, xs = np.where((mask != 0) & has_zero_neighbor)
    if len(xs) == 0:
        return np.empty((0, 2), dtype=np.float64)
    return np.column_stack([xs, ys]).astype(np.float64)


def _extract_cv_internal_border(pixel_labels: np.ndarray, mask: np.ndarray) -> np.ndarray:
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
        ((padded_mask[:-2, 1:-1] != 0) & (padded_lab[:-2, 1:-1] != lab))
        | ((padded_mask[2:, 1:-1] != 0) & (padded_lab[2:, 1:-1] != lab))
        | ((padded_mask[1:-1, :-2] != 0) & (padded_lab[1:-1, :-2] != lab))
        | ((padded_mask[1:-1, 2:] != 0) & (padded_lab[1:-1, 2:] != lab))
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


def _centroid_extent_transform(
    centroids: list[dict],
    country_mask: np.ndarray,
    cos_lat: float,
    gadm_points: np.ndarray,
    tw: int,
    th: int,
) -> tuple[float, float, float, float]:
    """The scale and translation (sx, sy, tx, ty) that map the centroids' extent onto the mask's.

    Centroids give the GADM extent, not boundary points, which include offshore
    islets that inflate the bbox; the CV mask gives the pixel extent, not the full
    image, which the silhouette may not fill.
    """
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
    inlier = np.abs(raw_cx - np.median(raw_cx)) < 30
    if inlier.sum() < 3:
        inlier = np.ones(len(raw_cx), dtype=bool)
    cx_arr = raw_cx[inlier] * cos_lat
    cy_arr = -raw_cy[inlier]  # Y-negation for SVG
    # A 5% margin, since centroids are interior points, not edges
    margin_x = (cx_arr.max() - cx_arr.min()) * 0.05
    margin_y = (cy_arr.max() - cy_arr.min()) * 0.05
    gadm_min_x, gadm_max_x = cx_arr.min() - margin_x, cx_arr.max() + margin_x
    gadm_min_y, gadm_max_y = cy_arr.min() - margin_y, cy_arr.max() + margin_y

    gadm_w = gadm_max_x - gadm_min_x
    gadm_h = gadm_max_y - gadm_min_y
    if not (gadm_w > 0 and gadm_h > 0):
        return _compute_initial_transform(gadm_points, tw, th)
    sx0 = (cv_max_x - cv_min_x) / gadm_w
    sy0 = (cv_max_y - cv_min_y) / gadm_h
    tx0 = (cv_min_x + cv_max_x) / 2.0 - (gadm_min_x + gadm_max_x) / 2.0 * sx0
    ty0 = (cv_min_y + cv_max_y) / 2.0 - (gadm_min_y + gadm_max_y) / 2.0 * sy0
    return sx0, sy0, tx0, ty0


def _cluster_sizes(pixel_labels: np.ndarray) -> dict[int, int]:
    """The pixel count of every cluster present, for weighting the centroid score."""
    sizes: dict[int, int] = {}
    for label_val in range(255):
        count = int(np.sum(pixel_labels == label_val))
        if count > 0:
            sizes[label_val] = count
    return sizes


def _best_on_grid(
    score_of: Callable[[float, float, float, float], float],
    best: tuple[float, tuple[float, float, float, float]],
    base: tuple[float, float, float, float],
    scale_factors: tuple[Any, Any],
    offsets: tuple[range, range],
) -> tuple[float, tuple[float, float, float, float]]:
    """The best (score, params) of best and every scale factor × translation offset around base."""
    best_score, best_params = best
    bsx, bsy, btx, bty = base
    for sx_f in scale_factors[0]:
        for sy_f in scale_factors[1]:
            sx = bsx * sx_f
            sy = bsy * sy_f
            for tx_off in offsets[0]:
                for ty_off in offsets[1]:
                    score = score_of(sx, sy, btx + tx_off, bty + ty_off)
                    if score > best_score:
                        best_score = score
                        best_params = (sx, sy, btx + tx_off, bty + ty_off)
    return best_score, best_params


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

    initial = _centroid_extent_transform(centroids, country_mask, cos_lat, gadm_points, tw, th)
    cluster_sizes = _cluster_sizes(pixel_labels)
    # A "large" cluster is over 5% of the country's area
    large_threshold = max(int(country_mask.sum()), 1) * 0.05

    def score_of(sx: float, sy: float, tx: float, ty: float) -> float:
        return _score_centroid_alignment(
            centroids, pixel_labels, cos_lat, sx, sy, tx, ty, tw, th, cluster_sizes, large_threshold
        )

    # Coarse: scale ±25% for X, ±20% for Y, translation ±20 px
    best = _best_on_grid(
        score_of,
        (-1.0, initial),
        initial,
        (np.arange(0.75, 1.26, 0.05), np.arange(0.80, 1.21, 0.05)),
        (range(-20, 21, 4), range(-15, 16, 3)),
    )
    # Fine: ±2% scale, ±3 px translation around the coarse winner
    fine_factors = [1 + d for d in np.arange(-0.02, 0.021, 0.005)]
    best_score, (fsx, fsy, ftx, fty) = _best_on_grid(
        score_of, best, best[1], (fine_factors, fine_factors), (range(-3, 4), range(-3, 4))
    )

    sx0, sy0, tx0, ty0 = initial
    logger.info(f"[Centroid] Best: sx={fsx:.1f} sy={fsy:.1f} tx={ftx:.1f} ty={fty:.1f} score={best_score:.1f}")
    logger.info(f"[Centroid] Init: sx={sx0:.1f} sy={sy0:.1f} tx={tx0:.1f} ty={ty0:.1f}")
    logger.info(f"[Centroid] Scale factors: sx_f={fsx / sx0:.3f} sy_f={fsy / sy0:.3f}")
    # A 2x3 affine matrix (no rotation)
    matrix = np.array(
        [
            [fsx, 0.0, ftx],
            [0.0, fsy, fty],
        ],
        dtype=np.float64,
    )
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
    gadm_mid_x_corr: float = 0.0,
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
            # Linear conic: scale X around the GLOBAL country-wide pivot that
            # iou_alignment used when learning k_conic — using the local
            # per-division mean here would apply the warp around a different
            # center and silently shift each division's absolute placement,
            # making the rendered masks disagree with the scored transform.
            cx_center = gadm_mid_x_corr
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
            (projected[:, 0] >= -margin)
            & (projected[:, 0] < tw + margin)
            & (projected[:, 1] >= -margin)
            & (projected[:, 1] < th + margin)
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
            cv2.polylines(debug_img, [polyline], isClosed=True, color=(255, 255, 255), thickness=1)

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
        indexing="ij",
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


class _StepTimer:
    """The progress callback that also times each step.

    Each call closes the previous step and logs its elapsed time, then opens a
    new step named msg; finish() closes the last one and logs the total.
    """

    def __init__(self, on_progress: Callable[[str], None] | None) -> None:
        self.on_progress = on_progress
        self.started = time.perf_counter()
        self.step = ""
        self.step_start = self.started

    def __call__(self, msg: str) -> None:
        now = time.perf_counter()
        if self.step:
            logger.info(f"[Match] {self.step} done in {now - self.step_start:.2f}s")
        if msg and self.on_progress:
            self.on_progress(msg)
        self.step = msg
        self.step_start = now

    def finish(self) -> None:
        self("")
        logger.info(f"[Match] Total matching time: {time.perf_counter() - self.started:.2f}s")


@dataclass
class _MapImages:
    """The three images matching reads, warped together whenever one is."""

    pixel_labels: np.ndarray
    country_mask: np.ndarray
    icp_mask: np.ndarray


def _cv_border(images: _MapImages) -> np.ndarray:
    """The CV border points matching measures against: external then internal."""
    parts = [
        border
        for border in (
            _extract_cv_external_border(images.icp_mask),
            _extract_cv_internal_border(images.pixel_labels, images.icp_mask),
        )
        if len(border) > 0
    ]
    return np.vstack(parts) if parts else np.empty((0, 2), dtype=np.float64)


def _mainland(centroids: list[dict], cos_lat: float) -> list[dict]:
    """The centroids of the largest spatial cluster.

    GADM may include distant islands (Cocos for Costa Rica, Aleutians for
    Alaska) not shown on the Wikivoyage map; their centroids inflate the GADM
    bbox and break scale/translation search. Division voting still considers
    every division_path — missing-on-map ones just fall into out_of_bounds.
    """
    mainland_centroids, excluded_ids = _filter_to_mainland(centroids, cos_lat)
    if len(mainland_centroids) == len(centroids):
        return centroids
    logger.info(
        f"[Match] Phantom-island filter: kept {len(mainland_centroids)}/{len(centroids)} mainland centroids (excluded divisions: {excluded_ids})"
    )
    return mainland_centroids


def _projection(
    country_path: str,
    country_mask: np.ndarray,
    centroids: list[dict],
    cos_lat: float,
    tw: int,
    th: int,
    progress: _StepTimer,
) -> tuple[str, Callable] | None:
    """The projection the map was drawn in, when the region is tall enough to tell.

    Small regions near the equator don't benefit from conic projection
    detection (lat_span < threshold): the ~50-candidate pyproj loop is skipped.
    """
    cy_vals = np.array([c["cy"] for c in centroids])
    lat_span_deg = float(cy_vals.max() - cy_vals.min())
    if lat_span_deg < PROJ_DETECT_MIN_LAT_SPAN_DEG:
        logger.info(
            f"[Match] Skipping projection detection: lat_span={lat_span_deg:.1f}° < {PROJ_DETECT_MIN_LAT_SPAN_DEG}°"
        )
        return None
    progress("Detecting map projection")
    return detect_projection(country_path, country_mask, centroids, cos_lat, tw, th)


def _unproject(
    images: _MapImages,
    proj_name: str,
    proj_fn: Callable,
    country_path: str,
    centroids: list[dict],
    cos_lat: float,
    tw: int,
    th: int,
    progress: _StepTimer,
) -> _MapImages:
    """The images warped from the map's projection into equirectangular space.

    There straight GADM lat/lon lines align with straight colour cluster
    boundaries. GADM is pre-projected for a quick IoU alignment in projected
    space, and the equirectangular affine that maps the same GADM bbox to the
    same pixel region gives the un-projection remap.
    """
    logger.info(f"[Match] Candidate projection: {proj_name}")
    proj_country_path = project_svg_path(country_path, proj_fn)
    # One call for every centroid: pyproj's single-point path converts a one-element
    # array to a scalar, which NumPy deprecates.
    lx, ly = proj_fn(np.array([c["cx"] for c in centroids], float), np.array([-c["cy"] for c in centroids], float))
    proj_centroids = [{**c, "cx": float(x), "cy": float(-y)} for c, x, y in zip(centroids, lx, ly, strict=True)]

    progress(f"IoU alignment in {proj_name} space")
    matrix_proj, proj_f2, *_ = iou_alignment(proj_country_path, images.country_mask, proj_centroids, 1.0, tw, th)
    logger.info(f"[Match] {proj_name} IoU F2={proj_f2:.4f}")
    matrix_eq_target = _compute_equirect_matrix(centroids, proj_centroids, matrix_proj, cos_lat)

    progress("Building inverse projection warp")
    map_x, map_y = _build_unproject_remap(matrix_eq_target, matrix_proj, proj_fn, cos_lat, tw, th)

    progress("Applying inverse projection warp to cluster image")

    def remap(img: np.ndarray, border: int) -> np.ndarray:
        return cv2.remap(img, map_x, map_y, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=border)

    warped = _MapImages(
        pixel_labels=remap(images.pixel_labels, 255),
        country_mask=remap(images.country_mask, 0),
        icp_mask=remap(images.icp_mask, 0),
    )
    logger.info(f"[Match] Warped pixel_labels to equirectangular space via {proj_name}")
    return warped


def _undo_perspective(images: _MapImages, inverse_h: np.ndarray, tw: int, th: int, progress: _StepTimer) -> _MapImages:
    """The images warped by the alignment's inverse homography: the fallback when no projection was found.

    icp_mask is warped too, since the CV border is extracted from it, so the
    alignment metrics describe the post-warp images that drive the assignment.
    """
    progress("Applying inverse perspective warp to cluster image")
    warped = _MapImages(
        pixel_labels=cv2.warpPerspective(images.pixel_labels, inverse_h, (tw, th), flags=cv2.INTER_NEAREST),
        country_mask=cv2.warpPerspective(images.country_mask, inverse_h, (tw, th)),
        icp_mask=cv2.warpPerspective(images.icp_mask, inverse_h, (tw, th)),
    )
    logger.info("[Match] Warped labels with inverse homography")
    return warped


def _best_of_centroid_fallback(
    alignment: tuple[np.ndarray, str, float],
    f2: float,
    centroids: list[dict],
    images: _MapImages,
    cos_lat: float,
    gadm_points: np.ndarray,
    tw: int,
    th: int,
    progress: _StepTimer,
) -> tuple[np.ndarray, str, float]:
    """The alignment (matrix, method, k_conic), replaced by the centroid fallback when the
    alignment places too few centroids on the clusters and the fallback places more.
    """
    matrix, method, _ = alignment
    centroid_score = _score_centroid_placement(centroids, images.pixel_labels, cos_lat, matrix, tw, th)
    logger.info(
        f"[Match] IoU alignment: F2={f2:.3f}, centroid_hits={centroid_score:.0f}/{len(centroids)}, method={method}"
    )
    if centroid_score >= len(centroids) * 0.6:
        return alignment

    progress("Centroid fallback (IoU alignment had poor centroid coverage)")
    centroid_matrix, _, centroid_method = _centroid_fallback(
        centroids, images.pixel_labels, images.country_mask, cos_lat, gadm_points, tw, th
    )
    centroid_fb_hits = _score_centroid_placement(centroids, images.pixel_labels, cos_lat, centroid_matrix, tw, th)
    if centroid_fb_hits <= centroid_score:
        return alignment
    logger.info(f"[Match] Centroid fallback better: hits={centroid_fb_hits:.0f} vs IoU hits={centroid_score:.0f}")
    # k_conic was learned for the rejected IoU fit; applied to the division
    # rasterization below it would mix two different transforms.
    return centroid_matrix, centroid_method, 0.0


def _split_clusters(
    sorted_votes: list[tuple[int, int]],
    total_valid: int,
    confidence: float,
    total_cluster_pixels: dict[int, int],
) -> list[dict] | None:
    """The clusters a division is split between, or None when it is not split.

    A division is split when its dominant cluster holds too little of it, or when
    a minority cluster would lose a significant share of its own area.
    """
    is_split = confidence < SPLIT_CONFIDENCE and len(sorted_votes) > 1
    if not is_split:
        is_split = any(
            count / total_cluster_pixels.get(cluster_id, 1) > MINORITY_SHARE_FOR_SPLIT
            for cluster_id, count in sorted_votes[1:]
        )
    if not is_split:
        return None
    return [
        {"clusterId": cluster_id, "share": round(count / total_valid, 4)}
        for cluster_id, count in sorted_votes
        if count / total_valid >= MINORITY_INCLUSION
    ]


def _assign_division(
    div_mask: np.ndarray,
    div_id: Any,
    pixel_labels: np.ndarray,
    total_cluster_pixels: dict[int, int],
) -> dict[str, Any] | None:
    """The division's dominant cluster from its pixels' votes, or None when it is out of bounds."""
    votes, total_valid = _compute_cluster_votes(pixel_labels, div_mask)
    if total_valid < OUT_OF_BOUNDS_MIN_PX or not votes:
        return None
    sorted_votes = sorted(votes.items(), key=lambda x: x[1], reverse=True)
    dominant_cluster, dominant_count = sorted_votes[0]
    confidence = dominant_count / total_valid
    split_clusters = _split_clusters(sorted_votes, total_valid, confidence, total_cluster_pixels)

    assignment: dict[str, Any] = {
        "divisionId": div_id,
        "clusterId": dominant_cluster,
        "confidence": round(confidence, 4),
        "isSplit": split_clusters is not None,
    }
    if split_clusters is not None:
        assignment["splitClusters"] = split_clusters
    return assignment


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
    """Run GADM-to-cluster matching: IoU alignment, then the division vote.

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
    progress = _StepTimer(on_progress)

    progress("Computing cosine latitude correction")
    cos_lat = _compute_cos_lat(country_bbox["minY"], country_bbox["maxY"])
    centroids = _mainland(centroids, cos_lat)

    images = _MapImages(pixel_labels, country_mask, icp_mask)
    proj_result = _projection(country_path, images.country_mask, centroids, cos_lat, tw, th, progress)
    if proj_result is not None:
        images = _unproject(images, *proj_result, country_path, centroids, cos_lat, tw, th, progress)

    progress("Extracting CV border points")
    cv_border = _cv_border(images)

    progress("Preparing GADM boundary points")
    gadm_points = _prepare_gadm_boundary_points(country_path, division_paths, cos_lat)

    # IoU-based alignment (primary) maximizes the overlap between the rasterized
    # GADM country outline and the CV mask, which handles projection distortion,
    # offshore islands and noisy borders naturally.
    progress("IoU shape alignment")
    matrix, inlier_ratio, method, inverse_h, k_conic, gadm_cx_corr = iou_alignment(
        country_path, images.country_mask, centroids, cos_lat, tw, th
    )
    logger.info(f"[Match] Raw alignment result: F2={inlier_ratio:.4f} method={method} k_conic={k_conic:.4f}")
    gadm_mid_y_ecc = float(np.median([-c["cy"] for c in centroids]))

    if inverse_h is not None:
        images = _undo_perspective(images, inverse_h, tw, th, progress)
        cv_border = _cv_border(images)

    matrix, method, k_conic = _best_of_centroid_fallback(
        (matrix, method, k_conic), inlier_ratio, centroids, images, cos_lat, gadm_points, tw, th, progress
    )

    median_err, mean_err, align_pct = _compute_alignment_error(gadm_points, cv_border, matrix, tw, th)
    logger.info(
        f"[Match] Alignment: median_err={median_err:.1f}px, mean_err={mean_err:.1f}px, "
        f"alignment_pct={align_pct * 100:.1f}% (within 2% of image diagonal)"
    )

    # matrix = [[a, b, tx], [c, d, ty]]; for a partial affine a = s*cos(theta), b = -s*sin(theta)
    sx = float(math.sqrt(matrix[0, 0] ** 2 + matrix[1, 0] ** 2))
    sy = float(math.sqrt(matrix[0, 1] ** 2 + matrix[1, 1] ** 2))

    progress("Rasterizing divisions and computing assignments")
    total_cluster_pixels = _compute_total_cluster_pixels(images.pixel_labels)
    div_assignments = []
    out_of_bounds = []
    for div in division_paths:
        svg = div.get("svgPath", "")
        assignment = None
        if svg:
            div_mask = _rasterize_division(
                svg, cos_lat, matrix, tw, th, k_conic=k_conic, gadm_mid_y=gadm_mid_y_ecc, gadm_mid_x_corr=gadm_cx_corr
            )
            assignment = _assign_division(div_mask, div["id"], images.pixel_labels, total_cluster_pixels)
        if assignment is None:
            out_of_bounds.append(div["id"])
        else:
            div_assignments.append(assignment)

    progress("Generating debug images")
    debug_image = _build_debug_image(
        images.pixel_labels, color_centroids, division_paths, centroids, cos_lat, matrix, tw, th, orig_w, orig_h
    )
    matrix_list = [[float(matrix[row, col]) for col in range(matrix.shape[1])] for row in range(matrix.shape[0])]
    progress.finish()

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
        "alignmentError": round(median_err, 2),  # median boundary distance (px)
        "alignmentErrorMean": round(mean_err, 2),
        "alignmentPct": round(align_pct, 4),  # % of GADM boundary points within 2% of image diagonal
        "inlierRatio": round(inlier_ratio, 4),  # F2 shape overlap — can be misleading
        "debugImages": [debug_image],
    }
