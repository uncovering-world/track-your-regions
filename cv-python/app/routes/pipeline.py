import json
import queue
import sys
import threading
import traceback
import uuid
from typing import Annotated, Any

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ..cv.cleanup import run_cleanup
from ..cv.cluster import kmeans_cielab
from ..cv.match import run_matching
from ..cv.preprocess import run_phase1
from ..cv.superpixel import compute_slic
from ..utils.borders import extract_contour_paths
from ..utils.image import decode_image, encode_labels_base64, encode_png_base64

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


# =============================================================================
# Generic interactive-review mechanism
# =============================================================================
# Any pipeline worker can pause to ask the operator a question via emit_review.
# The worker thread blocks on a threading.Event until an external caller POSTs
# the decision to /pipeline/respond/{review_id}, at which point the Event is
# set and the worker resumes with the user's payload.

# Default review timeout (seconds). 10 minutes matches the JS review TTL and
# is longer than any realistic reviewing session.
REVIEW_TIMEOUT_SECONDS = 600.0

_pending_reviews: dict[str, tuple[threading.Event, list[Any]]] = {}
_pending_reviews_lock = threading.Lock()


def _make_review_callback(q: queue.Queue):
    """Build a `await_review(kind, data, timeout)` closure bound to this worker's output queue.

    Emits a review-request message over NDJSON, then blocks this worker thread
    on a threading.Event. Returns the decision payload when /pipeline/respond
    is called with the same reviewId (or None on timeout).
    """

    def await_review(kind: str, data: dict[str, Any], timeout: float = REVIEW_TIMEOUT_SECONDS) -> dict[str, Any] | None:
        review_id = f"py-{kind}-{uuid.uuid4().hex[:12]}"
        event = threading.Event()
        slot: list[Any] = [None]
        with _pending_reviews_lock:
            _pending_reviews[review_id] = (event, slot)
        try:
            q.put(
                json.dumps(
                    {
                        "type": "review",
                        "kind": kind,
                        "reviewId": review_id,
                        "data": data,
                    }
                )
                + "\n"
            )
            if not event.wait(timeout=timeout):
                print(f"  [Review] {review_id} timed out after {timeout:.0f}s")
                return None
            return slot[0]
        finally:
            with _pending_reviews_lock:
                _pending_reviews.pop(review_id, None)

    return await_review


