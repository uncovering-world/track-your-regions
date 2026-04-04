import json
import numpy as np
from fastapi import APIRouter, File, Form, UploadFile
from ..cv.preprocess import run_phase1
from ..cv.cluster import kmeans_cielab
from ..cv.superpixel import compute_slic
from ..utils.borders import extract_contour_paths
from ..utils.image import decode_image, encode_png_base64, encode_labels_base64

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


@router.post("/phase1")
async def phase1(
    image: UploadFile = File(...),
    params: str = Form(...),
):
    """Phase 1: Preprocess image + detect water."""
    cfg = json.loads(params)
    image_bytes = await image.read()
    img = decode_image(image_bytes)

    result = run_phase1(
        image=img,
        tw=cfg["tw"],
        th=cfg["th"],
        orig_w=cfg["origW"],
        orig_h=cfg["origH"],
    )
    return result


@router.post("/phase2")
async def phase2(
    filteredImage: UploadFile = File(...),
    countryMask: UploadFile = File(...),
    params: str = Form(...),
):
    """Phase 2: K-means clustering + SLIC superpixels."""
    cfg = json.loads(params)
    filtered = decode_image(await filteredImage.read())
    mask_img = decode_image(await countryMask.read())
    mask = mask_img[:, :, 0] if len(mask_img.shape) == 3 else mask_img

    tw = cfg.get("tw", filtered.shape[1])
    th = cfg.get("th", filtered.shape[0])
    n_clusters = cfg.get("numClusters", 12)

    # K-means clustering in CIELAB
    pixel_labels, color_centroids = kmeans_cielab(filtered, mask, n_clusters)

    # SLIC superpixels
    superpixel_labels = compute_slic(filtered, n_segments=300, compactness=10.0)

    # Cluster info
    labels_flat = pixel_labels.flatten()
    total_country = int(np.sum(mask.flatten() > 0))
    cluster_info = []
    for i, centroid in enumerate(color_centroids):
        count = int(np.sum(labels_flat == i))
        pct = round(count / max(total_country, 1) * 100, 1)
        cluster_info.append({
            "label": i,
            "color": f"rgb({centroid[0]},{centroid[1]},{centroid[2]})",
            "pct": pct,
            "isSmall": pct < 3,
            "componentCount": 1,
        })

    # Border paths via contours
    border_paths = extract_contour_paths(pixel_labels)

    # Quantized image (flat cluster colors, no borders)
    quant = np.full((*pixel_labels.shape, 3), 220, dtype=np.uint8)
    for i, c in enumerate(color_centroids):
        quant[pixel_labels == i] = [c[2], c[1], c[0]]  # RGB → BGR for cv2

    return {
        "pixelLabels": encode_labels_base64(pixel_labels.flatten()),
        "colorCentroids": color_centroids,
        "superpixelLabels": encode_labels_base64(superpixel_labels.flatten()),
        "clusterInfo": cluster_info,
        "borderPaths": border_paths,
        "quantizedImage": encode_png_base64(quant),
        "debugImages": [],
        "pipelineSize": {"w": tw, "h": th},
    }
