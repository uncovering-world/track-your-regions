"""IoU alignment: the transform that lays a GADM country outline over a map's mask.

The search is an affine fit first: template matching over candidate scales, then
translation and scale refinements, all scored by F2 on smoothed shapes. While
that fit is close but not perfect, a conic term, a shear and a perspective warp
are each searched on top of it and kept when they raise F2.
"""

import logging
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass

import cv2
import numpy as np
from scipy.spatial import KDTree

from .svg_parse import parse_svg_sub_paths

logger = logging.getLogger(__name__)

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

# The scale search draws at most this many sub-paths, the largest by point
# count: small island fragments add noise and slow rasterization dramatically.
SCALE_SEARCH_PATHS = 200

Params = tuple[float, float, float, float]
AlignmentResult = tuple[np.ndarray, float, str, np.ndarray | None, float, float]


@dataclass
class _Search:
    """What every stage of one search reads: the outline, the mask and the frame."""

    country_mask: np.ndarray
    cos_lat: float
    tw: int
    th: int
    # Every sub-path inside the centroid extent, and the ones the F2 scoring
    # draws: the largest of them, narrowed again to those the affine fit lays
    # over the mask.
    sub_paths: list[np.ndarray]
    search_paths: list[np.ndarray]
    # The centre of the centroid extent, X cos-corrected: the pivot of the
    # scale refinements and of the conic warp.
    gadm_cx: float
    gadm_cy: float
    # The mask smoothed (close + open) for F2, and dilated a little as the
    # boundary the drawn outline is clipped to.
    smooth_kernel: np.ndarray
    mask_smooth: np.ndarray
    clip_mask: np.ndarray
    # The scales the extent and the outline give, the search's starting points.
    sx0: float
    sy0: float
    sx_outline: float
    sy_outline: float


def _identity() -> AlignmentResult:
    return np.eye(2, 3, dtype=np.float64), 0.0, "iou_align", None, 0.0, 0.0


def _affine_matrix(fsx: float, fsy: float, ftx: float, fty: float) -> np.ndarray:
    return np.array(
        [
            [fsx, 0.0, ftx],
            [0.0, fsy, fty],
        ],
        dtype=np.float64,
    )


