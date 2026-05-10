"""
Cluster cleanup pipeline for the Python CV service.

Ports the JS pipeline's post-K-means cleanup operations:
1. Tiny cluster merge: clusters < 2% of country merged into nearest large cluster (RGB dist <= 40)
2. Small patch removal: per-cluster CCs, patches < min_patch_size merged into most common neighbor
3. Noise exclusion: auto-exclude desaturated (S<25), dark (V<60), or tiny (<0.5%) clusters

These steps clean up K-means artifacts and recover merged regions.
"""

import cv2
import numpy as np

# -- Constants (match JS pipeline) --
MERGE_SIZE_PCT = 0.02  # clusters < 2% are candidates for merge (loose color: RGB ≤ 40)
MERGE_MODERATE_PCT = 0.06  # clusters 2-6% are merge candidates with stricter color (RGB ≤ 15)
MERGE_MODERATE_DIST_SQ = 15 * 15
MERGE_MAX_DIST_SQ = 40 * 40  # max squared RGB distance for merge
NOISE_MIN_SAT = 25  # minimum saturation for a valid cluster
NOISE_MIN_VAL = 60  # minimum value for a valid cluster
NOISE_TINY_PCT = 0.5  # clusters < 0.5% auto-excluded (unless colorful)
NOISE_COLORFUL_TINY_PCT = 0.15  # colorful tiny clusters get a lower threshold — they're likely real regions


def _cluster_counts(pixel_labels: np.ndarray) -> dict[int, int]:
    """Count pixels per cluster label (excluding 255=background)."""
    labels_flat = pixel_labels.flatten()
    unique, counts = np.unique(labels_flat[labels_flat != 255], return_counts=True)
    return {int(lbl): int(cnt) for lbl, cnt in zip(unique, counts, strict=False)}


def _rgb_sat_val(color_rgb: list[int]) -> tuple[float, float]:
    """Compute HSV-style saturation and value from an RGB triplet.
    Returns (saturation 0-255, value 0-255)."""
    r, g, b = color_rgb
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    val = float(max_c)
    sat = ((max_c - min_c) / max_c * 255) if max_c > 0 else 0.0
    return sat, val


def _are_spatially_adjacent(
    pixel_labels: np.ndarray,
    label_a: int,
    label_b: int,
    min_border: int = 5,
) -> bool:
    """Check if two clusters share a spatial border (4-connected adjacency).

    Returns True if at least `min_border` pixels of label_a have a direct
    4-neighbor belonging to label_b.
    """
    h, w = pixel_labels.shape
    mask_a = pixel_labels == label_a

    # Dilate mask_a by 1 pixel (4-connected) and check overlap with label_b
    kernel = np.array([[0, 1, 0], [1, 0, 1], [0, 1, 0]], dtype=np.uint8)
    dilated = cv2.dilate(mask_a.astype(np.uint8), kernel)
    border_count = int(np.sum((dilated > 0) & (pixel_labels == label_b)))
    return border_count >= min_border


def merge_tiny_clusters(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    country_size: int,
) -> np.ndarray:
    """Merge tiny clusters (< 2% of country) into nearest large cluster.

    Only merges if RGB distance <= 40 AND the clusters are spatially adjacent.
    The adjacency check prevents merging clusters that happen to have similar
    colors but are in different parts of the map (e.g., two separate provinces
    with similar greens). Truly tiny clusters (<0.5%) skip the adjacency check
    to still allow noise cleanup.

    Modifies pixel_labels in place and returns it for convenience.
    """
    counts = _cluster_counts(pixel_labels)
    all_labels = list(counts.keys())

    # Identify large clusters (>= 6%) — won't be merged
    # Moderate (2-6%) — merge candidates with strict RGB threshold (MERGE_MODERATE_DIST_SQ)
    # Small (< 2%) — merge candidates with loose RGB threshold (MERGE_MAX_DIST_SQ)
    large_labels = [k for k in all_labels if counts[k] / country_size >= MERGE_MODERATE_PCT]
    candidate_labels = [k for k in all_labels if counts[k] / country_size < MERGE_MODERATE_PCT]

    if not large_labels or not candidate_labels:
        return pixel_labels

    # Threshold: clusters above this pct require spatial adjacency to merge
    ADJACENCY_REQUIRED_PCT = 0.005  # 0.5%

    for k in candidate_labels:
        cnt = counts[k]
        if k >= len(color_centroids) or color_centroids[k] is None:
            continue

        ck = color_centroids[k]
        k_pct = cnt / country_size
        is_moderate = k_pct >= MERGE_SIZE_PCT
        max_dist_sq = MERGE_MODERATE_DIST_SQ if is_moderate else MERGE_MAX_DIST_SQ
        requires_adjacency = k_pct >= ADJACENCY_REQUIRED_PCT

        # Find nearest large cluster by RGB distance, optionally filtered by adjacency
        min_dist_sq = float("inf")
        best_target = -1

        for j in large_labels:
            if j >= len(color_centroids) or color_centroids[j] is None:
                continue
            cj = color_centroids[j]
            d_sq = (ck[0] - cj[0]) ** 2 + (ck[1] - cj[1]) ** 2 + (ck[2] - cj[2]) ** 2
            if d_sq >= min_dist_sq:
                continue
            # For clusters above the threshold, require spatial adjacency
            if requires_adjacency and not _are_spatially_adjacent(pixel_labels, k, j):
                continue
            min_dist_sq = d_sq
            best_target = j

        rgb_dist = min_dist_sq**0.5
        tier = "moderate" if is_moderate else "small"
        if min_dist_sq <= max_dist_sq and best_target >= 0:
            print(f"  [Merge-{tier}] cluster {k} ({k_pct * 100:.1f}%) -> {best_target} (RGB dist={rgb_dist:.1f})")
            pixel_labels[pixel_labels == k] = best_target
        elif best_target >= 0:
            reason = "too far" if min_dist_sq > max_dist_sq else "not adjacent"
            print(
                f"  [Merge-{tier}] cluster {k} ({k_pct * 100:.1f}%) KEPT -- nearest {best_target} {reason} (RGB dist={rgb_dist:.1f})"
            )

    return pixel_labels


