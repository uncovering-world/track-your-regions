"""Inset detection: the boxes a map cuts off with straight rules (Alaska and Hawaii style).

Strong horizontal and vertical lines that span most of the image split it into
rectangular sections. The largest section is the main map, and the clearly
smaller ones are insets, masked so they are added to the background.
"""

import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Section bounds: (y_start, y_end, x_start, x_end, area)
Section = tuple[int, int, int, int, int]


def _rule_positions(lines: np.ndarray, w: int, h: int) -> tuple[list[float], list[float]]:
    """The y of each long horizontal line and the x of each long vertical one, away from the edges."""
    h_lines = []
    v_lines = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))

        # Horizontal line: angle near 0 or 180, spans >70% of width
        # Strict to avoid coastlines and other curved features
        if (angle < 3 or angle > 177) and abs(x2 - x1) > w * 0.7:
            # Must be in the inner 70% of the image (not near edges)
            avg_y = (y1 + y2) / 2
            if h * 0.15 < avg_y < h * 0.85:
                h_lines.append(avg_y)

        # Vertical line: angle near 90, spans >40% of height
        if 87 < angle < 93 and abs(y2 - y1) > h * 0.4:
            avg_x = (x1 + x2) / 2
            if w * 0.15 < avg_x < w * 0.85:
                v_lines.append(avg_x)
    return h_lines, v_lines


def _cluster_lines(positions: list[float], min_gap: int = 15) -> list[int]:
    """The median of each run of positions closer than min_gap, for runs of at least 2 (strong evidence)."""
    if not positions:
        return []
    positions = sorted(positions)
    clusters = [[positions[0]]]
    for p in positions[1:]:
        if p - clusters[-1][-1] < min_gap:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    return [int(np.median(c)) for c in clusters if len(c) >= 2]


def _is_continuous(band: np.ndarray, axis: int, span: int) -> bool:
    """Whether edge pixels run along more than 75% of the band, as a straight rule's do.

    A coastline has gaps; a rule has an edge pixel in most columns (or rows).
    """
    has_edge = np.any(band > 0, axis=axis)
    return bool(np.sum(has_edge) / max(span, 1) > 0.75)


def _boundaries(edges: np.ndarray, h_lines: list[float], v_lines: list[float]) -> tuple[list[int], list[int]]:
    """The clustered rule positions whose edges run continuously across the image."""
    h, w = edges.shape[:2]
    h_boundaries = [y for y in _cluster_lines(h_lines) if _is_continuous(edges[max(0, y - 3) : min(h, y + 4), :], 0, w)]
    v_boundaries = [x for x in _cluster_lines(v_lines) if _is_continuous(edges[:, max(0, x - 3) : min(w, x + 4)], 1, h)]
    return h_boundaries, v_boundaries


def _sections(h_boundaries: list[int], v_boundaries: list[int], h: int, w: int) -> list[Section]:
    """The rectangles the boundaries cut the image into, largest first."""
    y_cuts = [0, *h_boundaries, h]
    x_cuts = [0, *v_boundaries, w]
    sections = []
    for i in range(len(y_cuts) - 1):
        for j in range(len(x_cuts) - 1):
            y_start, y_end = y_cuts[i], y_cuts[i + 1]
            x_start, x_end = x_cuts[j], x_cuts[j + 1]
            sections.append((y_start, y_end, x_start, x_end, (y_end - y_start) * (x_end - x_start)))
    sections.sort(key=lambda s: -s[4])
    return sections


def _inset_mask(sections: list[Section], h: int, w: int) -> np.ndarray | None:
    """The mask of every section clearly smaller than the main one, or None when there is none.

    The main section must be at least 40% of the image, and a section is an
    inset only when it is under 80% of the main one.
    """
    main_section = sections[0]
    total_area = h * w
    if main_section[4] < total_area * 0.4:
        return None

    insets = [s for s in sections[1:] if s[4] < main_section[4] * 0.8]
    inset_mask = np.zeros((h, w), dtype=np.uint8)
    for y_start, y_end, x_start, x_end, _ in insets:
        inset_mask[y_start:y_end, x_start:x_end] = 255

    inset_total = int(np.sum(inset_mask > 0))
    if inset_total == 0:
        return None
    logger.info(f"[Inset] Detected {len(insets)} inset section(s), masking {inset_total} px")
    logger.info(
        f"[Inset] Main section: y=[{main_section[0]},{main_section[1]}], x=[{main_section[2]},{main_section[3]}]"
    )
    for s in insets:
        logger.info(f"[Inset] Inset: y=[{s[0]},{s[1]}], x=[{s[2]},{s[3]}] ({s[4] / total_area * 100:.1f}%)")
    return inset_mask


def detect_inset_mask(image: np.ndarray) -> np.ndarray | None:
    """Detect inset box boundaries (Alaska/Hawaii style) using Hough lines.

    Looks for strong horizontal/vertical lines that span most of the image
    width/height. These dividing lines split the image into rectangular
    sections. The largest section is assumed to be the main map; all other
    sections are returned as an inset mask (to be added to background).

    Returns a binary mask (255 = inset region to exclude) or None if no
    inset boundaries detected.
    """
    h, w = image.shape[:2]
    # Edge detection — use tight thresholds to catch the inset boundary lines
    edges = cv2.Canny(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), 50, 150)
    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180, threshold=100, minLineLength=int(w * 0.4), maxLineGap=20)
    if lines is None:
        return None

    h_boundaries, v_boundaries = _boundaries(edges, *_rule_positions(lines, w, h))
    if not h_boundaries and not v_boundaries:
        return None
    sections = _sections(h_boundaries, v_boundaries, h, w)
    if len(sections) < 2:
        return None
    return _inset_mask(sections, h, w)