def _inlier_centroids(centroids: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """The centroids' degrees without the antimeridian outliers.

    Some divisions (e.g., Aleutians West in Alaska) cross 180° longitude,
    producing centroids far from the mainland that skew the bbox.
    """
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
        logger.info(f"[IoU] Excluded {excluded} antimeridian outlier centroids: {excluded_names}")
    return raw_cx[inlier_mask], raw_cy[inlier_mask]


def _paths_within_extent(
    all_sub_paths: list[np.ndarray],
    cx_arr: np.ndarray,
    cy_arr: np.ndarray,
    cos_lat: float,
) -> list[np.ndarray]:
    """The sub-paths overlapping the centroid extent (+ 15% margin).

    This removes far-off islands (e.g., Aleutian chain) that the map doesn't show.
    """
    gx_range = cx_arr.max() - cx_arr.min()
    gy_range = cy_arr.max() - cy_arr.min()
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
        if sp_max_x >= raw_gx0 and sp_min_x <= raw_gx1 and sp_max_y >= raw_gy0 and sp_min_y <= raw_gy1:
            sub_paths.append(sp)

    if not sub_paths:
        sub_paths = all_sub_paths  # fallback: keep all
    if len(sub_paths) < len(all_sub_paths):
        logger.info(f"[IoU] Filtered sub-paths: {len(sub_paths)}/{len(all_sub_paths)} kept (within centroid extent)")
    return sub_paths


def _outline_scale(
    sub_paths: list[np.ndarray],
    cos_lat: float,
    cv_w: float,
    cv_h: float,
    centroid_scale: tuple[float, float],
) -> tuple[float, float]:
    """The scale the outline's own extent gives, or the centroids' when it is flat."""
    outline_min_x = min(sp[:, 0].min() for sp in sub_paths) * cos_lat
    outline_max_x = max(sp[:, 0].max() for sp in sub_paths) * cos_lat
    outline_min_y = min(sp[:, 1].min() for sp in sub_paths)
    outline_max_y = max(sp[:, 1].max() for sp in sub_paths)
    outline_w = outline_max_x - outline_min_x
    outline_h = outline_max_y - outline_min_y
    if outline_w > 0 and outline_h > 0:
        return cv_w / outline_w, cv_h / outline_h
    return centroid_scale


def _scale_search_paths(sub_paths: list[np.ndarray]) -> list[np.ndarray]:
    """The largest sub-paths, which the scale search draws; the rest are noise to it."""
    if len(sub_paths) <= SCALE_SEARCH_PATHS:
        return sub_paths
    sorted_by_size = sorted(sub_paths, key=len, reverse=True)
    search_paths = sorted_by_size[:SCALE_SEARCH_PATHS]
    logger.info(f"[IoU] Using {len(search_paths)}/{len(sub_paths)} largest sub-paths for scale search")
    return search_paths


def _search_frame(
    country_path: str,
    country_mask: np.ndarray,
    centroids: list[dict],
    cos_lat: float,
    tw: int,
    th: int,
) -> _Search | None:
    """The outline and the mask in the frame the search scores in, or None when either is empty."""
    all_sub_paths = parse_svg_sub_paths(country_path)
    if not all_sub_paths:
        return None
    mask_ys, mask_xs = np.where(country_mask > 0)
    if len(mask_xs) < 10:
        return None
    cv_w = float(mask_xs.max()) - float(mask_xs.min())
    cv_h = float(mask_ys.max()) - float(mask_ys.min())

    inlier_cx, inlier_cy = _inlier_centroids(centroids)
    cx_arr = inlier_cx * cos_lat
    cy_arr = -inlier_cy
    margin = 0.05
    gx_range = cx_arr.max() - cx_arr.min()
    gy_range = cy_arr.max() - cy_arr.min()
    gx0 = cx_arr.min() - gx_range * margin
    gx1 = cx_arr.max() + gx_range * margin
    gy0 = cy_arr.min() - gy_range * margin
    gy1 = cy_arr.max() + gy_range * margin
    sx0 = cv_w / (gx1 - gx0)
    sy0 = cv_h / (gy1 - gy0)

    sub_paths = _paths_within_extent(all_sub_paths, cx_arr, cy_arr, cos_lat)
    sx_outline, sy_outline = _outline_scale(sub_paths, cos_lat, cv_w, cv_h, (sx0, sy0))
    logger.info(f"[IoU] Outline scale: sx={sx_outline:.1f} sy={sy_outline:.1f} (centroid: sx={sx0:.1f} sy={sy0:.1f})")

    # Smoothing removes coastline noise from the F2 scoring
    smooth_k = max(9, min(tw, th) // 25) | 1
    smooth_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (smooth_k, smooth_k))
    mask_smooth = cv2.morphologyEx(
        cv2.morphologyEx((country_mask * 255).astype(np.uint8), cv2.MORPH_CLOSE, smooth_kernel),
        cv2.MORPH_OPEN,
        smooth_kernel,
    )
    clip_mask = cv2.dilate(mask_smooth, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))

    return _Search(
        country_mask=country_mask,
        cos_lat=cos_lat,
        tw=tw,
        th=th,
        sub_paths=sub_paths,
        search_paths=_scale_search_paths(sub_paths),
        gadm_cx=(gx0 + gx1) / 2,
        gadm_cy=(gy0 + gy1) / 2,
        smooth_kernel=smooth_kernel,
        mask_smooth=mask_smooth,
        clip_mask=clip_mask,
        sx0=sx0,
        sy0=sy0,
        sx_outline=sx_outline,
        sy_outline=sy_outline,
    )