def remove_small_patches(
    pixel_labels: np.ndarray,
    country_size: int,
    min_patch_px: int = 20,
) -> np.ndarray:
    """For each cluster, find connected components. Patches smaller than
    min_patch_px are merged into the most common neighboring cluster.

    The JS pipeline uses max(pxS(20), countrySize * 0.02) as threshold.
    """
    h, w = pixel_labels.shape
    min_patch = max(min_patch_px, round(country_size * 0.02))
    unique_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]

    patch_merge_count = 0

    for lbl in unique_labels:
        # Find all CCs of this label
        label_mask = (pixel_labels == lbl).astype(np.uint8)
        num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(label_mask)

        if num_cc <= 2:  # 0=background, 1=single component
            continue

        # Sort CCs by size (skip background CC 0)
        cc_sizes = [(i, int(cc_stats[i, cv2.CC_STAT_AREA])) for i in range(1, num_cc)]
        cc_sizes.sort(key=lambda x: -x[1])

        # Skip the largest CC, merge smaller ones
        for cc_idx, cc_size in cc_sizes[1:]:
            if cc_size >= min_patch:
                continue

            # Find most common neighbor
            cc_mask = cc_labels == cc_idx
            # Dilate by 1 pixel to find neighbors
            dilated = cv2.dilate(cc_mask.astype(np.uint8), np.ones((3, 3), np.uint8))
            border = (dilated > 0) & ~cc_mask

            neighbor_labels = pixel_labels[border]
            neighbor_labels = neighbor_labels[(neighbor_labels != 255) & (neighbor_labels != lbl)]

            if len(neighbor_labels) == 0:
                continue

            # Most common neighbor
            unique_nbrs, nbr_counts = np.unique(neighbor_labels, return_counts=True)
            best_nbr = int(unique_nbrs[np.argmax(nbr_counts)])

            pixel_labels[cc_mask] = best_nbr
            patch_merge_count += 1

    if patch_merge_count > 0:
        print(f"  [Patch] {patch_merge_count} small patches relabeled (threshold: {min_patch}px)")

    return pixel_labels


def exclude_noise_clusters(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    filtered_image: np.ndarray,
    country_size: int,
) -> np.ndarray:
    """Auto-exclude clusters that are desaturated (S<25), dark (V<60), or tiny (<0.5%).

    Reassigns excluded pixels to the nearest valid cluster by pixel color distance.
    """
    counts = _cluster_counts(pixel_labels)

    noise_ids = []
    valid_ids = []

    for lbl, cnt in counts.items():
        if lbl >= len(color_centroids) or color_centroids[lbl] is None:
            noise_ids.append(lbl)
            continue

        c = color_centroids[lbl]
        pct = cnt / country_size * 100
        sat, val = _rgb_sat_val(c)

        is_colorful = sat >= NOISE_MIN_SAT and val >= NOISE_MIN_VAL

        # Tiny threshold: colorful clusters get a tighter threshold
        tiny_threshold = NOISE_COLORFUL_TINY_PCT if is_colorful else NOISE_TINY_PCT
        if pct < tiny_threshold:
            noise_ids.append(lbl)
            continue

        # Desaturated or dark (but not too large -- >15% might be legitimate)
        if (sat < NOISE_MIN_SAT or val < NOISE_MIN_VAL) and pct < 15:
            noise_ids.append(lbl)
            continue

        valid_ids.append(lbl)

    if not noise_ids or len(valid_ids) < 3:
        return pixel_labels

    # Build valid centroid array for distance computation
    valid_centroids = {}
    for v in valid_ids:
        if v < len(color_centroids) and color_centroids[v] is not None:
            valid_centroids[v] = np.array(color_centroids[v], dtype=np.float32)

    if not valid_centroids:
        return pixel_labels

    # Reassign noise pixels to nearest valid cluster (by pixel color)
    h, w = pixel_labels.shape
    img_rgb = filtered_image[:, :, ::-1].astype(np.float32)  # BGR -> RGB float

    # Create mask of noise pixels
    noise_mask = np.zeros((h, w), dtype=bool)
    for n in noise_ids:
        noise_mask |= pixel_labels == n

    # For each noise pixel, find nearest valid cluster by RGB distance to centroid
    if np.any(noise_mask):
        noise_y, noise_x = np.where(noise_mask)
        noise_colors = img_rgb[noise_y, noise_x]  # shape (N, 3)

        # Build centroid matrix
        v_labels = sorted(valid_centroids.keys())
        v_centers = np.array([valid_centroids[v] for v in v_labels], dtype=np.float32)  # (K, 3)

        # Compute distances: (N, 1, 3) - (1, K, 3) -> (N, K)
        dists = np.sum((noise_colors[:, None, :] - v_centers[None, :, :]) ** 2, axis=2)
        best_idx = np.argmin(dists, axis=1)
        best_labels = np.array([v_labels[i] for i in best_idx], dtype=np.uint8)

        pixel_labels[noise_y, noise_x] = best_labels

        reassigned = len(noise_y)
        print(f"  [Noise] Auto-excluded {len(noise_ids)} noise cluster(s) ({reassigned} px reassigned)")
        for nl in noise_ids:
            c = color_centroids[nl] if nl < len(color_centroids) else None
            cnt = counts.get(nl, 0)
            print(
                f"    excluded {nl}: RGB({c[0] if c else '?'},{c[1] if c else '?'},{c[2] if c else '?'}) "
                f"{cnt}px ({cnt / country_size * 100:.1f}%)"
            )

    return pixel_labels


