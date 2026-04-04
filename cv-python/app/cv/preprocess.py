import cv2
import numpy as np
from ..utils.image import resize_image, encode_png_base64


def mean_shift_filter(image: np.ndarray, sp: int = 10, sr: int = 20) -> np.ndarray:
    """Apply pyrMeanShiftFiltering — the function missing from OpenCV.js WASM."""
    return cv2.pyrMeanShiftFiltering(image, sp, sr)


def detect_background(image: np.ndarray) -> np.ndarray:
    """Detect background (gray/desaturated) pixels.
    Returns a binary mask: 255 = foreground (country), 0 = background."""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    bg_mask = ((sat < 30) & (val > 180)).astype(np.uint8) * 255
    country_mask = cv2.bitwise_not(bg_mask)
    return country_mask


def detect_water(image: np.ndarray, country_mask: np.ndarray) -> tuple[np.ndarray, list]:
    """Detect water regions (blue-ish areas).
    Returns water mask and component info for review."""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    lower_blue = np.array([90, 20, 80])
    upper_blue = np.array([130, 255, 255])
    water_mask = cv2.inRange(hsv, lower_blue, upper_blue)
    water_mask = cv2.bitwise_and(water_mask, country_mask)

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(water_mask)
    total_country = int(np.sum(country_mask > 0))
    components = []
    for i in range(1, num_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        pct = round(area / max(total_country, 1) * 100, 1)
        if pct >= 0.5:
            components.append({"id": i, "pct": pct})

    return water_mask, components


def run_phase1(
    image: np.ndarray,
    tw: int,
    th: int,
    orig_w: int,
    orig_h: int,
) -> dict:
    """Phase 1: preprocess image, detect water and background."""
    pipeline_img = resize_image(image, tw, th)
    filtered = mean_shift_filter(pipeline_img, sp=10, sr=20)
    country_mask = detect_background(filtered)
    country_size = int(np.sum(country_mask > 0))
    water_mask, water_components = detect_water(filtered, country_mask)

    filtered_display = resize_image(filtered, orig_w, orig_h)
    debug_images = [
        {"label": "Mean-shift filtered (Python)", "dataUrl": encode_png_base64(filtered_display)},
    ]

    return {
        "filteredImage": encode_png_base64(filtered),
        "waterMask": encode_png_base64(water_mask),
        "waterComponents": water_components,
        "countryMask": encode_png_base64(country_mask),
        "countrySize": country_size,
        "debugImages": debug_images,
    }
