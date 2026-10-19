"""Projection detection: which projection a map's country mask was drawn in.

Each candidate projection draws the GADM outline; the one whose convex hull best
matches the mask's convex hull wins, provided it beats the equirectangular
baseline by 5%. The candidates are named EPSG projections whose coverage the
region overlaps, conic and Albers projections on standard and region-derived
parallels, a few single-parameter projections, and a sweep of one-parallel
Lambert conics.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .svg_parse import parse_svg_sub_paths

logger = logging.getLogger(__name__)

ProjectFn = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]

# The detection draws at most this many sub-paths, the largest, for speed.
TEST_PATHS = 200
# The projected outline is drawn on a square canvas this large, inside this pad.
CANVAS_SIZE = 400
CANVAS_PAD = 20
# Both convex hulls are fitted, aspect ratio kept, into a canonical box this large.
CANON = 200
# A candidate replaces equirectangular only when it scores this much better.
MIN_GAIN = 1.05

# Standard parallels commonly used — Alaska: 55, 65 | CONUS: 33, 45 | Canada: 49, 77
STD_PARALLELS = [(55, 65), (33, 45), (49, 77), (20, 60), (29.5, 45.5)]
# Region-derived parallels, named by inset fraction from the latitude extent's
# edges: 0.17 = tight (≈ 1/6, cylindrical-like), 0.33 = balanced, 0.5 = full cone.
PARALLEL_FRACTIONS = [0.08, 0.17, 0.25, 0.33, 0.42]
# Named EPSG projections, tried when the region's latitudes overlap theirs.
EPSG_CANDIDATES = [
    (3338, "epsg3338_alaska_albers", 51, 72, -180, -130),  # NAD83 / Alaska Albers
    (5070, "epsg5070_conus_albers", 24, 49, -125, -66),  # NAD83 / Conus Albers
    (3310, "epsg3310_ca_albers", 32, 42, -125, -114),  # NAD83 / California Albers
    (3413, "epsg3413_polar_stere", 60, 90, -180, 180),  # Arctic Polar Stereographic
]


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


def project_svg_path(svg_path: str, proj_fn: Callable, max_seg_len: float = 0.2) -> str:
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


def _canonical_hull(hull: np.ndarray) -> np.ndarray | None:
    """The hull filled into the canonical box, aspect ratio kept; None when it is under 5 px."""
    x, y, w, h = cv2.boundingRect(hull)
    if w < 5 or h < 5:
        return None
    canon = np.zeros((CANON, CANON), dtype=np.uint8)
    shifted = hull.copy().astype(np.float64)
    scale = (CANON - 10) / max(w, h)
    shifted[:, 0, 0] = (shifted[:, 0, 0] - x) * scale + (CANON - w * scale) / 2
    shifted[:, 0, 1] = (shifted[:, 0, 1] - y) * scale + (CANON - h * scale) / 2
    cv2.fillPoly(canon, [shifted.astype(np.int32)], 255)
    return canon


@dataclass
class _ShapeScorer:
    """Convex hull IoU of the outline drawn through a projection against the mask's hull.

    The convex hull removes coastline noise and reveals the underlying projection
    shape: different projections of the same region have measurably different
    convex hulls.
    """

    test_paths: list[np.ndarray]
    max_seg_len: float
    cos_lat: float
    # The mask's hull in the canonical box, None when it is too small to compare
    cv_canon: np.ndarray | None

    def _projected(self, proj_fn: ProjectFn | None) -> list[np.ndarray]:
        pts_list = []
        for sp in self.test_paths:
            pts = _densify_polygon(sp, self.max_seg_len).copy()
            if proj_fn:
                pts[:, 0], pts[:, 1] = proj_fn(pts[:, 0], pts[:, 1])
            else:
                pts[:, 0] *= self.cos_lat
            pts_list.append(pts)
        return pts_list

    def _hull(self, pts_list: list[np.ndarray]) -> np.ndarray | None:
        """The convex hull of the projected outline drawn on the canvas, None when nothing draws."""
        all_pts = np.vstack(pts_list)
        g_x0, g_y0 = all_pts.min(axis=0)
        g_x1, g_y1 = all_pts.max(axis=0)
        gw = g_x1 - g_x0
        gh = g_y1 - g_y0
        if gw < 1e-6 or gh < 1e-6:
            return None

        s_canvas = min((CANVAS_SIZE - 2 * CANVAS_PAD) / gw, (CANVAS_SIZE - 2 * CANVAS_PAD) / gh)
        gadm_img = np.zeros((CANVAS_SIZE, CANVAS_SIZE), dtype=np.uint8)
        for pts in pts_list:
            shifted = pts.copy()
            shifted[:, 0] = (shifted[:, 0] - g_x0) * s_canvas + CANVAS_PAD
            shifted[:, 1] = (shifted[:, 1] - g_y0) * s_canvas + CANVAS_PAD
            cv2.fillPoly(gadm_img, [shifted.astype(np.int32)], 255)
        if gadm_img.sum() == 0:
            return None

        gadm_contours, _ = cv2.findContours(gadm_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not gadm_contours:
            return None
        return cv2.convexHull(max(gadm_contours, key=cv2.contourArea))

    def __call__(self, proj_fn: ProjectFn | None) -> float:
        hull = self._hull(self._projected(proj_fn))
        if hull is None:
            return 0.0
        gadm_canon = _canonical_hull(hull)
        if gadm_canon is None or self.cv_canon is None:
            return 0.0
        intersection = int(np.sum((gadm_canon > 0) & (self.cv_canon > 0)))
        union = int(np.sum((gadm_canon > 0) | (self.cv_canon > 0)))
        if union == 0:
            return 0.0
        return intersection / union


def _shape_scorer(
    all_sub_paths: list[np.ndarray],
    country_mask: np.ndarray,
    centroids: list[dict],
    cos_lat: float,
) -> _ShapeScorer | None:
    """The scorer against the mask's convex hull, or None when the mask has no hull."""
    if len(all_sub_paths) > TEST_PATHS:
        test_paths = sorted(all_sub_paths, key=len, reverse=True)[:TEST_PATHS]
    else:
        test_paths = all_sub_paths

    # Densification: without this, straight GADM edges don't become visible
    # curves after projection. Max segment length scales with region extent.
    lon_span = float(max([c["cx"] for c in centroids]) - min([c["cx"] for c in centroids]))
    max_seg_len = max(0.3, lon_span / 80)

    cv_mask_u8 = (country_mask * 255).astype(np.uint8) if country_mask.max() <= 1 else country_mask
    cv_contours, _ = cv2.findContours(cv_mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cv_contours:
        logger.info("[Proj] No CV mask contours — skipping projection detection")
        return None
    cv_hull = cv2.convexHull(max(cv_contours, key=cv2.contourArea))
    cv_hull_mask = np.zeros_like(cv_mask_u8)
    cv2.fillPoly(cv_hull_mask, [cv_hull], 255)
    if not np.any(cv_hull_mask > 0):
        return None
    return _ShapeScorer(test_paths, max_seg_len, cos_lat, _canonical_hull(cv_hull))


@dataclass
class _Region:
    """The region's centre and latitude extent, from its centroids without antimeridian outliers."""

    lat_0: float
    lon_0: float
    lat_min: float
    lat_max: float

    @classmethod
    def of(cls, centroids: list[dict]) -> "_Region":
        raw_cx = np.array([c["cx"] for c in centroids])
        raw_cy = np.array([c["cy"] for c in centroids])
        med_cx = float(np.median(raw_cx))
        inlier = np.abs(raw_cx - med_cx) < 30
        if inlier.sum() < 3:
            inlier = np.ones(len(raw_cx), dtype=bool)
        return cls(
            lat_0=float(np.median(raw_cy[inlier])),
            lon_0=float(np.median(raw_cx[inlier])),
            lat_min=float(raw_cy[inlier].min()),
            lat_max=float(raw_cy[inlier].max()),
        )

    def proj4(self, proj: str, params: str) -> str:
        return f"+proj={proj} {params}+lat_0={self.lat_0} +lon_0={self.lon_0} +x_0=0 +y_0=0 +datum=WGS84 +no_defs"

    def one_parallel_lcc(self, lat_1: Any) -> str:
        return self.proj4("lcc", f"+lat_1={lat_1} ")

    def candidates(self) -> list[tuple[str, str]]:
        """The proj4 candidates: two-parallel conics and Albers, then single-parameter projections."""
        found = []
        for sp1, sp2 in STD_PARALLELS:
            # Only use if parallels are within reason of the region
            if sp1 > self.lat_max + 10 or sp2 < self.lat_min - 10:
                continue
            found.append((f"lcc_std_{sp1:.0f}_{sp2:.0f}", self.proj4("lcc", f"+lat_1={sp1} +lat_2={sp2} ")))
            found.append((f"aea_std_{sp1:.0f}_{sp2:.0f}", self.proj4("aea", f"+lat_1={sp1} +lat_2={sp2} ")))
        lat_span = self.lat_max - self.lat_min
        for pf in PARALLEL_FRACTIONS:
            sp1 = self.lat_min + lat_span * pf
            sp2 = self.lat_max - lat_span * pf
            found.append((f"lcc_p{pf:.2f}", self.proj4("lcc", f"+lat_1={sp1} +lat_2={sp2} ")))
            found.append((f"aea_p{pf:.2f}", self.proj4("aea", f"+lat_1={sp1} +lat_2={sp2} ")))
        lat_0, lon_0 = self.lat_0, self.lon_0
        found.extend(
            [
                ("stere", f"+proj=stere +lat_0={lat_0} +lon_0={lon_0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +no_defs"),
                ("merc", f"+proj=merc +lon_0={lon_0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +no_defs"),
                ("tmerc", f"+proj=tmerc +lat_0={lat_0} +lon_0={lon_0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +no_defs"),
            ]
        )
        return found


@dataclass
class _Best:
    score: float
    name: str | None = None
    fn: ProjectFn | None = None

    def offer(self, name: str, fn: ProjectFn, score: float) -> None:
        if score > self.score:
            self.score = score
            self.name = name
            self.fn = fn


def _projection_fn(crs: Any) -> ProjectFn:
    """The projection from GADM SVG coordinates (x = lon, y = −lat) to the crs, Y flipped back."""
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)

    def fn(svg_x: np.ndarray, svg_y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        e, n = transformer.transform(svg_x, -svg_y)
        return e, -n

    return fn


def _try_logged(best: _Best, score_of: _ShapeScorer, name: str, make_crs: Callable[[], Any]) -> None:
    try:
        fn = _projection_fn(make_crs())
        score = score_of(fn)
        logger.info(f"[Proj] {name} score={score:.4f}")
        best.offer(name, fn, score)
    except Exception as e:
        logger.warning(f"[Proj] {name} failed: {e}")


def _try_quietly(best: _Best, score_of: _ShapeScorer, name: str, proj4: str) -> None:
    from pyproj import CRS

    try:
        fn = _projection_fn(CRS.from_proj4(proj4))
        best.offer(name, fn, score_of(fn))
    except Exception:  # noqa: S110  # nosec B110 -- projection search: skip invalid pyproj parameter combos and continue scanning candidates
        pass


def _search_projections(best: _Best, score_of: _ShapeScorer, region: _Region) -> None:
    """Offer every candidate projection to best."""
    try:
        from pyproj import CRS
    except ImportError:
        logger.warning("[Proj] pyproj not available — skipping projection detection")
        return

    for epsg, name, lat_lo, lat_hi, _lon_lo, _lon_hi in EPSG_CANDIDATES:
        if region.lat_max < lat_lo or region.lat_min > lat_hi:
            continue  # latitude range doesn't overlap
        _try_logged(best, score_of, name, lambda epsg=epsg: CRS.from_epsg(epsg))
    for proj_name, proj4 in region.candidates():
        _try_logged(best, score_of, proj_name, lambda proj4=proj4: CRS.from_proj4(proj4))

    # Single-parallel LCC covers any cone constant via n=sin(lat_1), so a sweep
    # of lat_1 can model any cone, which the two-parallel ones above cannot.
    for lat_1_deg in np.arange(10, 86, 5):
        _try_quietly(best, score_of, f"lcc_lat1_{lat_1_deg:.0f}", region.one_parallel_lcc(lat_1_deg))
    # Fine search around the best single-parallel lat_1
    if best.name and best.name.startswith("lcc_lat1_"):
        best_lat_1 = float(best.name.split("_")[-1])
        for lat_1_deg in np.arange(best_lat_1 - 4, best_lat_1 + 5, 1):
            _try_quietly(best, score_of, f"lcc_lat1_{lat_1_deg:.0f}", region.one_parallel_lcc(lat_1_deg))
    if best.name and best.name.startswith("lcc_lat1_"):
        logger.info(f"[Proj] Best single-parallel LCC: {best.name} score={best.score:.4f}")


def detect_projection(
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
    region = _Region.of(centroids)
    if np.count_nonzero(country_mask > 0) < 100:
        return None
    score_of = _shape_scorer(all_sub_paths, country_mask, centroids, cos_lat)
    if score_of is None:
        return None

    baseline = score_of(None)
    logger.info(f"[Proj] Equirectangular baseline: score={baseline:.4f}")
    best = _Best(baseline)
    _search_projections(best, score_of, region)

    if best.fn and best.name and best.score > baseline * MIN_GAIN:
        logger.info(f"[Proj] Best: {best.name} score={best.score:.4f} (vs baseline {baseline:.4f})")
        return best.name, best.fn

    logger.info("[Proj] Equirectangular is optimal — no projection change")
    return None
