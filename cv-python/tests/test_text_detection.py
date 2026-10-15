"""EasyOCR through the pipeline's own entry point, on the torch build installed.

EasyOCR is torch's only consumer. This runs the real reader, not a mock, so a
torch build that cannot run the detector fails here rather than in a map
import. The reader fetches its models on first use (about 100 MB, cached
under ~/.EasyOCR).
"""

import cv2
import numpy as np

from app.cv.text_detection import detect_text_regions

WORD = "VENEZIA"


def _label_on_a_map() -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """A map-coloured background with one dark label in its interior.

    Returns the image and the label's ink box (x1, y1, x2, y2).
    """
    image = np.full((500, 900, 3), (205, 230, 240), dtype=np.uint8)
    font, scale, thickness = cv2.FONT_HERSHEY_SIMPLEX, 3.0, 6
    (tw, th), baseline = cv2.getTextSize(WORD, font, scale, thickness)
    x, y = (900 - tw) // 2, (500 + th) // 2
    cv2.putText(image, WORD, (x, y), font, scale, (40, 40, 40), thickness, cv2.LINE_AA)
    return image, (x, y - th, x + tw, y + baseline)


def test_finds_the_label_and_masks_nothing_else() -> None:
    image, (x1, y1, x2, y2) = _label_on_a_map()

    mask = detect_text_regions(image)

    assert mask.shape == image.shape[:2]
    ink = np.all(image < 100, axis=2)
    covered = np.count_nonzero(mask[ink] > 0) / np.count_nonzero(ink)
    assert covered > 0.9, f"the mask covers {covered:.0%} of the label's ink"
    outside = mask.copy()
    pad = 40
    outside[max(0, y1 - pad) : y2 + pad, max(0, x1 - pad) : x2 + pad] = 0
    assert np.count_nonzero(outside) == 0, "the mask reaches past the label"
