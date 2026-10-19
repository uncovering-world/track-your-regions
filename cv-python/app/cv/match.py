"""RANSAC-based GADM-to-cluster matching algorithm.

Replaces the fragile JS ICP alignment with cv2.estimateAffinePartial2D + RANSAC.
Matches GADM administrative division boundaries to color clusters detected on
Wikivoyage travel maps.
"""

import logging
import math
import time
from collections import Counter
from collections.abc import Callable
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

    logger.info(f"[RANSAC] Init: sx={sx:.1f} sy={sy:.1f} tx={tx:.1f} ty={ty:.1f}")
    logger.info(f"[RANSAC] GADM range: X[{gadm_min[0]:.2f},{gadm_max[0]:.2f}] Y[{gadm_min[1]:.2f},{gadm_max[1]:.2f}]")
    logger.info(f"[RANSAC] CV range:   X[{cv_min[0]:.0f},{cv_max[0]:.0f}] Y[{cv_min[1]:.0f},{cv_max[1]:.0f}]")

    # Project GADM points with rough transform
    projected = gadm_points.copy()
    projected[:, 0] = gadm_points[:, 0] * sx + tx
    projected[:, 1] = gadm_points[:, 1] * sy + ty

    # Pre-filter: exclude GADM points that project outside the CV mask.
    # These are from offshore islands (Isla Mona, Desecheo) not in the CV silhouette.
    # Including them biases RANSAC toward a transform that accommodates the islands.
    in_image = (projected[:, 0] >= 0) & (projected[:, 0] < tw) & (projected[:, 1] >= 0) & (projected[:, 1] < th)
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
        logger.info(f"[RANSAC] Pre-filtered: {excluded_count} GADM pts outside CV mask (islands/decorations)")

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
    logger.info(
        f"[RANSAC] Correspondences: {valid.sum()}/{len(mainland_gadm)} within {max_dist:.0f}px (median dist={np.median(distances):.1f})"
    )

    if valid.sum() < 4:
        return None, 0.0, "ransac_affine"

    src = mainland_gadm[valid].astype(np.float32)
    dst = cv_border[indices[valid]].astype(np.float32)

    # Full affine estimation (6-param: independent sx, sy, rotation, shear, tx, ty)
    # Using full affine instead of partial because GADM X and Y have different
    # scales (longitude degrees vs latitude degrees, even after cosine correction)
    matrix, inlier_mask = cv2.estimateAffine2D(
        src,
        dst,
        method=cv2.RANSAC,
        ransacReprojThreshold=RANSAC_REPROJ_THRESHOLD,
    )

    if matrix is None or inlier_mask is None:
        logger.warning("[RANSAC] estimateAffinePartial2D returned None")
        return None, 0.0, "ransac_affine"

    inlier_ratio = float(inlier_mask.sum()) / len(inlier_mask)
    # Extract scale from the matrix: [[s*cos, -s*sin, tx], [s*sin, s*cos, ty]]
    a = matrix[0, 0]
    c = matrix[1, 0]
    scale = math.sqrt(a * a + c * c)
    rotation = math.degrees(math.atan2(c, a))
    logger.info(
        f"[RANSAC] Result: {int(inlier_mask.sum())}/{len(inlier_mask)} inliers ({inlier_ratio:.1%}), scale={scale:.1f}, rotation={rotation:.1f}°, tx={matrix[0,2]:.1f}, ty={matrix[1,2]:.1f}"
    )

    if inlier_ratio < FALLBACK_INLIER_RATIO:
        logger.info(
            f"[RANSAC] Inlier ratio {inlier_ratio:.1%} < {FALLBACK_INLIER_RATIO:.0%} threshold — will try fallback"
        )
        return None, inlier_ratio, "ransac_affine"

    return matrix, inlier_ratio, "ransac_affine"