def _f2_at(s: _Search, sx: float, sy: float, tx: float, ty: float, k_conic: float = 0.0) -> float:
    """F2 of the outline drawn at this transform, on morphologically smoothed shapes.

    Both GADM rasterization and CV mask are smoothed (close+open) before F2 computation.
    This removes coastline detail noise that creates false overflow/uncovered areas,
    making F2 better reflect the actual shape alignment quality.
    """
    img = np.zeros((s.th, s.tw), dtype=np.uint8)
    for sp in s.search_paths:
        pts = sp.copy()
        pts[:, 0] = pts[:, 0] * s.cos_lat
        if k_conic != 0:
            scale_factor = 1.0 + k_conic * (pts[:, 1] - s.gadm_cy)
            pts[:, 0] = s.gadm_cx + (pts[:, 0] - s.gadm_cx) * scale_factor
        pts[:, 0] = pts[:, 0] * sx + tx
        pts[:, 1] = pts[:, 1] * sy + ty
        cv2.fillPoly(img, [pts.astype(np.int32)], 255)
    gadm_smooth = cv2.morphologyEx(
        cv2.morphologyEx(img, cv2.MORPH_CLOSE, s.smooth_kernel), cv2.MORPH_OPEN, s.smooth_kernel
    )
    # Clip GADM to the dilated mask region — this removes overflow from
    # detailed coastline that the CV preprocessing smoothed away.
    gadm_clipped = gadm_smooth & s.clip_mask

    inter = int(np.sum((gadm_clipped > 0) & (s.mask_smooth > 0)))
    gadm_area = int(np.sum(gadm_clipped > 0))
    mask_area = int(np.sum(s.mask_smooth > 0))
    if gadm_area == 0 or mask_area == 0:
        return 0.0
    precision = inter / gadm_area
    recall = inter / mask_area
    if precision + recall == 0:
        return 0.0
    beta2 = 4.0
    return (1 + beta2) * precision * recall / (beta2 * precision + recall)


def _rasterize_at_scale(s: _Search, sx: float, sy: float) -> tuple[np.ndarray, float, float]:
    """The outline drawn at this scale around its own corner: (image, offset_x, offset_y)."""
    all_pts = []
    for sp in s.search_paths:
        pts = sp.copy()
        pts[:, 0] = pts[:, 0] * s.cos_lat * sx
        pts[:, 1] = pts[:, 1] * sy
        all_pts.append(pts)

    all_concat = np.vstack(all_pts)
    min_x, min_y = all_concat.min(axis=0)
    max_x, max_y = all_concat.max(axis=0)

    pad = 5
    w = int(max_x - min_x) + 2 * pad
    h = int(max_y - min_y) + 2 * pad
    if w <= 0 or h <= 0 or w > s.tw * 3 or h > s.th * 3:
        return np.zeros((1, 1), dtype=np.uint8), 0, 0

    img = np.zeros((h, w), dtype=np.uint8)
    for pts in all_pts:
        shifted = pts.copy()
        shifted[:, 0] -= min_x - pad
        shifted[:, 1] -= min_y - pad
        cv2.fillPoly(img, [shifted.astype(np.int32)], 255)

    return img, min_x - pad, min_y - pad


def _scale_candidates(s: _Search) -> list[tuple[float, float]]:
    """The scales the template search tries, around both the centroid and the outline estimates."""
    s_avg = (s.sx0 + s.sy0) / 2
    s_outline_avg = (s.sx_outline + s.sy_outline) / 2

    # Uniform scales in fine steps (2%), so the optimal scale is not missed
    scale_set = set()
    for base_s in [s_avg, s_outline_avg]:
        for f in np.arange(0.80, 1.21, 0.02):
            scale_set.add(round(base_s * f, 2))
    candidates = [(sc, sc) for sc in sorted(scale_set)]

    # Asymmetric: a few key combinations from both estimates
    for base_sx, base_sy in [(s.sx0, s.sy0), (s.sx_outline, s.sy_outline)]:
        for sxf in [0.90, 1.0, 1.10]:
            for syf in [0.90, 1.0, 1.10]:
                if abs(sxf - syf) < 0.01:
                    continue
                candidates.append((base_sx * sxf, base_sy * syf))
    return candidates


