"""Decoration CC exclusion: the map furniture dropped from a country mask.

A Wikivoyage map's country mask carries, beside the land, the furniture drawn
over it: title boxes, compass roses, scale bars, labels. Each connected component
is judged by where it sits, its size, how much of its bounding box it fills and
how uniform its colour is, and a component the judgement calls furniture is
dropped whole. The largest components, which make up the land, are protected
unless they look artificial themselves.
"""

import logging
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class _Components:
    """The country mask's connected components and what every judgement reads."""

    filtered: np.ndarray
    labels: np.ndarray
    stats: np.ndarray
    centroids: np.ndarray
    country_size: int
    w: int
    h: int
    # The edge zone: a component whose centroid is this close to an edge is near it
    bx: int
    by: int
    # The filtered image's edges, for the internal edge density of a label
    edge_map: np.ndarray

    def area(self, i: int) -> int:
        return int(self.stats[i, cv2.CC_STAT_AREA])

    def pct(self, i: int) -> float:
        return self.area(i) / self.country_size * 100

    def near_edge(self, i: int) -> bool:
        cx, cy = self.centroids[i]
        return bool(cx < self.bx or cx > self.w - self.bx or cy < self.by or cy > self.h - self.by)

    def box(self, i: int) -> tuple[int, int]:
        return int(self.stats[i, cv2.CC_STAT_WIDTH]), int(self.stats[i, cv2.CC_STAT_HEIGHT])

    def fill(self, i: int) -> float:
        """How much of its bounding box the component fills."""
        bw, bh = self.box(i)
        bbox_area = bw * bh
        return self.area(i) / bbox_area if bbox_area > 0 else 0

    def aspect(self, i: int) -> float:
        bw, bh = self.box(i)
        return max(bw, bh) / max(min(bw, bh), 1)

    def color_std(self, i: int) -> float:
        pixels = self.filtered[self.labels == i]
        return float(np.std(pixels.astype(np.float32), axis=0).mean())

    def touches(self, i: int, protected: set[int]) -> bool:
        """Whether the component lies across a gap of one pixel from a protected one."""
        dilated = cv2.dilate((self.labels == i).astype(np.uint8), np.ones((5, 5), np.uint8))
        return any(np.any(dilated & (self.labels == p_id).astype(np.uint8)) for p_id in protected)

    def describe(self, i: int) -> str:
        cx, cy = self.centroids[i]
        return f"{self.area(i)}px ({self.pct(i):.1f}%), pos=({cx:.0f},{cy:.0f})"


def _components(country_mask: np.ndarray, filtered: np.ndarray, edge_pct: float) -> _Components:
    h, w = country_mask.shape
    cm_binary = (country_mask > 0).astype(np.uint8) * 255
    _, labels, stats, centroids = cv2.connectedComponentsWithStats(cm_binary)
    return _Components(
        filtered=filtered,
        labels=labels,
        stats=stats,
        centroids=centroids,
        country_size=int(np.sum(country_mask > 0)),
        w=w,
        h=h,
        bx=int(w * edge_pct),
        by=int(h * edge_pct),
        edge_map=cv2.Canny(cv2.cvtColor(filtered, cv2.COLOR_BGR2GRAY), 30, 80),
    )


def _looks_artificial(cc: _Components, i: int) -> bool:
    """Whether a large component near an edge is a solid shape no coast draws: never protected."""
    pct = cc.pct(i)
    if not (cc.near_edge(i) and pct < 20):
        return False
    fill = cc.fill(i)
    if fill <= 0.70:
        return False
    # Perfect rectangles (fill > 0.90) are ALWAYS artificial
    # (title boxes, scale bars) — no natural feature is a perfect rectangle
    if fill > 0.90:
        return True
    # Relaxed std based on size and shape:
    # Small compact CCs (< 3%): std < 40 (compass elements)
    # Elongated compact CCs (aspect > 2.5): std < 55 (scale/title bars)
    # Large compact CCs (>= 3%): std < 12 (strict for real features)
    if pct < 3:
        std_limit = 40
    elif cc.aspect(i) > 2.5:
        std_limit = 55
    else:
        std_limit = 12
    return cc.color_std(i) < std_limit


def _protected(cc: _Components, num_cc: int) -> set[int]:
    """The largest components, until they make up 90% of the country, unless they look artificial."""
    cc_list = [(i, cc.area(i)) for i in range(1, num_cc)]
    cc_list.sort(key=lambda x: -x[1])

    protected = set()
    cumulative = 0
    for cc_id, area in cc_list:
        if _looks_artificial(cc, cc_id):
            continue
        protected.add(cc_id)
        cumulative += area
        if cumulative / cc.country_size >= 0.90 and area / cc.country_size < 0.05:
            break
    return protected


def _interior_decoration(cc: _Components, i: int, protected: set[int]) -> bool:
    """An inland compass rose, dot or emblem: isolated, very compact, very uniform, small.

    The thresholds are strict to keep real islands, which can be compact at low
    resolution. Circles have fill ~0.78, rectangles ~0.80+; real islands rarely
    exceed 0.73.
    """
    pct, fill = cc.pct(i), cc.fill(i)
    if not (0.2 <= pct <= 3.0 and fill >= 0.73) or cc.touches(i, protected):
        return False
    color_std = cc.color_std(i)
    if color_std > 8:
        return False
    logger.info(f"[DecoCC] Excluded INTERIOR CC: {cc.describe(i)}, fill={fill:.2f}, std={color_std:.1f}")
    return True


