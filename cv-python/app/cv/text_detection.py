"""
OCR-based text detection and removal using EasyOCR.

Detects all text regions in the image and masks them so they can be
inpainted before K-means clustering. This catches text that color-based
and morphological approaches cannot — text is structurally different
from region colors but shares the same hue/saturation/value.
"""

import cv2
import numpy as np

# Lazy-loaded EasyOCR reader (heavy — ~2s first call)
_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _reader


def detect_text_regions(image: np.ndarray, min_confidence: float = 0.3) -> np.ndarray:
    """Detect text regions using EasyOCR and return a binary mask.

    Runs EasyOCR on a half-size image for speed (~4x faster on CPU),
    then scales detected bounding boxes back to full pipeline resolution.

    Args:
        image: BGR image (pipeline resolution)
        min_confidence: minimum OCR confidence to include a detection

    Returns:
        Binary mask (255 = text pixel, 0 = keep)
    """
    h, w = image.shape[:2]
    reader = _get_reader()

    # Run OCR on half-size image for speed (EasyOCR is O(n²) on CPU)
    ocr_scale = 0.5
    small = cv2.resize(image, (int(w * ocr_scale), int(h * ocr_scale)))
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    results = reader.readtext(rgb)
    # Scale bounding boxes back to full resolution
    results = [
        ([[p[0] / ocr_scale, p[1] / ocr_scale] for p in bbox], text, conf)
        for bbox, text, conf in results
    ]

    mask = np.zeros((h, w), dtype=np.uint8)
    detected = 0

    for bbox, _text, conf in results:
        # bbox is a list of 4 points [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
        pts = np.array(bbox, dtype=np.int32)
        bbox_h = max(pts[:, 1]) - min(pts[:, 1])

        # Large text (h >= 30, like titles) — accept lower confidence (0.15)
        # because large text is rarely a false positive
        # Edge text (near borders) — accept lower confidence (0.2)
        # because edge text is usually decorations (compass labels, scale bars)
        # Small text (h < 30, interior) — standard confidence threshold
        pts_center_x = pts[:, 0].mean()
        pts_center_y = pts[:, 1].mean()
        near_edge = (
            pts_center_x < w * 0.20 or pts_center_x > w * 0.80 or
            pts_center_y < h * 0.20 or pts_center_y > h * 0.80
        )
        if bbox_h >= 30:
            effective_conf = 0.15
        elif near_edge:
            effective_conf = 0.15  # more aggressive for edge text
        else:
            effective_conf = min_confidence
        if conf < effective_conf:
            continue

        # Only mask text regions larger than 8px in height
        if bbox_h < 8:
            continue

        # Expand the bounding box by a few pixels to cover anti-aliased edges
        center = pts.mean(axis=0)
        expanded = center + (pts - center) * 1.15  # 15% padding
        expanded = expanded.astype(np.int32)

        cv2.fillPoly(mask, [expanded], 255)
        detected += 1

    if detected > 0:
        text_px = int(np.sum(mask > 0))
        print(f"  [OCR] Detected {detected} text regions ({text_px} px)")

    return mask


def _expand_to_container(
    image: np.ndarray,
    mask: np.ndarray,
    bbox: list,
    border_pct: float = 0.15,
) -> np.ndarray:
    """If text is near an image corner/edge, check if there's a rectangular
    colored container (title box) around it and expand the mask to cover it.

    Title boxes have a distinct background color that differs from the
    surrounding map. We sample the container color from OUTSIDE the text bbox
    (not inside, which has text pixels), then flood-fill to find the full box.

    Conservative expansion: only near edges, small area, tight color match.
    """
    h, w = image.shape[:2]
    pts = np.array(bbox, dtype=np.int32)
    cx = int(pts[:, 0].mean())
    cy = int(pts[:, 1].mean())

    # Only expand for text very near edges (title boxes, not map labels)
    near_edge = (
        cx < w * border_pct or cx > w * (1 - border_pct) or
        cy < h * border_pct or cy > h * (1 - border_pct)
    )
    if not near_edge:
        return mask

    # Sample the color at text center (container background)
    if not (0 <= cy < h and 0 <= cx < w):
        return mask

    y1, y2 = max(0, cy - 3), min(h, cy + 3)
    x1, x2 = max(0, cx - 3), min(w, cx + 3)
    region = image[y1:y2, x1:x2]
    if region.size == 0:
        return mask

    container_color = region.mean(axis=(0, 1)).astype(np.float32)

    itx1 = int(pts[:, 0].min())
    ity1 = int(pts[:, 1].min())
    itx2 = int(pts[:, 0].max())
    ity2 = int(pts[:, 1].max())

    # Flood-fill from text bbox: find connected pixels with similar color
    diff = np.abs(image.astype(np.float32) - container_color[np.newaxis, np.newaxis, :])
    max_diff = diff.max(axis=2)
    similar = (max_diff <= 25).astype(np.uint8)

    # Seed from text bounding box area
    seed = np.zeros((h, w), dtype=np.uint8)
    tx1 = max(0, itx1 - 5)
    ty1 = max(0, ity1 - 5)
    tx2 = min(w, itx2 + 5)
    ty2 = min(h, ity2 + 5)
    seed[ty1:ty2, tx1:tx2] = 1

    # Conservative flood fill: 20 iterations of 3x3 kernel
    for _ in range(20):
        dilated = cv2.dilate(seed, np.ones((3, 3), np.uint8))
        seed = cv2.bitwise_and(dilated, similar)

    container_area = int(np.sum(seed > 0))
    # Only use if container is reasonably sized (not the entire image)
    if container_area < h * w * 0.05 and container_area > 50:
        mask = np.maximum(mask, seed * 255)

    return mask