def _template_search(s: _Search) -> tuple[float, Params]:
    """The best scale and translation: matchTemplate places the outline at each candidate scale."""
    candidates = _scale_candidates(s)
    logger.info(f"[IoU] Scale candidates: {len(candidates)} combinations")
    target = s.country_mask.astype(np.float32)

    best_val = 0.0
    best_params: Params = (s.sx0, s.sy0, 0.0, 0.0)
    for sx_try, sy_try in candidates:
        template, off_x, off_y = _rasterize_at_scale(s, sx_try, sy_try)
        if template.shape[0] <= 1 or template.shape[1] <= 1:
            continue
        # A template larger than the target cannot slide over it
        if template.shape[1] > s.tw or template.shape[0] > s.th:
            continue

        result = cv2.matchTemplate(target, template.astype(np.float32), cv2.TM_CCORR_NORMED)
        _, _, _, max_loc = cv2.minMaxLoc(result)
        # The template's pixel is gadm * sx - off, placed at max_loc in the
        # target, so gadm * sx + tx = gadm * sx - off + max_loc.
        tx = -off_x + max_loc[0]
        ty = -off_y + max_loc[1]

        score = _f2_at(s, sx_try, sy_try, tx, ty)
        if score > best_val:
            best_val = score
            best_params = (sx_try, sy_try, tx, ty)
    return best_val, best_params


def _refine_around(
    s: _Search,
    best_val: float,
    params: Params,
    scale_steps: Iterable[float],
    offsets: range,
) -> tuple[float, Params]:
    """The best of the scale steps around params, each with the translations around it.

    A scale step keeps the extent's centre where it was, and the offsets nudge the
    translation from there.
    """
    best_params = params
    bsx, bsy, btx, bty = params
    for sd in scale_steps:
        sx_try = bsx * (1 + sd)
        sy_try = bsy * (1 + sd)
        tx_adj = btx + (s.gadm_cx * bsx - s.gadm_cx * sx_try)
        ty_adj = bty + (s.gadm_cy * bsy - s.gadm_cy * sy_try)
        for dx in offsets:
            for dy in offsets:
                score = _f2_at(s, sx_try, sy_try, tx_adj + dx, ty_adj + dy)
                if score > best_val:
                    best_val = score
                    best_params = (sx_try, sy_try, tx_adj + dx, ty_adj + dy)
    return best_val, best_params


def _keep_paths_on_the_mask(s: _Search, params: Params) -> bool:
    """Narrow the scored paths to those the fit lays over the mask; True when any was dropped.

    This removes islands/features not in the CV silhouette, improving precision.
    """
    fsx, fsy, ftx, fty = params
    on_mask = []
    for sp in s.search_paths:
        pts = sp.copy()
        pts[:, 0] *= s.cos_lat
        pts[:, 0] = pts[:, 0] * fsx + ftx
        pts[:, 1] = pts[:, 1] * fsy + fty
        sp_img = np.zeros((s.th, s.tw), dtype=np.uint8)
        cv2.fillPoly(sp_img, [pts.astype(np.int32)], 255)
        sp_area = int(np.sum(sp_img > 0))
        sp_inter = int(np.sum((sp_img > 0) & (s.country_mask > 0)))
        if sp_area > 0 and sp_inter / sp_area > 0.3:
            on_mask.append(sp)
    removed = len(s.search_paths) - len(on_mask)
    if len(on_mask) < 3 or removed == 0:
        return False
    logger.info(
        f"[IoU] Post-affine filter: {len(on_mask)}/{len(s.search_paths)} sub-paths overlap mask (removed {removed} islands)"
    )
    s.search_paths = on_mask
    return True