def _morph_clean_labels(
    pixel_labels: np.ndarray,
    country_mask: np.ndarray,
) -> np.ndarray:
    """Morphological opening on each cluster mask to remove thin text strokes.
    Erode then dilate each cluster's binary mask — thin features (text, symbols)
    disappear while solid regions survive. Orphaned pixels get reassigned to
    the most common neighboring label."""
    h, w = pixel_labels.shape
    result = pixel_labels.copy()
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    total_orphaned = 0

    for lbl in active_labels:
        mask = (pixel_labels == lbl).astype(np.uint8) * 255
        opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        # Pixels that were in this cluster but removed by opening = thin features
        removed = (mask > 0) & (opened == 0)
        count = int(np.sum(removed))
        if count > 0:
            result[removed] = 255  # mark as unassigned
            total_orphaned += count

    if total_orphaned == 0:
        return result

    # Reassign orphaned pixels to most common neighbor (4-connected)
    orphaned = (result == 255) & (country_mask > 0)
    oy, ox = np.where(orphaned)
    for y, x in zip(oy, ox, strict=False):
        neighbors = []
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and result[ny, nx] != 255:
                neighbors.append(result[ny, nx])
        if neighbors:
            result[y, x] = max(set(neighbors), key=neighbors.count)

    print(f"  [MorphClean] Removed {total_orphaned} thin-feature pixels via morphological opening")
    return result


def _exclude_edge_decorations(
    pixel_labels: np.ndarray,
    country_mask: np.ndarray,
    border_px: int = 30,
    max_decoration_pct: float = 3.0,
) -> np.ndarray:
    """Exclude clusters that primarily exist near image edges — likely decorations
    (title boxes, scale bars, compass roses, legends).

    A cluster is an edge decoration if >70% of its pixels are within border_px
    of the image edge AND it's < max_decoration_pct of the country area."""
    h, w = pixel_labels.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    # Create edge zone mask
    edge_zone = np.zeros((h, w), dtype=bool)
    edge_zone[:border_px, :] = True
    edge_zone[-border_px:, :] = True
    edge_zone[:, :border_px] = True
    edge_zone[:, -border_px:] = True

    result = pixel_labels.copy()
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    excluded = []

    for lbl in active_labels:
        mask = pixel_labels == lbl
        total = int(np.sum(mask))
        if total == 0:
            continue
        pct = total / country_size * 100
        edge_count = int(np.sum(mask & edge_zone))
        edge_ratio = edge_count / total

        # Edge decoration: >70% near edges AND small
        if edge_ratio > 0.7 and pct < max_decoration_pct:
            result[mask] = 255
            excluded.append((lbl, total, pct, edge_ratio))

    if excluded:
        # Reassign excluded pixels to nearest neighbor
        orphaned = (result == 255) & (country_mask > 0)
        if np.any(orphaned):
            oy, ox = np.where(orphaned)
            for y, x in zip(oy, ox, strict=False):
                neighbors = []
                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and result[ny, nx] != 255:
                        neighbors.append(result[ny, nx])
                if neighbors:
                    result[y, x] = max(set(neighbors), key=neighbors.count)

        total_px = sum(e[1] for e in excluded)
        print(f"  [EdgeDecor] Excluded {len(excluded)} edge decoration cluster(s) ({total_px} px)")
        for lbl, cnt, pct, ratio in excluded:
            print(f"    cluster {lbl}: {cnt}px ({pct:.1f}%), {ratio:.0%} near edge")

    return result


def _remove_small_isolated_ccs(
    pixel_labels: np.ndarray,
    country_mask: np.ndarray,
    filtered_image: np.ndarray,
    min_cc_pct: float = 0.5,
) -> np.ndarray:
    """Remove small isolated connected components from the country mask.
    Tiny CCs (< min_cc_pct of country) that are not connected to the main
    landmass are likely artifacts (small islands, dots, title elements).

    Also removes medium CCs (0.5-2%) that are isolated + compact + uniform
    (likely compass dots, scale bar fragments, city markers)."""
    h, w = pixel_labels.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    # Find CCs of the country mask
    cm_binary = (country_mask > 0).astype(np.uint8) * 255
    num_cc, cc_labels, cc_stats, cc_centroids = cv2.connectedComponentsWithStats(cm_binary)

    # Find the largest CC (main landmass) and build protected set
    cc_sizes = [(i, int(cc_stats[i, cv2.CC_STAT_AREA])) for i in range(1, num_cc)]
    cc_sizes.sort(key=lambda x: -x[1])
    main_cc = cc_sizes[0][0] if cc_sizes else 0

    # Protect CCs connected to main landmass
    main_mask = (cc_labels == main_cc).astype(np.uint8)
    main_dilated = cv2.dilate(main_mask, np.ones((5, 5), np.uint8))

    min_size = max(20, int(country_size * min_cc_pct / 100))
    removed = 0
    result = pixel_labels.copy()

    for i in range(1, num_cc):
        if i == main_cc:
            continue
        area = int(cc_stats[i, cv2.CC_STAT_AREA])
        pct = area / country_size * 100

        # Tiny CCs: always remove
        if area < min_size:
            result[cc_labels == i] = 255
            removed += area
            continue

        # Medium CCs (0.5-2%): check if compact + uniform + isolated
        # STRICT thresholds: real islands (Jeju=0.68 fill) must survive.
        # Only catch very geometric shapes (circles=0.78, rectangles=0.80+).
        if pct <= 2.0:
            # Check adjacency to main landmass
            cc_mask_i = (cc_labels == i).astype(np.uint8)
            touches_main = np.any(cv2.dilate(cc_mask_i, np.ones((3, 3), np.uint8)) & main_dilated)
            if touches_main:
                continue  # Connected to mainland — real feature

            # Check compactness (fill ratio)
            cc_w_val = int(cc_stats[i, cv2.CC_STAT_WIDTH])
            cc_h_val = int(cc_stats[i, cv2.CC_STAT_HEIGHT])
            bbox_area = cc_w_val * cc_h_val
            fill = area / bbox_area if bbox_area > 0 else 0
            if fill < 0.72:
                continue  # Irregular enough to be a real island

            # Check color uniformity
            cc_pixels = filtered_image[cc_labels == i]
            if len(cc_pixels) > 0:
                color_std = np.std(cc_pixels.astype(np.float32), axis=0).mean()
                if color_std > 12:
                    continue  # Varied colors — real feature

            result[cc_labels == i] = 255
            removed += area
            cx, cy = cc_centroids[i]
            print(f"  [SmallCC] Removed medium CC: {area}px ({pct:.1f}%), pos=({cx:.0f},{cy:.0f}), fill={fill:.2f}")

    if removed > 0:
        print(f"  [SmallCC] Removed {removed} pixels in small/medium isolated CCs")

    return result