def _inverse_homography(  # noqa: C901 -- above the complexity ceiling of 15; #1654 splits it under the ceiling
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
            idx = np.searchsorted(ext_angles, a_norm, side="right") - 1
            idx = max(0, min(idx, len(hull_pts) - 1))
            next_idx = (idx + 1) % len(hull_pts)
            # Interpolate
            a0 = ext_angles[idx]
            a1 = ext_angles[idx + 1] if idx + 1 < len(ext_angles) else ext_angles[0] + 2 * np.pi
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

    logger.info(f"[InvHomo] Hull match: {len(gadm_hull)} GADM + {len(cv_hull)} CV hull vertices → {N} correspondences")

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
        logger.info(f"[InvHomo] {label}: {inl}/{N} inliers ({inl/N:.0%}), F2={f2:.3f}")
        if f2 > best_f2:
            best_f2 = f2
            best_H = H_full
            best_label = label

    if best_H is None:
        return None

    logger.info(f"[InvHomo] Best: {best_label}, F2={best_f2:.3f}")
    if best_H.shape == (3, 3):
        logger.info(f"[InvHomo] Perspective: [{best_H[2,0]:.8f}, {best_H[2,1]:.8f}]")
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


def _centroid_fallback(  # noqa: C901 -- above the complexity ceiling of 15; #1654 splits it under the ceiling
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
                        centroids,
                        pixel_labels,
                        cos_lat,
                        sx,
                        sy,
                        txc,
                        tyc,
                        tw,
                        th,
                        cluster_sizes,
                        large_threshold,
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
                        centroids,
                        pixel_labels,
                        cos_lat,
                        sx,
                        sy,
                        btx + dtx,
                        bty + dty,
                        tw,
                        th,
                        cluster_sizes,
                        large_threshold,
                    )
                    if score > best_score:
                        best_score = score
                        best_params = (sx, sy, btx + dtx, bty + dty)

    fsx, fsy, ftx, fty = best_params
    logger.info(f"[Centroid] Best: sx={fsx:.1f} sy={fsy:.1f} tx={ftx:.1f} ty={fty:.1f} score={best_score:.1f}")
    logger.info(f"[Centroid] Init: sx={sx0:.1f} sy={sy0:.1f} tx={tx0:.1f} ty={ty0:.1f}")
    logger.info(f"[Centroid] Scale factors: sx_f={fsx/sx0:.3f} sy_f={fsy/sy0:.3f}")
    # Build 2x3 affine matrix (no rotation)
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


def run_matching(  # noqa: C901 -- above the complexity ceiling of 15; #1654 splits it under the ceiling
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
            logger.info(f"[Match] {current_step[0]} done in {elapsed:.2f}s")
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
        logger.info(
            f"[Match] Phantom-island filter: kept {len(mainland_centroids)}/{len(centroids)} mainland centroids (excluded divisions: {excluded_ids})"
        )
        centroids = mainland_centroids

    # Step 1b: Projection detection — test conic projections against CV mask.
    # Small regions near the equator don't benefit from conic projection
    # detection (lat_span < threshold): skip the ~50-candidate pyproj loop.
    cy_vals = np.array([c["cy"] for c in centroids])
    lat_span_deg = float(cy_vals.max() - cy_vals.min())
    if lat_span_deg < PROJ_DETECT_MIN_LAT_SPAN_DEG:
        logger.info(
            f"[Match] Skipping projection detection: lat_span={lat_span_deg:.1f}° < {PROJ_DETECT_MIN_LAT_SPAN_DEG}°"
        )
        proj_result = None
    else:
        progress("Detecting map projection")
        proj_result = detect_projection(
            country_path,
            country_mask,
            centroids,
            cos_lat,
            tw,
            th,
        )
    original_centroids = centroids
    if proj_result is not None:
        proj_name, proj_fn = proj_result
        logger.info(f"[Match] Candidate projection: {proj_name}")

        # Pre-project GADM temporarily to get a good IoU alignment in projected space
        proj_country_path = project_svg_path(country_path, proj_fn)
        proj_centroids = []
        for c in centroids:
            svg_x = np.array([c["cx"]])
            svg_y = np.array([-c["cy"]])
            lx, ly = proj_fn(svg_x, svg_y)
            proj_centroids.append({**c, "cx": float(lx[0]), "cy": float(-ly[0])})

        # Run a quick IoU alignment in projected space
        progress(f"IoU alignment in {proj_name} space")
        proj_iou = iou_alignment(
            proj_country_path,
            country_mask,
            proj_centroids,
            1.0,
            tw,
            th,
        )
        matrix_proj = proj_iou[0]
        proj_f2 = proj_iou[1]
        logger.info(f"[Match] {proj_name} IoU F2={proj_f2:.4f}")

        # Compute the equirect affine that maps the same GADM bbox to the same pixel region
        matrix_eq_target = _compute_equirect_matrix(
            original_centroids,
            proj_centroids,
            matrix_proj,
            cos_lat,
        )

        # Build the un-projection remap
        progress("Building inverse projection warp")
        map_x, map_y = _build_unproject_remap(
            matrix_eq_target,
            matrix_proj,
            proj_fn,
            cos_lat,
            tw,
            th,
        )

        # Apply the warp to all CV images — the output is in equirectangular
        # space where straight GADM lat/lon lines align with straight color
        # cluster boundaries.
        progress("Applying inverse projection warp to cluster image")
        pixel_labels = cv2.remap(
            pixel_labels,
            map_x,
            map_y,
            cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=255,
        )
        country_mask = cv2.remap(
            country_mask,
            map_x,
            map_y,
            cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
        icp_mask = cv2.remap(
            icp_mask,
            map_x,
            map_y,
            cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
        logger.info(f"[Match] Warped pixel_labels to equirectangular space via {proj_name}")

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
    gadm_points = _prepare_gadm_boundary_points(country_path, division_paths, cos_lat)

    # Step 3: IoU-based alignment (primary)
    # Maximizes overlap between rasterized GADM country outline and CV mask.
    # This directly optimizes shape fitting, handling projection distortion,
    # offshore islands, and noisy borders naturally.
    progress("IoU shape alignment")
    iou_result = iou_alignment(
        country_path,
        country_mask,
        centroids,
        cos_lat,
        tw,
        th,
    )
    matrix, iou_score_val, method = iou_result[0], iou_result[1], iou_result[2]
    inverse_H = iou_result[3] if len(iou_result) > 3 else None
    k_conic = iou_result[4] if len(iou_result) > 4 else 0.0
    # Global X pivot used when learning k_conic — must be threaded into
    # _rasterize_division so the per-division conic warp matches the
    # transform that was scored.
    gadm_cx_corr = iou_result[5]
    inlier_ratio = iou_score_val
    logger.info(f"[Match] Raw alignment result: F2={iou_score_val:.4f} method={method} k_conic={k_conic:.4f}")

    gadm_mid_y_ecc = float(np.median([-c["cy"] for c in centroids]))

    # Inverse perspective warp from the super-blur contour search in
    # iou_alignment: the fallback when pyproj detection finds no projection.
    if inverse_H is not None:
        progress("Applying inverse perspective warp to cluster image")
        pixel_labels = cv2.warpPerspective(pixel_labels, inverse_H, (tw, th), flags=cv2.INTER_NEAREST)
        country_mask = cv2.warpPerspective(country_mask, inverse_H, (tw, th))
        # Re-warp icp_mask too — `cv_border` is extracted from it, and we
        # re-extract cv_border below so the alignment metrics describe the
        # post-warp images that actually drive division assignment.
        icp_mask = cv2.warpPerspective(icp_mask, inverse_H, (tw, th))
        logger.info("[Match] Warped labels with inverse homography")

        # Re-extract cv_border from the warped masks so alignmentError and
        # alignmentPct reflect the final image rather than the pre-warp shape.
        external_border_post = _extract_cv_external_border(icp_mask)
        internal_border_post = _extract_cv_internal_border(pixel_labels, icp_mask)
        cv_border_parts_post = []
        if len(external_border_post) > 0:
            cv_border_parts_post.append(external_border_post)
        if len(internal_border_post) > 0:
            cv_border_parts_post.append(internal_border_post)
        cv_border = np.vstack(cv_border_parts_post) if cv_border_parts_post else np.empty((0, 2), dtype=np.float64)

    # Step 3b: Verify centroid placement is reasonable with the IoU transform
    centroid_score = _score_centroid_placement(centroids, pixel_labels, cos_lat, matrix, tw, th)
    logger.info(
        f"[Match] IoU alignment: F2={iou_score_val:.3f}, centroid_hits={centroid_score:.0f}/{len(centroids)}, method={method}"
    )

    # Step 3c: If IoU alignment gives poor centroid coverage, try centroid fallback
    if centroid_score < len(centroids) * 0.6:
        progress("Centroid fallback (IoU alignment had poor centroid coverage)")
        centroid_matrix, centroid_fb_score, centroid_method = _centroid_fallback(
            centroids,
            pixel_labels,
            country_mask,
            cos_lat,
            gadm_points,
            tw,
            th,
        )
        centroid_fb_hits = _score_centroid_placement(centroids, pixel_labels, cos_lat, centroid_matrix, tw, th)
        if centroid_fb_hits > centroid_score:
            matrix = centroid_matrix
            method = centroid_method
            # Reset k_conic — it was learned for the rejected IoU fit and
            # would otherwise be applied to division rasterization below,
            # mixing two different transforms.
            k_conic = 0.0
            logger.info(
                f"[Match] Centroid fallback better: hits={centroid_fb_hits:.0f} vs IoU hits={centroid_score:.0f}"
            )

    # Compute alignment metrics — median (robust), mean, and % aligned
    median_err, mean_err, align_pct = _compute_alignment_error(
        gadm_points,
        cv_border,
        matrix,
        tw,
        th,
    )
    alignment_error = median_err  # Use median for the reported metric
    logger.info(
        f"[Match] Alignment: median_err={median_err:.1f}px, mean_err={mean_err:.1f}px, "
        f"alignment_pct={align_pct*100:.1f}% (within 2% of image diagonal)"
    )

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
        div_mask = _rasterize_division(
            svg, cos_lat, matrix, tw, th, k_conic=k_conic, gadm_mid_y=gadm_mid_y_ecc, gadm_mid_x_corr=gadm_cx_corr
        )

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
                    split_clusters.append(
                        {
                            "clusterId": cluster_id,
                            "share": round(share, 4),
                        }
                    )

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
        pixel_labels,
        color_centroids,
        division_paths,
        centroids,
        cos_lat,
        matrix,
        tw,
        th,
        orig_w,
        orig_h,
    )

    # Build return matrix as nested list (2x3 or 3x3)
    matrix_list = []
    for row in range(matrix.shape[0]):
        matrix_list.append([float(matrix[row, col]) for col in range(matrix.shape[1])])

    # Close the last open step then report total matching time.
    progress("")
    logger.info(f"[Match] Total matching time: {time.perf_counter() - _match_wall_start:.2f}s")

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