def _affine_fit(s: _Search) -> tuple[float, Params]:
    """The affine fit: template matching, then translation and scale refinements."""
    started = time.perf_counter()
    best_val, params = _template_search(s)
    logger.info(f"[IoU] Scale search done in {time.perf_counter() - started:.2f}s (F2={best_val:.3f})")

    started = time.perf_counter()
    # Translation alone, then ±10% of scale in 1% steps
    best_val, params = _refine_around(s, best_val, params, [0.0], range(-4, 5))
    best_val, params = _refine_around(s, best_val, params, np.arange(-0.10, 0.101, 0.01), range(-4, 5, 2))
    logger.info(f"[IoU] Scale/translation refine done in {time.perf_counter() - started:.2f}s (F2={best_val:.3f})")
    # Ultra-fine around the winner
    best_val, params = _refine_around(s, best_val, params, np.arange(-0.005, 0.0051, 0.002), range(-1, 2))

    if _keep_paths_on_the_mask(s, params):
        best_val = _f2_at(s, *params)
    return best_val, params


def _conic_search(s: _Search, best_val: float, params: Params) -> tuple[float, float, Params]:
    """The conic term that best raises F2: (k, F2, params), with k = 0 when none does.

    Conic projections make the top narrower than the bottom:
    sx_effective(y) = sx * (1 + c * (y - mid_y)), positive c wider at bottom.
    A hierarchical coarse→fine search sweeps the whole (c, dx, dy) volume
    coarsely (~120 cells), then refines tightly around the winner (~125 cells).
    """
    fsx, fsy, ftx, fty = params
    best_k = 0.0
    best_conic_f2 = best_val
    best_params = params
    best_grid: tuple[float, int, int] = (0.0, 0, 0)
    for c_try in np.arange(-0.06, 0.061, 0.01):
        if abs(c_try) < 1e-6:
            continue
        for dx in range(-20, 21, 10):
            for dy in range(-15, 16, 10):
                f2_val = _f2_at(s, fsx, fsy, ftx + dx, fty + dy, k_conic=c_try)
                if f2_val > best_conic_f2:
                    best_conic_f2 = f2_val
                    best_k = c_try
                    best_grid = (c_try, dx, dy)
                    best_params = (fsx, fsy, ftx + dx, fty + dy)

    if best_k != 0.0:
        c_center, dx_center, dy_center = best_grid
        for c_try in np.arange(c_center - 0.009, c_center + 0.0091, 0.003):
            for dx in range(dx_center - 9, dx_center + 10, 3):
                for dy in range(dy_center - 9, dy_center + 10, 3):
                    f2_val = _f2_at(s, fsx, fsy, ftx + dx, fty + dy, k_conic=c_try)
                    if f2_val > best_conic_f2:
                        best_conic_f2 = f2_val
                        best_k = c_try
                        best_params = (fsx, fsy, ftx + dx, fty + dy)
    return best_k, best_conic_f2, best_params


def _f2_with_matrix(s: _Search, m: np.ndarray) -> float:
    """F2 of every sub-path in the extent drawn through the 2×3 affine m, unsmoothed."""
    img = np.zeros((s.th, s.tw), dtype=np.uint8)
    for sp in s.sub_paths:
        pts = sp.copy()
        pts[:, 0] *= s.cos_lat
        ones = np.ones((len(pts), 1))
        hom = np.hstack([pts, ones])
        projected = (m @ hom.T).T
        cv2.fillPoly(img, [projected.astype(np.int32)], 255)
    inter = int(np.sum((img > 0) & (s.country_mask > 0)))
    ga = int(np.sum(img > 0))
    ma = int(np.sum(s.country_mask > 0))
    if ga == 0 or ma == 0:
        return 0.0
    p, r = inter / ga, inter / ma
    return 5 * p * r / max(4 * p + r, 1e-10)