def _exclude_edge_decoration_ccs(
    pixel_labels: np.ndarray,
    country_mask: np.ndarray,
    edge_pct: float = 0.25,
) -> np.ndarray:
    """Per-cluster CC-level decoration detection.

    For each cluster, finds connected components. CCs that are:
    1. Near any image edge (centroid within edge_pct)
    2. Compact shape (bbox fill ratio > 0.55)
    3. Small relative to cluster (< 50% of cluster total)
    4. Small relative to country (< 5%)
    → are excluded as decoration elements (title box fragments, compass, scale bar).

    This catches decorations that share a cluster color with real regions
    (e.g., teal title box + teal coastal region in the same cluster).
    """
    h, w = pixel_labels.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    bx = int(w * edge_pct)
    by = int(h * edge_pct)

    result = pixel_labels.copy()
    total_excluded = 0
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]

    for lbl in active_labels:
        cluster_mask = (pixel_labels == lbl).astype(np.uint8)
        cluster_total = int(np.sum(cluster_mask))
        if cluster_total == 0:
            continue

        num_cc, cc_labels, cc_stats, cc_centroids = cv2.connectedComponentsWithStats(cluster_mask)
        if num_cc <= 2:
            continue  # single CC, nothing to separate

        for i in range(1, num_cc):
            area = int(cc_stats[i, cv2.CC_STAT_AREA])
            pct_country = area / country_size * 100
            pct_cluster = area / cluster_total * 100

            if pct_country > 5.0:
                continue  # too large relative to country

            # Very small CCs (<1.5% of country) near edges can be excluded
            # even if they dominate their cluster (compass as its own cluster).
            # Perfect rectangles (fill > 0.85) up to 3% can also be excluded
            # (title boxes, scale bar containers).
            # Larger CCs need the cluster dominance check.
            if pct_country > 1.5 and pct_cluster > 50.0:
                # Allow rectangular CCs up to 3% through (title boxes)
                cc_w_chk = int(cc_stats[i, cv2.CC_STAT_WIDTH])
                cc_h_chk = int(cc_stats[i, cv2.CC_STAT_HEIGHT])
                bbox_chk = cc_w_chk * cc_h_chk
                fill_chk = area / bbox_chk if bbox_chk > 0 else 0
                if not (pct_country <= 3.0 and fill_chk > 0.85):
                    continue  # dominant in cluster and not rectangular

            cx, cy = cc_centroids[i]
            near_edge = cx < bx or cx > w - bx or cy < by or cy > h - by
            if not near_edge:
                continue

            # Check compactness (fill ratio)
            cc_w = int(cc_stats[i, cv2.CC_STAT_WIDTH])
            cc_h_val = int(cc_stats[i, cv2.CC_STAT_HEIGHT])
            bbox_area = cc_w * cc_h_val
            fill = area / bbox_area if bbox_area > 0 else 0

            # Relaxed fill for very small edge CCs (<1% country):
            # compass+text combos have fill ~0.35-0.50 due to irregular text shape
            fill_threshold = 0.35 if pct_country < 1.0 else 0.55
            if fill < fill_threshold:
                continue  # too irregular — likely a real island fragment

            # Exclude this CC
            result[cc_labels == i] = 255
            total_excluded += area

    if total_excluded > 0:
        # Reassign excluded pixels to nearest valid neighbor
        orphaned = (result == 255) & (country_mask > 0)
        if np.any(orphaned):
            oy, ox = np.where(orphaned)
            for y, x in zip(oy, ox, strict=False):
                neighbors = []
                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and result[ny, nx] != 255:
                        neighbors.append(result[ny, nx])
                if neighbors:
                    result[y, x] = max(set(neighbors), key=neighbors.count)

        print(f"  [EdgeDecoCC] Excluded {total_excluded} px in per-cluster edge decoration CCs")

    return result


