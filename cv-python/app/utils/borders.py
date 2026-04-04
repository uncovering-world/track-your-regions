import cv2
import numpy as np


def extract_contour_paths(
    pixel_labels: np.ndarray,
    min_contour_points: int = 10,
    simplify_epsilon: float = 1.5,
) -> list[dict]:
    """Extract border paths from pixel labels using cv2.findContours.
    Returns list of BorderPath-compatible dicts."""
    unique_labels = [int(l) for l in np.unique(pixel_labels) if l != 255]
    paths = []
    next_id = 0

    for label in unique_labels:
        mask = (pixel_labels == label).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

        for contour in contours:
            if len(contour) < 4:
                continue

            simplified = cv2.approxPolyDP(contour, simplify_epsilon, closed=True)
            points = simplified.reshape(-1, 2).tolist()

            if len(points) < min_contour_points:
                continue

            # Classify: check what's adjacent
            border_type = "external"
            neighbor_label = 255
            h, w = pixel_labels.shape
            for pt in points[:10]:
                x, y = int(pt[0]), int(pt[1])
                for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        nl = int(pixel_labels[ny, nx])
                        if nl != label and nl != 255:
                            border_type = "internal"
                            neighbor_label = nl
                            break
                if border_type == "internal":
                    break

            cluster_b = neighbor_label if neighbor_label != 255 else 255
            paths.append({
                "id": f"bp-{next_id}",
                "points": [[int(p[0]), int(p[1])] for p in points],
                "type": border_type,
                "clusters": [min(int(label), cluster_b), max(int(label), cluster_b)],
            })
            next_id += 1

    return paths