def _shear_search(s: _Search, best_val: float, params: Params) -> tuple[np.ndarray, float]:
    """The affine matrix with the shear that raises F2 by more than half a percent, or none.

    A shear tilts the vertical axis, which approximates a conic projection's
    narrowing toward one edge.
    """
    fsx, fsy, ftx, fty = params
    started = time.perf_counter()
    best_shear_f2 = best_val
    best_shear = (0.0, 0.0)
    for shear_x in np.arange(-0.15, 0.16, 0.03):
        for shear_y in np.arange(-0.10, 0.11, 0.05):
            if shear_x == 0 and shear_y == 0:
                continue
            m = np.array(
                [
                    [fsx, shear_x * fsx, ftx],
                    [shear_y * fsy, fsy, fty],
                ],
                dtype=np.float64,
            )
            f2 = _f2_with_matrix(s, m)
            if f2 > best_shear_f2:
                best_shear_f2 = f2
                best_shear = (shear_x, shear_y)
    logger.info(f"[IoU] Shear search done in {time.perf_counter() - started:.2f}s")

    if best_shear_f2 <= best_val * 1.005:
        return _affine_matrix(fsx, fsy, ftx, fty), best_val
    shx, shy = best_shear
    logger.info(f"[IoU] Shear improved: shear_x={shx:.3f} shear_y={shy:.3f} F2={best_val:.3f} → {best_shear_f2:.3f}")
    matrix = np.array(
        [
            [fsx, shx * fsx, ftx],
            [shy * fsy, fsy, fty],
        ],
        dtype=np.float64,
    )
    return matrix, best_shear_f2


def _draw_fitted_outline(s: _Search, k_conic: float, params: Params) -> np.ndarray:
    """The scored paths drawn at the fitted transform, conic term included."""
    fsx, fsy, ftx, fty = params
    gadm_img = np.zeros((s.th, s.tw), dtype=np.uint8)
    for sp in s.search_paths:
        pts = sp.copy()
        pts[:, 0] *= s.cos_lat
        if k_conic != 0:
            sf_persp = 1.0 + k_conic * (pts[:, 1] - s.gadm_cy)
            pts[:, 0] = s.gadm_cx + (pts[:, 0] - s.gadm_cx) * sf_persp
        pts[:, 0] = pts[:, 0] * fsx + ftx
        pts[:, 1] = pts[:, 1] * fsy + fty
        cv2.fillPoly(gadm_img, [pts.astype(np.int32)], 255)
    return gadm_img


def _perspective_hint(s: _Search, gadm_img: np.ndarray) -> tuple[float, float]:
    """The perspective terms a projective fit between the super-blurred outline and mask suggests."""
    blur_k = max(41, min(s.tw, s.th) // 8) | 1
    gadm_blob = cv2.GaussianBlur(gadm_img, (blur_k, blur_k), 0)
    country_mask = s.country_mask
    mask_u8 = (country_mask * 255).astype(np.uint8) if country_mask.max() <= 1 else country_mask
    mask_blob = cv2.GaussianBlur(mask_u8, (blur_k, blur_k), 0)
    _, gadm_thresh = cv2.threshold(gadm_blob, 40, 255, cv2.THRESH_BINARY)
    _, mask_thresh = cv2.threshold(mask_blob, 40, 255, cv2.THRESH_BINARY)

    gc_p, _ = cv2.findContours(gadm_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    mc_p, _ = cv2.findContours(mask_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not gc_p or not mc_p:
        return 0.0, 0.0
    g_cnt = max(gc_p, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)
    m_cnt = max(mc_p, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)
    if len(g_cnt) > 60:
        g_cnt = g_cnt[np.linspace(0, len(g_cnt) - 1, 60, dtype=int)]
    if len(m_cnt) > 60:
        m_cnt = m_cnt[np.linspace(0, len(m_cnt) - 1, 60, dtype=int)]
    if len(g_cnt) < 6 or len(m_cnt) < 6:
        return 0.0, 0.0
    _, idxs_p = KDTree(m_cnt).query(g_cnt)
    from skimage.transform import estimate_transform

    tform = estimate_transform("projective", m_cnt[idxs_p].astype(np.float32), g_cnt.astype(np.float32))
    px_hint = float(np.clip(tform.params[2, 0], -0.002, 0.002))
    py_hint = float(np.clip(tform.params[2, 1], -0.002, 0.002))
    logger.info(f"[IoU] Blur perspective hint: px={px_hint:.6f} py={py_hint:.6f}")
    return px_hint, py_hint


def _perspective_warp(cx: float, cy: float, px: float, py: float) -> np.ndarray:
    """The homography that tilts by (px, py) around (cx, cy)."""
    to_centre = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1]], dtype=np.float64)
    tilt = np.array([[1, 0, 0], [0, 1, 0], [px, py, 1]], dtype=np.float64)
    back = np.array([[1, 0, cx], [0, 1, cy], [0, 0, 1]], dtype=np.float64)
    return back @ tilt @ to_centre