def _exclude_straight_edged_clusters(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    filtered_image: np.ndarray,
    country_mask: np.ndarray,
    edge_pct: float = 0.25,
) -> np.ndarray:
    """Exclude cluster CCs whose boundary is approximately rectangular.

    Real geographic regions have irregular coastline boundaries.
    Title boxes, compass roses, and scale bars have straight-edged boundaries.
    Uses contour approximation: if approxPolyDP reduces the contour to
    very few vertices (≤8), the shape has straight edges = artificial.
    """
    h, w = pixel_labels.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    bx = int(w * edge_pct)
    by = int(h * edge_pct)

    result = pixel_labels.copy()
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    excluded = []

    for lbl in active_labels:
        mask = (pixel_labels == lbl).astype(np.uint8)
        total = int(np.sum(mask))
        if total == 0:
            continue
        pct = total / country_size * 100
        if pct > 5.0 or pct < 0.3:
            continue

        # Find CCs of this cluster
        num_cc, cc_labels, cc_stats, cc_centroids = cv2.connectedComponentsWithStats(mask)
        for ci in range(1, num_cc):
            area = int(cc_stats[ci, cv2.CC_STAT_AREA])
            ci_pct = area / country_size * 100
            if ci_pct > 5.0 or ci_pct < 0.1:
                continue

            cx, cy = cc_centroids[ci]
            near_edge = cx < bx or cx > w - bx or cy < by or cy > h - by
            if not near_edge:
                continue

            # Get contour and approximate it
            cc_mask = (cc_labels == ci).astype(np.uint8) * 255
            contours, _ = cv2.findContours(cc_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue

            contour = max(contours, key=cv2.contourArea)
            perimeter = cv2.arcLength(contour, True)
            if perimeter < 20:
                continue

            # Approximate contour with fewer vertices
            # epsilon = 2% of perimeter — loose approximation
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            n_vertices = len(approx)

            # Straight-edged shapes: ≤ 6 vertices (rectangle=4, pentagon=5, hexagon=6)
            # Natural coastlines: >> 10 vertices even with loose approximation
            if n_vertices > 6:
                continue

            # Additional check: color uniformity (solid fill)
            cc_pixels = filtered_image[cc_labels == ci]
            if len(cc_pixels) > 0:
                std = np.std(cc_pixels.astype(np.float32), axis=0).mean()
                if std > 15:
                    continue  # Varied colors — real feature

            # This CC has straight edges, near edge, uniform color → decoration
            result[cc_labels == ci] = 255
            excluded.append((lbl, area, ci_pct, n_vertices))

    if excluded:
        orphaned = (result == 255) & (country_mask > 0)
        if np.any(orphaned):
            oy, ox = np.where(orphaned)
            for y, x in zip(oy, ox, strict=False):
                neighbors = []
                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and result[ny, nx] != 255:
                        neighbors.append(result[ny, nx])
                if neighbors:
                    result[y, x] = max(set(neighbors), key=neighbors.count)

        total_px = sum(e[1] for e in excluded)
        print(f"  [StraightEdge] Excluded {len(excluded)} straight-edged CCs ({total_px} px)")
        for lbl, cnt, pct, nv in excluded:
            print(f"    cluster {lbl}: {cnt}px ({pct:.1f}%), {nv} vertices")

    return result


def _exclude_rectangular_edge_clusters(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    filtered_image: np.ndarray,
    country_mask: np.ndarray,
    edge_pct: float = 0.25,
) -> np.ndarray:
    """Exclude clusters that form compact rectangles near image edges.

    Unlike _exclude_edge_decorations (which checks % of pixels near border),
    this checks the SHAPE of each cluster's main body. A cluster is excluded if:
    1. Its centroid is within edge_pct of any image edge
    2. Its bounding box fill ratio > 0.55 (compact/rectangular)
    3. It has low color variance (std < 15, uniform color)
    4. It's small (< 5% of country)

    This catches title box clusters that extend 50-100px from edges —
    too far for the 30px border check but still clearly decorations.
    """
    h, w = pixel_labels.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    bx = int(w * edge_pct)
    by = int(h * edge_pct)

    result = pixel_labels.copy()
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    excluded = []

    for lbl in active_labels:
        mask = pixel_labels == lbl
        total = int(np.sum(mask))
        if total == 0:
            continue
        pct = total / country_size * 100
        if pct > 5.0 or pct < 0.3:
            continue

        # Find bounding box and centroid of this cluster
        ys, xs = np.where(mask)
        cx = xs.mean()
        cy = ys.mean()

        near_edge = cx < bx or cx > w - bx or cy < by or cy > h - by
        if not near_edge:
            continue

        # Check shape: bounding box fill ratio
        min_x, max_x = int(xs.min()), int(xs.max())
        min_y, max_y = int(ys.min()), int(ys.max())
        bbox_w = max_x - min_x + 1
        bbox_h = max_y - min_y + 1
        bbox_area = bbox_w * bbox_h
        fill = total / bbox_area if bbox_area > 0 else 0

        if fill < 0.65:
            continue  # Not rectangular enough — likely a real island

        # Check color uniformity
        if lbl < len(color_centroids) and color_centroids[lbl] is not None:
            cluster_pixels = filtered_image[mask]
            color_std = np.std(cluster_pixels.astype(np.float32), axis=0).mean()
            if color_std > 12:
                continue  # Varied colors — real region

        # This cluster is rectangular, uniform, near edge, small → decoration
        result[mask] = 255
        excluded.append((lbl, total, pct, fill))

    if excluded:
        # Reassign excluded pixels to nearest valid neighbor
        orphaned = (result == 255) & (country_mask > 0)
        if np.any(orphaned):
            oy, ox = np.where(orphaned)
            for y, x in zip(oy, ox, strict=False):
                neighbors = []
                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and result[ny, nx] != 255:
                        neighbors.append(result[ny, nx])
                if neighbors:
                    result[y, x] = max(set(neighbors), key=neighbors.count)

        total_px = sum(e[1] for e in excluded)
        print(f"  [RectEdge] Excluded {len(excluded)} rectangular edge cluster(s) ({total_px} px)")
        for lbl, cnt, pct, fill in excluded:
            c = color_centroids[lbl] if lbl < len(color_centroids) else None
            c_str = f"RGB({c[0]},{c[1]},{c[2]})" if c else "?"
            print(f"    cluster {lbl}: {c_str} {cnt}px ({pct:.1f}%), fill={fill:.2f}")

    return result


def _remove_tiny_fragments(
    pixel_labels: np.ndarray,
    country_mask: np.ndarray,
    max_fragment_px: int = 100,
) -> np.ndarray:
    """Remove tiny cluster fragments — CCs smaller than max_fragment_px that
    are not the main body of their cluster. Reassign to most common neighbor.

    This is the final sweep to catch city dots, compass fragments, and other
    tiny decoration remnants that survived all previous cleanup steps."""
    h, w = pixel_labels.shape
    result = pixel_labels.copy()
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    total_removed = 0

    for lbl in active_labels:
        cluster_mask = (pixel_labels == lbl).astype(np.uint8)
        num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(cluster_mask)
        if num_cc <= 2:
            continue  # Single CC, nothing to clean

        # Find the largest CC (main body)
        main_cc = max(range(1, num_cc), key=lambda i: int(cc_stats[i, cv2.CC_STAT_AREA]))

        for ci in range(1, num_cc):
            if ci == main_cc:
                continue
            area = int(cc_stats[ci, cv2.CC_STAT_AREA])
            if area >= max_fragment_px:
                continue

            # Reassign to most common neighbor
            cc_mask = cc_labels == ci
            dilated = cv2.dilate(cc_mask.astype(np.uint8), np.ones((3, 3), np.uint8))
            border = (dilated > 0) & ~cc_mask
            neighbor_labels = result[border]
            neighbor_labels = neighbor_labels[(neighbor_labels != 255) & (neighbor_labels != lbl)]
            if len(neighbor_labels) > 0:
                unique_nbrs, nbr_counts = np.unique(neighbor_labels, return_counts=True)
                best_nbr = int(unique_nbrs[np.argmax(nbr_counts)])
                result[cc_mask] = best_nbr
                total_removed += area

    if total_removed > 0:
        print(f"  [TinyFrag] Removed {total_removed} px in tiny cluster fragments (< {max_fragment_px}px)")

    return result


def _merge_fragmented_clusters(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    country_mask: np.ndarray,
    min_fragmentation_ratio: float = 1.0,  # parts / area_pct
    min_parts: int = 4,
    max_area_pct: float = 0.10,
    max_rgb_dist: float = 40.0,
) -> np.ndarray:
    """Merge whole small+highly-fragmented clusters into color-close large neighbors.

    Target: residue clusters that represent roads/decorations (many scattered parts
    along a linear feature) OR multi-location text (letters spread across a region).

    A cluster qualifies as "fragmented residue" when its disconnected-part count
    divided by its area percentage exceeds `min_fragmentation_ratio`. Example: an
    8-part cluster at 5.3% of country → 8/5.3 = 1.5, flagged as residue. A real
    province with 1-3 parts at 5% gives 0.2-0.6, preserved.

    Merge only if a color-close (RGB dist ≤ max_rgb_dist) larger cluster exists
    that's spatially adjacent.
    """
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    result = pixel_labels.copy()
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    total_merged = 0

    # Count parts + area per cluster
    cluster_stats: dict[int, tuple[int, int]] = {}  # label -> (area, num_parts)
    for lbl in active_labels:
        cluster_mask = (pixel_labels == lbl).astype(np.uint8)
        area = int(cluster_mask.sum())
        if area == 0:
            continue
        num_cc, _, _, _ = cv2.connectedComponentsWithStats(cluster_mask)
        cluster_stats[lbl] = (area, num_cc - 1)  # -1 for background CC

    for lbl, (area, num_parts) in cluster_stats.items():
        area_pct = (area / country_size) * 100
        if area_pct > max_area_pct * 100:
            continue  # too large to be residue
        if num_parts < min_parts:
            continue  # not fragmented enough
        frag_ratio = num_parts / max(area_pct, 0.1)
        if frag_ratio < min_fragmentation_ratio:
            continue  # parts-to-area ratio below threshold
        if lbl >= len(color_centroids) or color_centroids[lbl] is None:
            continue
        c_lbl = color_centroids[lbl]

        # Find a color-close, larger, spatially-adjacent target
        best_target = -1
        best_dist = float("inf")
        for other_lbl, (other_area, _) in cluster_stats.items():
            if other_lbl == lbl or other_area <= area:
                continue
            if other_lbl >= len(color_centroids) or color_centroids[other_lbl] is None:
                continue
            c_other = color_centroids[other_lbl]
            rgb_dist = (
                (c_lbl[0] - c_other[0]) ** 2 + (c_lbl[1] - c_other[1]) ** 2 + (c_lbl[2] - c_other[2]) ** 2
            ) ** 0.5
            if rgb_dist > max_rgb_dist:
                continue
            if not _are_spatially_adjacent(result, lbl, other_lbl):
                continue
            if rgb_dist < best_dist:
                best_dist = rgb_dist
                best_target = other_lbl

        if best_target >= 0:
            print(
                f"  [FragMerge] cluster {lbl} ({area_pct:.1f}%, {num_parts} parts, frag={frag_ratio:.1f}) → {best_target} (RGB dist={best_dist:.1f})"
            )
            result[pixel_labels == lbl] = best_target
            total_merged += area

    if total_merged > 0:
        print(f"  [FragMerge] Merged {total_merged} px in fragmented-residue clusters")

    return result


def _merge_color_close_fragments(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    country_mask: np.ndarray,
    max_cc_pct: float = 0.01,
    max_rgb_dist: float = 25.0,
) -> np.ndarray:
    """Merge small cluster CCs into a color-close neighbor cluster.

    Targets residue clusters whose centroid is very near another cluster's
    centroid (e.g., tan-on-tan text/road residue that survives by having a
    distinct label but nearly identical color). Legitimate sub-regions have
    centroids that are color-distinct from their parent region's dominant
    neighbors.

    Key difference from merge_tiny_clusters: that function compares a whole
    small cluster's centroid to its neighbors. This one operates on per-CC
    spatial context — a small CC of cluster L merges only if its SPATIAL
    neighbor has a color-close centroid.
    """
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    result = pixel_labels.copy()
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    max_area = max(100, int(country_size * max_cc_pct))
    total_merged = 0

    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))

    for lbl in active_labels:
        if lbl >= len(color_centroids) or color_centroids[lbl] is None:
            continue
        c_lbl = color_centroids[lbl]

        cluster_mask = (pixel_labels == lbl).astype(np.uint8)
        num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(cluster_mask)
        if num_cc <= 1:
            continue

        for ci in range(1, num_cc):
            area = int(cc_stats[ci, cv2.CC_STAT_AREA])
            if area < 50 or area > max_area:
                continue

            cc_mask = cc_labels == ci
            dilated = cv2.dilate(cc_mask.astype(np.uint8), ring_kernel)
            border = (dilated > 0) & ~cc_mask
            neighbor_labels = result[border]
            neighbor_labels = neighbor_labels[(neighbor_labels != 255) & (neighbor_labels != lbl)]
            if len(neighbor_labels) == 0:
                continue

            unique_nbrs, nbr_counts = np.unique(neighbor_labels, return_counts=True)
            # Try neighbors in order of border presence; merge if any has close color
            sorted_idx = np.argsort(-nbr_counts)
            for si in sorted_idx:
                nbr_lbl = int(unique_nbrs[si])
                if nbr_lbl >= len(color_centroids) or color_centroids[nbr_lbl] is None:
                    continue
                c_nbr = color_centroids[nbr_lbl]
                rgb_dist = ((c_lbl[0] - c_nbr[0]) ** 2 + (c_lbl[1] - c_nbr[1]) ** 2 + (c_lbl[2] - c_nbr[2]) ** 2) ** 0.5
                if rgb_dist <= max_rgb_dist:
                    result[cc_mask] = nbr_lbl
                    total_merged += area
                    break
                # else: neighbor color too different — try next neighbor

    if total_merged > 0:
        print(
            f"  [ColorCloseMerge] Merged {total_merged} px in color-close CCs (max_area={max_area}, rgb_dist≤{max_rgb_dist})"
        )

    return result


