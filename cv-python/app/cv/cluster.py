import cv2
import numpy as np


def kmeans_cielab(
    image: np.ndarray,
    country_mask: np.ndarray,
    n_clusters: int = 12,
) -> tuple[np.ndarray, list]:
    """K-means clustering in CIELAB color space.
    Returns pixel_labels (uint8, 255=background) and color_centroids as RGB lists."""
    h, w = image.shape[:2]
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2Lab).astype(np.float32)

    mask_flat = country_mask.flatten() > 0
    pixels = lab.reshape(-1, 3)[mask_flat]

    if len(pixels) < n_clusters:
        labels = np.full(h * w, 255, dtype=np.uint8)
        return labels.reshape(h, w), []

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
    _, km_labels, centers = cv2.kmeans(
        pixels, n_clusters, None, criteria, 10, cv2.KMEANS_PP_CENTERS
    )

    pixel_labels = np.full(h * w, 255, dtype=np.uint8)
    pixel_labels[mask_flat] = km_labels.flatten().astype(np.uint8)

    centroids = []
    for c in centers:
        lab_pixel = np.array([[[c[0], c[1], c[2]]]], dtype=np.float32)
        bgr = cv2.cvtColor(lab_pixel.astype(np.uint8), cv2.COLOR_Lab2BGR)[0, 0]
        centroids.append([int(bgr[2]), int(bgr[1]), int(bgr[0])])  # RGB

    return pixel_labels.reshape(h, w), centroids
