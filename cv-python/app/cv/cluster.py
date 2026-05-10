import cv2
import numpy as np


def kmeans_cielab(
    image: np.ndarray,
    country_mask: np.ndarray,
    n_clusters: int = 12,
    random_seed: int = 0,
    chroma_boost: float = 1.0,
    known_noise_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, list]:
    """K-means clustering in CIELAB color space with chromatic normalization.

    Normalizes L/a/b channels by their standard deviation, with lightness
    downweighted (wL=0.5) so hue differences dominate over brightness.
    This matches the JS pipeline's approach and prevents merging of regions
    that differ in color but have similar lightness.

    Args:
        known_noise_mask: optional uint8 2D array of pixels known to be OCR /
            road / line / text residue (see preprocess.run_phase1). These
            pixels do NOT vote in K-means; after clustering they are assigned
            to their nearest surviving cluster via distance transform. That
            kills the ghost-text boundary problem where label pixels and
            their mean-shift halo drag a boundary across a real region.

    Returns pixel_labels (uint8, 255=background) and color_centroids as RGB lists.
    """
    h, w = image.shape[:2]
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2Lab).astype(np.float32)

    # Effective K-means mask: country AND NOT known-noise. Noise pixels are
    # filled in after clustering via nearest-neighbor label assignment.
    voting_mask_2d = country_mask > 0
    if known_noise_mask is not None:
        voting_mask_2d = voting_mask_2d & (known_noise_mask == 0)
        noise_pct = int((known_noise_mask > 0).sum()) / max(int((country_mask > 0).sum()), 1) * 100
        print(
            f"  [K-means] Excluding {int((known_noise_mask > 0).sum())} known-noise pixels ({noise_pct:.1f}% of country) from voting"
        )
    mask_flat = voting_mask_2d.flatten()
    pixels = lab.reshape(-1, 3)[mask_flat]

    if len(pixels) < n_clusters:
        labels = np.full(h * w, 255, dtype=np.uint8)
        return labels.reshape(h, w), []

    # Chromatic normalization: z-score with lightness downweighted
    # This is the key quality difference vs naive K-means
    mean_l, mean_a, mean_b = pixels[:, 0].mean(), pixels[:, 1].mean(), pixels[:, 2].mean()
    std_l = max(pixels[:, 0].std(), 1.0)
    std_a = max(pixels[:, 1].std(), 1.0)
    std_b = max(pixels[:, 2].std(), 1.0)

    w_l = 0.5 / std_l  # lightness downweighted
    w_a = chroma_boost / std_a  # chroma channels boosted
    w_b = chroma_boost / std_b

    normalized = np.empty_like(pixels)
    normalized[:, 0] = (pixels[:, 0] - mean_l) * w_l
    normalized[:, 1] = (pixels[:, 1] - mean_a) * w_a
    normalized[:, 2] = (pixels[:, 2] - mean_b) * w_b

    # random_seed > 0: use RANDOM_CENTERS with 1 attempt + explicit RNG seed,
    # so each "Different seed" click gives a genuinely different result.
    # random_seed == 0: PP_CENTERS with 10 attempts for best deterministic result.
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.2)
    if random_seed > 0:
        cv2.setRNGSeed(random_seed)
        _, km_labels, centers_norm = cv2.kmeans(normalized, n_clusters, None, criteria, 1, cv2.KMEANS_RANDOM_CENTERS)
    else:
        _, km_labels, centers_norm = cv2.kmeans(normalized, n_clusters, None, criteria, 10, cv2.KMEANS_PP_CENTERS)

    # Compute centroids from actual Lab values (not normalized)
    pixel_labels = np.full(h * w, 255, dtype=np.uint8)
    pixel_labels[mask_flat] = km_labels.flatten().astype(np.uint8)
    pixel_labels_2d = pixel_labels.reshape(h, w)

    centroids = []
    lab_flat = lab.reshape(-1, 3)
    for i in range(n_clusters):
        cluster_pixels = lab_flat[pixel_labels == i]
        if len(cluster_pixels) == 0:
            centroids.append([128, 128, 128])
            continue
        mean_lab = cluster_pixels.mean(axis=0)
        lab_pixel = np.array([[[mean_lab[0], mean_lab[1], mean_lab[2]]]], dtype=np.float32)
        bgr = cv2.cvtColor(lab_pixel.astype(np.uint8), cv2.COLOR_Lab2BGR)[0, 0]
        centroids.append([int(bgr[2]), int(bgr[1]), int(bgr[0])])  # RGB

    # Fill in any country pixels that were excluded via known_noise_mask by
    # assigning them to their nearest non-noise neighbor's label. This keeps
    # the output mask complete (no 255 holes inside the country) while still
    # preventing those pixels from having voted on cluster colors.
    if known_noise_mask is not None:
        holes = (country_mask > 0) & (pixel_labels_2d == 255)
        if holes.any():
            _fill_holes_via_nearest_label(pixel_labels_2d, holes)

    # Spatial mode filter: replace each pixel with the majority label in its neighborhood
    # Two passes: first at radius=5 (standard), then radius=8 (aggressive for text remnants)
    pixel_labels_2d = spatial_mode_filter(pixel_labels_2d, country_mask, radius=5)
    pixel_labels_2d = spatial_mode_filter(pixel_labels_2d, country_mask, radius=8)

    return pixel_labels_2d, centroids