def _remove_color_outlier_ccs(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    country_mask: np.ndarray,
    country_size: int,
    max_pct: float = 1.5,
    min_color_dist: float = 35.0,
) -> np.ndarray:
    """Remove small isolated CCs whose color is an outlier relative to neighbors.

    For each cluster, find small CCs (< max_pct of country). For each such CC,
    check the colors of neighboring clusters within a small dilation zone.
    If the CC's cluster color has RGB distance > min_color_dist from ALL
    neighboring cluster colors, it's a "color outlier" — likely a decoration
    remnant (city dot, compass fragment, marker trace).

    Replace outlier CC pixels with the most common neighboring cluster label.
    """
    h, w = pixel_labels.shape
    if country_size == 0:
        return pixel_labels

    result = pixel_labels.copy()
    active_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    total_removed = 0

    for lbl in active_labels:
        if lbl >= len(color_centroids) or color_centroids[lbl] is None:
            continue
        c = np.array(color_centroids[lbl], dtype=np.float32)

        cluster_mask = (pixel_labels == lbl).astype(np.uint8)
        cluster_total = int(np.sum(cluster_mask))
        if cluster_total == 0:
            continue

        # Find CCs of this cluster
        num_cc, cc_labels, cc_stats, _ = cv2.connectedComponentsWithStats(cluster_mask)
        if num_cc <= 1:
            continue

        for ci in range(1, num_cc):
            area = int(cc_stats[ci, cv2.CC_STAT_AREA])
            pct = area / country_size * 100
            if pct > max_pct or area < 5:
                continue

            # Skip if this CC is the main body of the cluster (> 50% of cluster)
            if area > cluster_total * 0.5:
                continue

            # Get neighboring clusters by dilating this CC
            cc_mask = (cc_labels == ci).astype(np.uint8)
            dilated = cv2.dilate(cc_mask, np.ones((7, 7), np.uint8))
            border = (dilated > 0) & (cc_mask == 0) & (country_mask > 0)

            neighbor_labels = result[border]
            neighbor_labels = neighbor_labels[(neighbor_labels != 255) & (neighbor_labels != lbl)]

            if len(neighbor_labels) == 0:
                continue

            unique_nbrs = np.unique(neighbor_labels)

            # Check if this CC's color is an outlier: far from ALL neighbors
            is_outlier = True
            for nbr in unique_nbrs:
                if nbr >= len(color_centroids) or color_centroids[nbr] is None:
                    continue
                nc = np.array(color_centroids[nbr], dtype=np.float32)
                dist = np.sqrt(np.sum((c - nc) ** 2))
                if dist < min_color_dist:
                    is_outlier = False
                    break

            if is_outlier:
                # Replace with most common neighbor
                nbr_counts = np.unique(neighbor_labels, return_counts=True)
                best_nbr = int(nbr_counts[0][np.argmax(nbr_counts[1])])
                result[cc_labels == ci] = best_nbr
                total_removed += area

    if total_removed > 0:
        print(f"  [ColorOutlier] Removed {total_removed} px in color-outlier CCs (dist > {min_color_dist})")

    return result