def _perspective_grid(
    f2_of: Callable[[float, float], float], best_val: float, hint: tuple[float, float]
) -> tuple[float, float, float]:
    """The perspective terms that best raise F2: (px, py, F2), (0, 0) when none does.

    A hierarchical coarse→fine search around both the blur hint and zero: the
    coarse pass catches the basin (7×7 grid × 4 centres), the fine pass refines
    (11×11 cells around the coarse winner). Each cell is a warpPerspective.
    """
    search_range = 0.0015
    coarse_step = 0.0005
    fine_step = 0.0001
    fine_range = 0.0005

    best_px, best_py = 0.0, 0.0
    best_persp_f2 = best_val
    px_hint, py_hint = hint
    for px_center in [0.0, px_hint]:
        for py_center in [0.0, py_hint]:
            for px in np.arange(px_center - search_range, px_center + search_range + coarse_step / 2, coarse_step):
                for py in np.arange(py_center - search_range, py_center + search_range + coarse_step / 2, coarse_step):
                    if px == 0 and py == 0:
                        continue
                    f2_val = f2_of(px, py)
                    if f2_val > best_persp_f2:
                        best_persp_f2 = f2_val
                        best_px, best_py = px, py

    if best_px != 0 or best_py != 0:
        for px in np.arange(best_px - fine_range, best_px + fine_range + fine_step / 2, fine_step):
            for py in np.arange(best_py - fine_range, best_py + fine_range + fine_step / 2, fine_step):
                f2_val = f2_of(px, py)
                if f2_val > best_persp_f2:
                    best_persp_f2 = f2_val
                    best_px, best_py = px, py
    return best_px, best_py, best_persp_f2


class _PerspectiveScore:
    """F2 of the fitted outline against the mask warped by a tilt around the mask's centre of mass."""

    def __init__(self, s: _Search, gadm_img: np.ndarray) -> None:
        self.s = s
        self.gadm_img = gadm_img
        mask_ys, mask_xs = np.where(s.country_mask > 0)
        self.cx = float(mask_xs.mean()) if len(mask_xs) > 0 else s.tw / 2
        self.cy = float(mask_ys.mean()) if len(mask_ys) > 0 else s.th / 2

    def __call__(self, px: float, py: float) -> float:
        warped = cv2.warpPerspective(
            self.s.country_mask, _perspective_warp(self.cx, self.cy, px, py), (self.s.tw, self.s.th)
        )
        inter = int(np.sum((self.gadm_img > 0) & (warped > 0)))
        ga2 = int(np.sum(self.gadm_img > 0))
        ma2 = int(np.sum(warped > 0))
        if ga2 == 0 or ma2 == 0:
            return 0.0
        p, r = inter / ga2, inter / ma2
        return 5 * p * r / max(4 * p + r, 1e-10)


def _perspective_search(s: _Search, best_val: float, k_conic: float, params: Params) -> tuple[np.ndarray | None, float]:
    """The inverse homography that best raises F2 and its F2, or (None, best_val) when none does.

    Super-blurring both shapes gives a projective hint; a grid search around it
    and around zero scores each tilt by F2 on the scored paths alone, which
    carry less overflow noise.
    """
    started = time.perf_counter()
    gadm_img = _draw_fitted_outline(s, k_conic, params)
    hint = _perspective_hint(s, gadm_img)
    score = _PerspectiveScore(s, gadm_img)
    best_px, best_py, best_persp_f2 = _perspective_grid(score, best_val, hint)
    logger.info(f"[IoU] Perspective grid (hierarchical) done in {time.perf_counter() - started:.2f}s")

    if best_px == 0 and best_py == 0:
        logger.info("[IoU] No perspective improvement found")
        return None, best_val
    logger.info(f"[IoU] Perspective grid: px={best_px:.6f} py={best_py:.6f} F2={best_val:.3f}→{best_persp_f2:.3f}")
    return _perspective_warp(score.cx, score.cy, best_px, best_py), best_persp_f2