@router.post("/respond/{review_id}")
async def respond_to_review(review_id: str, body: dict[str, Any]):
    """Deliver an operator decision to a worker thread blocked on await_review."""
    with _pending_reviews_lock:
        entry = _pending_reviews.get(review_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Unknown or expired review: {review_id}")
    event, slot = entry
    slot[0] = body
    event.set()
    return {"ok": True}


def _ndjson_stream(worker_fn):
    """Run worker_fn in a thread, yielding NDJSON progress / review / result lines.

    worker_fn receives (progress, await_review) callbacks.
      progress(step: str): emit a {"type":"progress","step":...} line.
      await_review(kind, data, timeout=600) -> dict | None: emit a review-request
        line and block until the response arrives via /pipeline/respond/...

    It must return the final result dict.
    Final line is {"type":"result","data":{...}} or {"type":"error",...}.
    """
    q: queue.Queue = queue.Queue()

    def progress(step: str):
        q.put(json.dumps({"type": "progress", "step": step}) + "\n")

    await_review = _make_review_callback(q)

    def run():
        try:
            result = worker_fn(progress, await_review)
            q.put(json.dumps({"type": "result", "data": result}) + "\n")
        except Exception:
            # ASVS V13.4: log the full exception internally, return a generic
            # message to the caller. Stack frames / file paths must not leak.
            traceback.print_exc(file=sys.stderr)
            q.put(json.dumps({"type": "error", "message": "Internal error during processing"}) + "\n")
        finally:
            q.put(None)  # sentinel

    t = threading.Thread(target=run, daemon=True)
    t.start()

    while True:
        item = q.get()
        if item is None:
            break
        yield item


@router.post("/phase1")
async def phase1(
    image: Annotated[UploadFile, File(...)],
    params: Annotated[str, Form(...)],
):
    """Phase 1: Preprocess image + detect water. Streams NDJSON progress."""
    cfg = json.loads(params)
    image_bytes = await image.read()
    img = decode_image(image_bytes)

    def worker(progress, await_review):
        return run_phase1(
            image=img,
            tw=cfg["tw"],
            th=cfg["th"],
            orig_w=cfg["origW"],
            orig_h=cfg["origH"],
            on_progress=progress,
            on_review=await_review,
        )

    return StreamingResponse(
        _ndjson_stream(worker),
        media_type="application/x-ndjson",
    )


@router.post("/phase2")
async def phase2(
    filteredImage: Annotated[UploadFile, File(...)],
    countryMask: Annotated[UploadFile, File(...)],
    params: Annotated[str, Form(...)],
    knownNoiseMask: Annotated[UploadFile | None, File()] = None,
):
    """Phase 2: K-means clustering + SLIC superpixels. Streams NDJSON progress."""
    cfg = json.loads(params)
    filtered = decode_image(await filteredImage.read())
    mask_img = decode_image(await countryMask.read())
    mask = mask_img[:, :, 0] if len(mask_img.shape) == 3 else mask_img

    # Optional noise mask from phase 1 — pixels known to be OCR / road / line
    # residue. K-means excludes them, then they get filled via nearest-label.
    noise_mask = None
    if knownNoiseMask is not None:
        noise_bytes = await knownNoiseMask.read()
        if noise_bytes:
            noise_img = decode_image(noise_bytes)
            noise_mask = noise_img[:, :, 0] if len(noise_img.shape) == 3 else noise_img

    tw = cfg.get("tw", filtered.shape[1])
    th = cfg.get("th", filtered.shape[0])
    n_clusters = cfg.get("numClusters", 12)
    random_seed = int(cfg.get("randomSeed", 0))

    def worker(progress, _await_review):
        progress("K-means clustering in CIELAB...")
        pixel_labels, color_centroids = kmeans_cielab(
            filtered,
            mask,
            n_clusters,
            random_seed,
            known_noise_mask=noise_mask,
        )
        progress("Cluster cleanup (merge tiny, remove patches)...")
        pixel_labels = run_cleanup(pixel_labels, color_centroids, filtered, mask)

        progress("SLIC superpixel segmentation...")
        superpixel_labels = compute_slic(filtered, n_segments=300, compactness=10.0)

        progress("Computing cluster info + border paths...")

        # Cluster info (after cleanup)
        labels_flat = pixel_labels.flatten()
        total_country = int(np.sum(mask.flatten() > 0))
        cluster_info = []
        for i, centroid in enumerate(color_centroids):
            count = int(np.sum(labels_flat == i))
            if count == 0:
                continue
            pct = round(count / max(total_country, 1) * 100, 1)
            cluster_info.append(
                {
                    "label": i,
                    "color": f"rgb({centroid[0]},{centroid[1]},{centroid[2]})",
                    "pct": pct,
                    "isSmall": pct < 3,
                    "componentCount": 1,
                }
            )

        border_paths = extract_contour_paths(pixel_labels)

        progress("Generating quantized image...")
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

    return StreamingResponse(
        _ndjson_stream(worker),
        media_type="application/x-ndjson",
    )


@router.post("/match")
async def match(
    pixelLabels: Annotated[UploadFile, File(...)],
    icpMask: Annotated[UploadFile, File(...)],
    params: Annotated[UploadFile, File(...)],
):
    """Match GADM divisions to color clusters via RANSAC affine estimation. Streams NDJSON progress."""
    cfg = json.loads(await params.read())

    pl_img = decode_image(await pixelLabels.read())
    pl = pl_img[:, :, 0] if len(pl_img.shape) == 3 else pl_img

    icp_img = decode_image(await icpMask.read())
    icp = icp_img[:, :, 0] if len(icp_img.shape) == 3 else icp_img

    country_mask = (pl < 255).astype(np.uint8)

    def worker(progress, _await_review):
        return run_matching(
            pixel_labels=pl,
            icp_mask=icp,
            country_mask=country_mask,
            division_paths=cfg["divisionPaths"],
            centroids=cfg["centroids"],
            color_centroids=cfg["colorCentroids"],
            country_path=cfg["countryPath"],
            country_bbox=cfg["countryBbox"],
            tw=cfg["tw"],
            th=cfg["th"],
            orig_w=cfg["origW"],
            orig_h=cfg["origH"],
            on_progress=progress,
        )

    return StreamingResponse(
        _ndjson_stream(worker),
        media_type="application/x-ndjson",
    )


@router.post("/phase3")
async def phase3(
    params: str = Form(...),
):
    """Phase 3: Division assignment — stub.
    ICP alignment and division assignment are handled by Node.js
    using the existing JS code with the Python-computed pixelLabels."""
    return {
        "stub": True,
        "message": "Division assignment handled by Node.js backend",
    }