def _remove_circular_edge_elements(
    pixel_labels: np.ndarray,
    country_mask: np.ndarray,
    filtered_image: np.ndarray,
    edge_pct: float = 0.25,
    min_radius: int = 6,
    max_radius: int = 25,
    min_circularity: float = 0.65,
) -> np.ndarray:
    """Detect and remove circular elements near edges (compass roses, dots).

    Uses contour analysis with circularity metric (4π*area/perimeter²).
    Perfect circles have circularity=1.0, irregular shapes << 1.0.
    Only targets small, circular, near-edge contours that are isolated.
    """
    h, w = pixel_labels.shape
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    bx = int(w * edge_pct)
    by = int(h * edge_pct)

    # Find contours in the grayscale filtered image (edges of features)
    gray = cv2.cvtColor(filtered_image, cv2.COLOR_BGR2GRAY)
    # Use adaptive threshold to find distinct features
    blurred = cv2.GaussianBlur(gray, (5, 5), 1)
    edges = cv2.Canny(blurred, 30, 80)
    # Close gaps in contours
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    result = pixel_labels.copy()
    total_removed = 0

    for contour in contours:
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0 or area < np.pi * min_radius**2:
            continue

        # Circularity check
        circularity = 4 * np.pi * area / (perimeter * perimeter)
        if circularity < min_circularity:
            continue

        # Size check (equivalent radius)
        radius = np.sqrt(area / np.pi)
        if radius < min_radius or radius > max_radius:
            continue

        # Position check (near edge)
        M = cv2.moments(contour)
        if M["m00"] == 0:
            continue
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
        near_edge = cx < bx or cx > w - bx or cy < by or cy > h - by
        if not near_edge:
            continue

        # Check this contour is within the country mask
        contour_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(contour_mask, [contour], -1, 255, -1)
        overlap = np.sum((contour_mask > 0) & (country_mask > 0))
        if overlap < area * 0.5:
            continue  # Mostly outside country

        # Check it's small relative to country
        pct = overlap / country_size * 100
        if pct > 2.0:
            continue

        # Exclude: set pixels inside contour to background
        inside = (contour_mask > 0) & (country_mask > 0)
        result[inside] = 255
        total_removed += int(np.sum(inside))

    if total_removed > 0:
        # Reassign removed pixels to nearest neighbor
        orphaned = (result == 255) & (country_mask > 0)
        oy, ox = np.where(orphaned)
        for y, x in zip(oy, ox, strict=False):
            neighbors = []
            for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and result[ny, nx] != 255:
                    neighbors.append(result[ny, nx])
            if neighbors:
                result[y, x] = max(set(neighbors), key=neighbors.count)
        print(f"  [CircularEdge] Removed {total_removed} px in circular edge elements")

    return result