def _fill_holes_via_nearest_label(pixel_labels_2d: np.ndarray, holes: np.ndarray) -> None:
    """Fill `holes` pixels in-place with the label of the nearest labeled
    neighbor, computed via distance transform of the non-hole mask.
    """
    non_hole = (~holes).astype(np.uint8) * 255
    # distanceTransformWithLabels returns label index per pixel pointing at
    # the nearest seed (a non-hole pixel). Use that to copy labels.
    _, labels_idx = cv2.distanceTransformWithLabels(
        non_hole,
        cv2.DIST_L2,
        3,
        labelType=cv2.DIST_LABEL_PIXEL,
    )
    # labels_idx is a 2D int32 array where each pixel points at the 1-based
    # index of its nearest seed. Seeds are the non-hole pixels, enumerated
    # in row-major order of the *seed set*. Build a lookup from seed-index
    # back to (y, x) to map to the underlying label.
    seed_ys, seed_xs = np.nonzero(non_hole > 0)
    if len(seed_ys) == 0:
        return
    # The implementation guarantees label indices start at 1 for the first
    # seed in row-major order — which matches np.nonzero ordering.
    hole_seed_idx = labels_idx[holes] - 1
    # Clamp to valid range defensively.
    hole_seed_idx = np.clip(hole_seed_idx, 0, len(seed_ys) - 1)
    src_y = seed_ys[hole_seed_idx]
    src_x = seed_xs[hole_seed_idx]
    pixel_labels_2d[holes] = pixel_labels_2d[src_y, src_x]
    filled = int(holes.sum())
    print(f"  [K-means] Filled {filled} noise-hole pixels via nearest-label assignment")


def spatial_mode_filter(
    labels: np.ndarray,
    country_mask: np.ndarray,
    radius: int = 5,
) -> np.ndarray:
    """Replace each pixel's label with the majority label in its neighborhood.
    Removes salt-and-pepper noise from K-means BFS seams and line residue.
    Uses per-label box filter for O(n*k) performance instead of O(n*r^2)."""
    h, w = labels.shape
    result = labels.copy()
    n_labels = int(labels[labels != 255].max()) + 1 if np.any(labels != 255) else 0
    if n_labels == 0:
        return result

    # Build per-label count maps using box filter (fast convolution)
    kernel = np.ones((2 * radius + 1, 2 * radius + 1), dtype=np.float32)
    best_count = np.zeros((h, w), dtype=np.float32)
    best_label = np.full((h, w), 255, dtype=np.uint8)

    for lbl in range(n_labels):
        # Binary mask for this label, filtered to get neighborhood count
        lbl_mask = ((labels == lbl) & (country_mask > 0)).astype(np.float32)
        count = cv2.filter2D(lbl_mask, -1, kernel, borderType=cv2.BORDER_CONSTANT)
        # Update best where this label has higher count
        better = count > best_count
        best_count[better] = count[better]
        best_label[better] = lbl

    # Only apply where: inside country mask, current label differs from majority,
    # and majority has >60% of the neighborhood
    total_mask = (country_mask > 0).astype(np.float32)
    total_count = cv2.filter2D(total_mask, -1, kernel, borderType=cv2.BORDER_CONSTANT)
    total_count = np.maximum(total_count, 1)  # avoid division by zero

    should_change = (country_mask > 0) & (labels != 255) & (best_label != labels) & (best_count / total_count > 0.6)
    result[should_change] = best_label[should_change]

    changed = int(np.sum(should_change))
    if changed > 0:
        print(f"  [Mode Filter] Changed {changed} pixels ({changed / max(np.sum(country_mask > 0), 1) * 100:.1f}%)")

    return result
