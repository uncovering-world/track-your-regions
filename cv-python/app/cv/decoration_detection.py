"""
Decoration detection and removal for map images.

Detects and masks non-region decorative elements:
- Title boxes (rectangles with text, usually near corners)
- Scale bars (ruler graphics)
- Compass roses (circular N/S/E/W indicators)
- Highway markers (small colored rectangles with text)

Uses contour analysis + shape filtering — no ML required.
"""

import cv2
import numpy as np


def detect_decorations(
    image: np.ndarray,
    country_mask: np.ndarray,
    min_area: int = 50,
    max_area_pct: float = 5.0,
) -> np.ndarray:
    """Detect decorative elements (title boxes, scale bars, compass, markers).

    Returns a binary mask: 255 = decoration pixel, 0 = keep.

    Strategy:
    1. Find edges in the image (Canny) — decorations have sharp rectangular/circular edges
    2. Find contours of the edges
    3. Filter contours by shape properties (rectangularity, circularity, size, position)
    4. Build decoration mask from matching contours
    """
    h, w = image.shape[:2]
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return np.zeros((h, w), dtype=np.uint8)
    max_area = int(country_size * max_area_pct / 100)

    # Convert to grayscale for edge detection
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Detect edges — decorations have sharp manufactured edges vs smooth region boundaries
    edges = cv2.Canny(gray, 50, 150)

    # Dilate edges to connect nearby edge fragments
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges_dilated = cv2.dilate(edges, kernel, iterations=2)

    # Find contours of connected edge regions
    contours, _ = cv2.findContours(edges_dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    decoration_mask = np.zeros((h, w), dtype=np.uint8)
    detected = []

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue

        # Bounding rectangle
        x, y, bw, bh = cv2.boundingRect(contour)
        rect_area = bw * bh
        if rect_area == 0:
            continue

        # Shape properties
        extent = area / rect_area  # how much of bounding rect is filled
        aspect = max(bw, bh) / max(min(bw, bh), 1)
        perimeter = cv2.arcLength(contour, True)
        circularity = 4 * np.pi * area / max(perimeter * perimeter, 1)

        # Position: distance from nearest edge as fraction of image size
        cx, cy = x + bw // 2, y + bh // 2
        edge_dist_x = min(cx, w - cx) / w
        edge_dist_y = min(cy, h - cy) / h
        near_edge = edge_dist_x < 0.25 or edge_dist_y < 0.25

        # Title box detection: rectangular, near edge, moderate size
        is_title_box = (
            extent > 0.5
            and aspect < 6
            and near_edge
            and area > 200
            and area < max_area
            and
            # Has a distinct border (high edge density)
            perimeter > 4 * np.sqrt(area)
        )

        # Scale bar detection: very elongated horizontal rectangle, near bottom
        is_scale_bar = aspect > 4 and bh < 30 and cy > h * 0.7 and area > 100

        # Compass rose: roughly circular, small, usually right side or corner
        is_compass = circularity > 0.3 and aspect < 2.5 and area > 100 and area < max_area * 0.3 and near_edge

        # Highway marker: very small rectangle with high extent
        is_marker = extent > 0.6 and area < 500 and bw < 40 and bh < 30

        if is_title_box or is_scale_bar or is_compass or is_marker:
            # Fill the bounding rect (with padding) into the decoration mask
            pad = 3
            x1 = max(0, x - pad)
            y1 = max(0, y - pad)
            x2 = min(w, x + bw + pad)
            y2 = min(h, y + bh + pad)
            decoration_mask[y1:y2, x1:x2] = 255

            kind = "title" if is_title_box else "scale" if is_scale_bar else "compass" if is_compass else "marker"
            detected.append((kind, area, x, y, bw, bh))

    if detected:
        # Only keep detections that overlap with the country mask
        # (decorations in pure background are already handled)
        overlap_mask = cv2.bitwise_and(decoration_mask, country_mask)
        overlap_count = int(np.sum(overlap_mask > 0))
        print(
            f"  [DecoDetect] Found {len(detected)} decoration(s): "
            f"{sum(1 for d in detected if d[0]=='title')} title, "
            f"{sum(1 for d in detected if d[0]=='scale')} scale, "
            f"{sum(1 for d in detected if d[0]=='compass')} compass, "
            f"{sum(1 for d in detected if d[0]=='marker')} marker "
            f"({overlap_count} px overlap with country)"
        )

    return decoration_mask


def remove_decorations(
    image: np.ndarray,
    country_mask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Detect and inpaint decorative elements from the image.

    Returns (cleaned_image, updated_country_mask) with decorations removed.
    """
    deco_mask = detect_decorations(image, country_mask)

    if np.sum(deco_mask) == 0:
        return image, country_mask

    # Don't inpaint — just exclude decoration pixels from country mask
    # Inpainting creates white/gray artifacts that become their own clusters
    updated_mask = country_mask.copy()
    removed = int(np.sum((deco_mask > 0) & (country_mask > 0)))
    updated_mask[deco_mask > 0] = 0

    if removed > 0:
        print(f"  [DecoRemove] Excluded {removed} decoration pixels from country mask")

    return image, updated_mask