def iou_alignment(
    country_path: str,
    country_mask: np.ndarray,
    centroids: list[dict],
    cos_lat: float,
    tw: int,
    th: int,
) -> AlignmentResult:
    """Find the affine transform that maximizes IoU between GADM outline and CV mask.

    Uses cv2.matchTemplate for fast translation search at each candidate scale,
    then refines with IoU scoring. Much faster than brute-force grid search.

    Returns (matrix, f2, method, inverse_H, k_conic, gadm_cx_corr). The trailing
    gadm_cx_corr is the global X pivot used when learning k_conic; callers that
    re-apply the conic warp downstream (e.g. _rasterize_division) MUST reuse
    this value, otherwise the warp is applied around a different center and
    the rendered masks no longer match the transform that was scored.
    """
    s = _search_frame(country_path, country_mask, centroids, cos_lat, tw, th)
    if s is None:
        return _identity()

    best_val, params = _affine_fit(s)
    fsx, fsy, ftx, fty = params
    logger.info(f"[IoU] Affine: sx={fsx:.1f} sy={fsy:.1f} tx={ftx:.1f} ty={fty:.1f} F2={best_val:.3f}")
    logger.info(f"[IoU] Init: sx={s.sx0:.1f} sy={s.sy0:.1f} s_avg={(s.sx0 + s.sy0) / 2:.1f}")

    # At F2 < MIN_F2_FOR_REFINE the basic shape doesn't fit and refinements
    # cannot recover it — better to return the bad result fast (~5s matching)
    # than to burn ~7 minutes on polishing searches that only nudge F2 by
    # ~0.05 at best. k_conic is 0 here, so gadm_cx_corr is returned for the
    # tuple's shape alone.
    if best_val < MIN_F2_FOR_REFINE:
        logger.info(
            f"[IoU] Skipping conic/shear/perspective: affine F2={best_val:.3f} < {MIN_F2_FOR_REFINE} — basic fit is wrong, refinements cannot recover it"
        )
        return _affine_matrix(*params), best_val, "iou_align", None, 0.0, s.gadm_cx

    best_k = 0.0
    if best_val >= SKIP_CONIC_F2:
        logger.info(f"[IoU] Skipping conic search: affine F2={best_val:.3f} >= {SKIP_CONIC_F2}")
    else:
        started = time.perf_counter()
        best_k, conic_f2, conic_params = _conic_search(s, best_val, params)
        logger.info(f"[IoU] Conic grid search (hierarchical) done in {time.perf_counter() - started:.2f}s")
        if best_k != 0:
            params, best_val = conic_params, conic_f2
    if best_k != 0:
        logger.info(f"[IoU] Conic correction: c={best_k:.4f} F2→{best_val:.3f}")
    else:
        logger.info("[IoU] No conic improvement found")

    affine_matrix, best_val = _shear_search(s, best_val, params)

    # Perspective refinement won't meaningfully improve an already-excellent fit
    if best_val >= SKIP_PERSPECTIVE_F2:
        logger.info(f"[IoU] Skipping perspective search: F2={best_val:.3f} >= {SKIP_PERSPECTIVE_F2}")
        return affine_matrix, best_val, "iou_align", None, best_k, s.gadm_cx

    inverse_h, persp_f2 = _perspective_search(s, best_val, best_k, params)
    if inverse_h is None:
        return affine_matrix, best_val, "iou_align", None, best_k, s.gadm_cx
    return affine_matrix, persp_f2, "iou_perspective", inverse_h, best_k, s.gadm_cx