def remove_text_from_image(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Detect and inpaint all text in the image.

    Uses EasyOCR for detection, expands to container rectangles for
    title boxes, then cv2.inpaint to fill text areas with surrounding
    colors. This should run BEFORE mean-shift and K-means.

    Returns:
        (result_bgr, text_mask) — text_mask is uint8 2D, non-zero where a
        text pixel was detected + flat-filled. Caller unions this into the
        pipeline's known_noise_mask so K-means excludes those positions.
    """
    mask = detect_text_regions(image)

    if np.sum(mask) == 0:
        return image, np.zeros(image.shape[:2], dtype=np.uint8)

    # Expand title box detections to cover the container rectangle
    # Only for large text regions that were actually masked (bbox_h >= 15)
    reader = _get_reader()
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = reader.readtext(rgb)
    for bbox, _text, conf in results:
        pts = np.array(bbox, dtype=np.int32)
        bbox_h = max(pts[:, 1]) - min(pts[:, 1])
        # Same threshold as detection: large text (h >= 30) uses 0.15
        effective_conf = 0.15 if bbox_h >= 30 else 0.3
        if conf < effective_conf or bbox_h < 15:
            continue
        mask = _expand_to_container(image, mask, bbox)

    expanded_px = int(np.sum(mask > 0))
    print(f"  [OCR] After container expansion: {expanded_px} px masked")

    # Flat-fill each mask connected component with the median color of its
    # surrounding ring. This produces truly uniform regions (no sub-pixel hue
    # shifts) which K-means sees as homogeneous, eliminating the "ghost text"
    # residue that survived cv2.inpaint's diffusion.
    #
    # We also build a LETTER-PRECISE mask (`letter_mask`) — within each bbox,
    # the pixels whose original colour differed significantly from the flat-fill
    # median. These are the actual text strokes. The bbox-level mask would be
    # unsafe to union into known_noise_mask (one bbox can straddle two regions
    # and kill region distinction), but a letter-precise mask is safe: it
    # excludes only the ink pixels themselves, which is exactly the noise we
    # want out of K-means voting.
    result = image.copy()
    num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8))
    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    letter_mask = np.zeros(image.shape[:2], dtype=np.uint8)
    flat_filled = 0
    letter_px = 0
    for ci in range(1, num_cc):
        area = int(cc_stats[ci, cv2.CC_STAT_AREA])
        if area == 0:
            continue
        cc_mask = (cc_labels == ci).astype(np.uint8)
        dilated = cv2.dilate(cc_mask, ring_kernel)
        ring = (dilated > 0) & (cc_mask == 0) & (mask == 0)  # outside mask pixels in ring
        if int(ring.sum()) < 10:
            continue  # ring too small (edge of image) — fall through to cv2.inpaint
        ring_pixels = image[ring]
        median_bgr = np.median(ring_pixels, axis=0).astype(np.uint8)
        # Letter-precise: pixels in this CC whose original colour is far from
        # the ring median (i.e. the ink strokes, not intra-bbox region pixels).
        cc_bool = cc_mask > 0
        diff = np.linalg.norm(image[cc_bool].astype(np.float32) - median_bgr.astype(np.float32), axis=-1)
        cc_ys, cc_xs = np.where(cc_bool)
        ink_sel = diff > 25
        letter_mask[cc_ys[ink_sel], cc_xs[ink_sel]] = 1
        letter_px += int(ink_sel.sum())
        result[cc_bool] = median_bgr
        flat_filled += area

    # Dilate letter mask by 1 px to catch anti-aliased stroke edges whose
    # colour is halfway between ink and ring — those are the pixels that
    # otherwise survive mean-shift and form the olive-ghost sub-clusters.
    if letter_px > 0:
        letter_mask = cv2.dilate(letter_mask, np.ones((3, 3), np.uint8))

    print(f"  [OCR] Flat-filled {flat_filled}/{expanded_px} px with per-CC ring median")
    print(f"  [OCR] Letter-precise mask: {int(letter_mask.sum())} px (from {letter_px} ink pixels + 1-px dilation)")

    # Residual mask: CCs that couldn't be flat-filled (edge-adjacent, no ring)
    # fall back to cv2.inpaint. Build residual from pixels still equal to their
    # original value within the mask — those weren't flat-filled above.
    still_masked = (mask > 0) & np.all(result == image, axis=2)
    if int(still_masked.sum()) > 0:
        result = cv2.inpaint(result, still_masked.astype(np.uint8), inpaintRadius=10, flags=cv2.INPAINT_TELEA)

    return result, letter_mask