def run_cleanup(
    pixel_labels: np.ndarray,
    color_centroids: list[list[int]],
    filtered_image: np.ndarray,
    country_mask: np.ndarray,
) -> np.ndarray:
    """Run the full cleanup pipeline on clustered pixel labels.

    Steps (in order):
    1. Remove small isolated CCs from country mask
    2. Merge tiny clusters into nearest large neighbor
    3. Remove small isolated patches
    4. Morphological opening to clean thin text strokes
    5. Exclude edge decoration clusters (title boxes, scale bars)
    6. Exclude noise clusters (desaturated/dark/tiny)

    Returns the cleaned pixel_labels (modified in place).
    """
    country_size = int(np.sum(country_mask > 0))
    if country_size == 0:
        return pixel_labels

    print("  [Cleanup] Starting cluster cleanup pipeline...")

    # Step 0: Remove small isolated CCs (tiny islands, dots, title fragments)
    pixel_labels = _remove_small_isolated_ccs(pixel_labels, country_mask, filtered_image)

    # Step 1: Merge tiny clusters
    pixel_labels = merge_tiny_clusters(pixel_labels, color_centroids, country_size)

    # Step 1b: Merge highly-fragmented clusters (residue from roads / scattered text)
    # into color-close larger neighbors. A real province has 1-3 parts; a road or
    # text-residue cluster typically has 6+ scattered parts.
    pixel_labels = _merge_fragmented_clusters(
        pixel_labels,
        color_centroids,
        country_mask,
        min_fragmentation_ratio=1.0,
        min_parts=4,
        max_area_pct=0.10,
        max_rgb_dist=40.0,
    )

    # Step 2: Remove small patches
    pixel_labels = remove_small_patches(pixel_labels, country_size)

    # Step 3: Morphological opening per cluster to remove thin text strokes
    pixel_labels = _morph_clean_labels(pixel_labels, country_mask)

    # Step 4: Exclude edge decoration clusters (title boxes, scale bars, compass)
    pixel_labels = _exclude_edge_decorations(pixel_labels, country_mask)

    # Step 4b: Per-cluster CC decoration detection (catches title boxes
    # that share a cluster color with real regions)
    pixel_labels = _exclude_edge_decoration_ccs(pixel_labels, country_mask)

    # Step 4c: Rectangular edge cluster detection (catches title boxes
    # that form their own cluster — shape + uniformity based, not border distance)
    pixel_labels = _exclude_rectangular_edge_clusters(pixel_labels, color_centroids, filtered_image, country_mask)

    # Step 4d: Straight-edge detection (catches decorations by boundary shape —
    # title boxes/compass/scale have straight edges, real regions have coastlines)
    pixel_labels = _exclude_straight_edged_clusters(pixel_labels, color_centroids, filtered_image, country_mask)

    # Step 5: Exclude noise clusters
    pixel_labels = exclude_noise_clusters(pixel_labels, color_centroids, filtered_image, country_size)

    # Step 5e: Circular edge element detection — find circular contours
    # near edges (compass roses, dots) using contour circularity metric
    pixel_labels = _remove_circular_edge_elements(pixel_labels, country_mask, filtered_image)

    # Step 6: Color outlier removal — find small isolated CCs whose color
    # is very different from ALL neighboring clusters. These are likely
    # decoration remnants (city dots, compass fragments, marker traces).
    pixel_labels = _remove_color_outlier_ccs(pixel_labels, color_centroids, country_mask, country_size)

    # Step 7: Second pass of small patch removal — after all decoration exclusion
    # and noise removal, some patches that were connected are now isolated
    pixel_labels = remove_small_patches(pixel_labels, country_size)

    # Step 8: Final small-fragment removal — any cluster CC < 300px that is
    # not the cluster's main body gets reassigned to its most common neighbor.
    pixel_labels = _remove_tiny_fragments(pixel_labels, country_mask, max_fragment_px=300)

    # Step 8c: Merge small CCs into color-close spatial neighbors (< 1% of country,
    # RGB dist ≤ 25). Catches tan-on-tan residue clusters that survive as distinct
    # labels only because K-means quantization separated nearly-identical colors.
    pixel_labels = _merge_color_close_fragments(
        pixel_labels, color_centroids, country_mask, max_cc_pct=0.01, max_rgb_dist=25.0
    )

    # Step 9: Final spatial smoothing — three passes (escalating radius) to absorb
    # remaining isolated dots, text remnants, and decoration fragments. The third
    # pass at radius=18 is specifically sized to absorb text label letters
    # (typically 30-40 px tall after the Lanczos resize); the 60% majority gate in
    # spatial_mode_filter protects legitimate pinch points from being reassigned.
    from .cluster import spatial_mode_filter

    pixel_labels = spatial_mode_filter(pixel_labels, country_mask, radius=5)
    pixel_labels = spatial_mode_filter(pixel_labels, country_mask, radius=10)
    pixel_labels = spatial_mode_filter(pixel_labels, country_mask, radius=18)

    # Report final state
    final_counts = _cluster_counts(pixel_labels)
    print(f"  [Cleanup] Final: {len(final_counts)} clusters")
    for lbl in sorted(final_counts.keys()):
        cnt = final_counts[lbl]
        c = color_centroids[lbl] if lbl < len(color_centroids) else None
        c_str = f"RGB({c[0]},{c[1]},{c[2]})" if c else "RGB(?)"
        print(f"    cluster {lbl}: {c_str} {cnt}px ({cnt / country_size * 100:.1f}%)")

    return pixel_labels