def _title_box(cc: _Components, i: int) -> bool:
    """A large component (8-20%) near an edge that is a solid-colour rectangle."""
    fill = cc.fill(i)
    # Perfect rectangles bypass the colour check entirely
    color_std = 0.0 if fill > 0.90 else cc.color_std(i)
    if not (color_std < 12 or fill > 0.90):
        return False
    logger.info(f"[DecoCC] Excluded LARGE CC: {cc.describe(i)}, fill={fill:.2f}, std={color_std:.1f}")
    return True


def _marked_small_decoration(cc: _Components, i: int, color_std: float) -> bool:
    """A small component (< 2%) with a decoration's evidence: a solid colour, or text inside.

    Real islands are smooth after mean-shift; dots, compass circles and scale bars
    are one colour, and text and compass symbols with arrows or letters have
    internal high-contrast structure.
    """
    area, fill = cc.area(i), cc.fill(i)
    if color_std < 5:
        logger.info(f"[DecoCC] Excluded SMALL UNIFORM CC: {cc.describe(i)}, fill={fill:.2f}, std={color_std:.1f}")
        return True
    cc_edge_pixels = int(np.sum((cc.edge_map > 0) & (cc.labels == i)))
    internal_edge_ratio = cc_edge_pixels / max(area, 1)
    if internal_edge_ratio > 0.12:
        logger.info(
            f"[DecoCC] Excluded DECORATION CC: {cc.describe(i)}, edge_ratio={internal_edge_ratio:.2f}, std={color_std:.1f}"
        )
        return True
    return False


def _compact_decoration(cc: _Components, i: int, color_std: float) -> bool:
    """A compact shape: a rectangle (fill > 0.65) or a circle (~0.78), where coasts fill under 0.6.

    A perfect rectangle always is one. A larger one must also be solid in colour,
    with thresholds relaxed for compact and for elongated shapes, which are scale
    and title bars rather than islands.
    """
    pct, fill = cc.pct(i), cc.fill(i)
    if fill < 0.65:
        return False  # Irregular shape — likely a real island
    if fill > 0.90:
        logger.info(f"[DecoCC] Excluded RECT CC: {cc.describe(i)}, fill={fill:.2f}")
        return True
    if pct > 1.5:
        std_limit: float = (55 if cc.aspect(i) > 2.5 else 40) if fill > 0.70 else 15
        if color_std > std_limit:
            return False  # Varied colors — likely a real geographic feature
    logger.info(f"[DecoCC] Excluded CC: {cc.describe(i)}, fill={fill:.2f}")
    return True


def _edge_decoration(cc: _Components, i: int) -> bool:
    """A small or medium component (< 8%) near an edge that is furniture rather than land.

    It is judged on its own, whatever lies beside it. Counting a component a pixel
    from the land as land (the interior tier's test) keeps, on the sample of the
    import's region maps measured, the sea labels, compass roses and scale bars
    whose pale halos run into the coast, and no island (#1740).
    """
    pct = cc.pct(i)
    # Very tiny CCs near edges: always exclude (scale bar fragments, dots)
    if pct < 0.3:
        return True
    color_std = cc.color_std(i)
    if pct < 2.0 and _marked_small_decoration(cc, i, color_std):
        return True
    # Scale bars are thin bars, aspect > 4 and uniform; islands almost never are
    aspect = cc.aspect(i)
    if aspect > 4 and color_std < 8 and pct < 3.0:
        logger.info(f"[DecoCC] Excluded ELONGATED CC: {cc.describe(i)}, aspect={aspect:.1f}, std={color_std:.1f}")
        return True
    return _compact_decoration(cc, i, color_std)


def _is_decoration(cc: _Components, i: int, protected: set[int]) -> bool:
    if not cc.near_edge(i):
        return _interior_decoration(cc, i, protected)
    pct = cc.pct(i)
    if 8.0 < pct <= 20.0 and cc.fill(i) > 0.70:
        return _title_box(cc, i)
    if pct > 8.0:
        return False
    return _edge_decoration(cc, i)


def exclude_decoration_ccs(
    country_mask: np.ndarray,
    filtered: np.ndarray,
    edge_pct: float = 0.25,
) -> np.ndarray:
    """The country mask without its decoration CCs (title boxes, compass roses, scale bars).

    Every connected component outside the protected set (the largest, forming
    90% of the country, unless they look artificial) is judged by where it sits:
    1. Inland (centroid outside edge_pct of every edge): only an isolated, very
       compact, uniform mark of 0.2-3% goes.
    2. Near an edge, 8-20% and compact: a solid-colour title box goes.
    3. Near an edge, under 8%: a CC under 0.3% always goes; a larger one goes on
       a decoration's evidence: one colour or text inside (under 2%), an
       elongated uniform bar, a perfect rectangle, or a compact shape, which
       above 1.5% must also be uniform in colour (`_compact_decoration`).
    """
    if int(np.sum(country_mask > 0)) == 0:
        return country_mask
    cc = _components(country_mask, filtered, edge_pct)
    num_cc = len(cc.stats)
    protected = _protected(cc, num_cc)

    result = country_mask.copy()
    excluded_total = 0
    for i in range(1, num_cc):
        if i not in protected and _is_decoration(cc, i, protected):
            result[cc.labels == i] = 0
            excluded_total += cc.area(i)

    if excluded_total > 0:
        logger.info(f"[DecoCC] Total excluded: {excluded_total} px in edge decoration CCs")
    return result
