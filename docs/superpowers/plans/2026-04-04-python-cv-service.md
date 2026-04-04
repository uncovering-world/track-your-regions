# Python CV Microservice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Python FastAPI CV service alongside the Node.js backend, with an admin toggle to switch the entire CV pipeline between JavaScript and Python implementations.

**Architecture:** Python FastAPI service in Docker with three phased endpoints (preprocess, cluster, assign) matching the interactive review boundaries. Node.js backend calls via HTTP multipart. Admin setting `cv_pipeline_implementation` toggles between `javascript` and `python` for the full pipeline. Python uses OpenCV + scikit-image for CV operations.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, OpenCV (headless), scikit-image, numpy; Node.js fetch for HTTP client; existing ai_settings table for feature flag

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `cv-python/Dockerfile` | Python 3.12-slim + CV dependencies |
| `cv-python/requirements.txt` | FastAPI, OpenCV, scikit-image, numpy |
| `cv-python/app/main.py` | FastAPI app, CORS, health check |
| `cv-python/app/routes/pipeline.py` | Phase 1/2/3 endpoints |
| `cv-python/app/cv/preprocess.py` | Mean-shift filtering, water/background detection |
| `cv-python/app/cv/cluster.py` | K-means CIELAB clustering, cleanup |
| `cv-python/app/cv/superpixel.py` | SLIC superpixels via scikit-image |
| `cv-python/app/utils/image.py` | Image decode/encode, base64 helpers |
| `cv-python/app/utils/borders.py` | OpenCV findContours, Douglas-Peucker |
| `backend/src/services/cv/pythonCvClient.ts` | HTTP client for Python service |

### Modified Files
| File | Changes |
|------|---------|
| `docker-compose.yml` | Add `cv-python` service |
| `backend/src/controllers/admin/wvImportMatchPipeline.ts` | Add branching: check setting → delegate to Python or JS |
| `backend/src/services/ai/aiSettingsService.ts` | Add `getSetting()` helper (or reuse `getAllSettings`) |
| `frontend/src/components/admin/AISettingsPanel.tsx` | Add CV Implementation dropdown |
| `db/init/01-schema.sql` | Add default setting row (or handle via INSERT on first use) |

---

### Task 1: Python Service Scaffold + Health Check

**Files:**
- Create: `cv-python/Dockerfile`
- Create: `cv-python/requirements.txt`
- Create: `cv-python/app/__init__.py`
- Create: `cv-python/app/main.py`

- [ ] **Step 1: Create requirements.txt**

```
# cv-python/requirements.txt
fastapi==0.115.12
uvicorn[standard]==0.34.0
numpy==2.2.4
opencv-python-headless==4.11.0.86
scikit-image==0.25.2
python-multipart==0.0.20
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# cv-python/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- [ ] **Step 3: Create main.py with health check**

```python
# cv-python/app/__init__.py
# (empty)
```

```python
# cv-python/app/main.py
import cv2
import skimage
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Track Your Regions — CV Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "opencv": cv2.__version__,
        "scikit_image": skimage.__version__,
    }
```

- [ ] **Step 4: Build and test locally**

```bash
cd cv-python
docker build -t tyr-cv-python .
docker run --rm -p 8000:8000 tyr-cv-python
# In another terminal:
curl http://localhost:8000/health
# Expected: {"status":"ok","opencv":"4.11.0","scikit_image":"0.25.2"}
```

- [ ] **Step 5: Commit**

```bash
git add cv-python/
git commit -m "feat: Python CV service scaffold with health check

FastAPI + OpenCV + scikit-image in Docker. Health endpoint returns
library versions."
```

---

### Task 2: Docker Compose Integration

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add cv-python service to docker-compose.yml**

Add before the `volumes:` section at the bottom:

```yaml
  cv-python:
    build:
      context: ./cv-python
      dockerfile: Dockerfile
    container_name: ${STACK_NAME:-tyr-ng}-cv-python
    ports:
      - "${CV_PYTHON_PORT:-8000}:8000"
    volumes:
      - ./cv-python/app:/app/app:ro
      - ./data:/app/data
    environment:
      - PYTHONUNBUFFERED=1
    restart: unless-stopped
```

- [ ] **Step 2: Add CV_PYTHON_URL to backend environment**

In the `backend` service environment section, add:

```yaml
      CV_PYTHON_URL: http://cv-python:8000
```

- [ ] **Step 3: Test with docker compose**

```bash
npm run dev
# Wait for services to start, then:
curl http://localhost:8000/health
# Expected: {"status":"ok","opencv":"4.11.0","scikit_image":"0.25.2"}
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add cv-python service to Docker Compose

Python CV service on port 8000, with source volume mount for
hot-reload and shared data directory."
```

---

### Task 3: Image Utilities + Phase 1 Endpoint (Preprocess)

**Files:**
- Create: `cv-python/app/utils/__init__.py`
- Create: `cv-python/app/utils/image.py`
- Create: `cv-python/app/cv/__init__.py`
- Create: `cv-python/app/cv/preprocess.py`
- Create: `cv-python/app/routes/__init__.py`
- Create: `cv-python/app/routes/pipeline.py`
- Modify: `cv-python/app/main.py`

- [ ] **Step 1: Create image utilities**

```python
# cv-python/app/utils/__init__.py
# (empty)

# cv-python/app/utils/image.py
import base64
import cv2
import numpy as np


def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode raw image bytes to BGR numpy array."""
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def encode_png_base64(image: np.ndarray) -> str:
    """Encode numpy array to base64 PNG data URL."""
    _, buf = cv2.imencode(".png", image)
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def encode_labels_base64(labels: np.ndarray) -> str:
    """Encode a uint8 label array to base64 string."""
    return base64.b64encode(labels.astype(np.uint8).tobytes()).decode("ascii")


def resize_image(image: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resize image to target dimensions."""
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_LANCZOS4)
```

- [ ] **Step 2: Create preprocess module**

```python
# cv-python/app/cv/__init__.py
# (empty)

# cv-python/app/cv/preprocess.py
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
    # Low saturation + high value = gray background
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    bg_mask = ((sat < 30) & (val > 180)).astype(np.uint8) * 255
    # Invert: foreground = not background
    country_mask = cv2.bitwise_not(bg_mask)
    return country_mask


def detect_water(image: np.ndarray, country_mask: np.ndarray) -> tuple[np.ndarray, list]:
    """Detect water regions (blue-ish, low saturation areas).
    Returns water mask and component info for review."""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    # Water: hue in blue range (90-130), moderate saturation
    lower_blue = np.array([90, 20, 80])
    upper_blue = np.array([130, 255, 255])
    water_mask = cv2.inRange(hsv, lower_blue, upper_blue)
    # Only consider within country area
    water_mask = cv2.bitwise_and(water_mask, country_mask)

    # Find connected components for review
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(water_mask)
    total_country = int(np.sum(country_mask > 0))
    components = []
    for i in range(1, num_labels):  # skip background (0)
        area = int(stats[i, cv2.CC_STAT_AREA])
        pct = round(area / max(total_country, 1) * 100, 1)
        if pct >= 0.5:  # only report components > 0.5%
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
    # Resize to pipeline resolution
    pipeline_img = resize_image(image, tw, th)

    # Mean-shift filtering (the real thing, not JS reimplementation)
    filtered = mean_shift_filter(pipeline_img, sp=10, sr=20)

    # Background detection
    country_mask = detect_background(filtered)
    country_size = int(np.sum(country_mask > 0))

    # Water detection
    water_mask, water_components = detect_water(filtered, country_mask)

    # Debug images (upscaled for display)
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
```

- [ ] **Step 3: Create pipeline route with Phase 1 endpoint**

```python
# cv-python/app/routes/__init__.py
# (empty)

# cv-python/app/routes/pipeline.py
import json
from fastapi import APIRouter, File, Form, UploadFile
from ..cv.preprocess import run_phase1
from ..utils.image import decode_image

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
```

- [ ] **Step 4: Register route in main.py**

Add to `cv-python/app/main.py`:

```python
from .routes.pipeline import router as pipeline_router

app.include_router(pipeline_router)
```

- [ ] **Step 5: Test Phase 1**

```bash
# Rebuild and restart
docker compose up --build cv-python -d
# Test with a sample image
curl -X POST http://localhost:8000/pipeline/phase1 \
  -F "image=@test-image.png" \
  -F 'params={"tw":500,"th":400,"origW":2000,"origH":1600}'
# Expected: JSON with filteredImage, waterMask, etc.
```

- [ ] **Step 6: Commit**

```bash
git add cv-python/
git commit -m "feat(cv-python): phase 1 endpoint — preprocess + water detection

Mean-shift filtering via real cv2.pyrMeanShiftFiltering, background
detection via HSV saturation, water detection with connected components."
```

---

### Task 4: Phase 2 Endpoint (Clustering + Superpixels)

**Files:**
- Create: `cv-python/app/cv/cluster.py`
- Create: `cv-python/app/cv/superpixel.py`
- Create: `cv-python/app/utils/borders.py`
- Modify: `cv-python/app/routes/pipeline.py`

- [ ] **Step 1: Create clustering module**

```python
# cv-python/app/cv/cluster.py
import cv2
import numpy as np


def kmeans_cielab(
    image: np.ndarray,
    country_mask: np.ndarray,
    n_clusters: int = 12,
) -> tuple[np.ndarray, list]:
    """K-means clustering in CIELAB color space.
    Returns pixel_labels (uint8, 255=background) and color_centroids."""
    h, w = image.shape[:2]
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2Lab).astype(np.float32)

    # Collect country pixels
    mask_flat = country_mask.flatten() > 0
    pixels = lab.reshape(-1, 3)[mask_flat]

    if len(pixels) < n_clusters:
        labels = np.full(h * w, 255, dtype=np.uint8)
        return labels, []

    # K-means
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
    _, km_labels, centers = cv2.kmeans(
        pixels, n_clusters, None, criteria, 10, cv2.KMEANS_PP_CENTERS
    )

    # Map back to full image
    pixel_labels = np.full(h * w, 255, dtype=np.uint8)
    pixel_labels[mask_flat] = km_labels.flatten().astype(np.uint8)

    # Convert centroids back to BGR → RGB
    centroids = []
    for c in centers:
        lab_pixel = np.array([[[c[0], c[1], c[2]]]], dtype=np.float32)
        bgr = cv2.cvtColor(lab_pixel.astype(np.uint8), cv2.COLOR_Lab2BGR)[0, 0]
        centroids.append([int(bgr[2]), int(bgr[1]), int(bgr[0])])  # RGB

    return pixel_labels.reshape(h, w), centroids
```

- [ ] **Step 2: Create superpixel module**

```python
# cv-python/app/cv/superpixel.py
from skimage.segmentation import slic
import numpy as np


def compute_slic(
    image: np.ndarray,
    n_segments: int = 300,
    compactness: float = 10.0,
) -> np.ndarray:
    """Compute SLIC superpixels using scikit-image.
    Returns label array (int32, one label per pixel)."""
    # skimage expects RGB
    from skimage.color import rgb2lab
    # image is BGR from OpenCV, convert
    rgb = image[:, :, ::-1]
    labels = slic(rgb, n_segments=n_segments, compactness=compactness, start_label=0)
    return labels.astype(np.int32)
```

- [ ] **Step 3: Create border extraction module**

```python
# cv-python/app/utils/borders.py
import cv2
import numpy as np


def extract_contour_paths(
    pixel_labels: np.ndarray,
    min_contour_points: int = 10,
    simplify_epsilon: float = 1.5,
) -> list[dict]:
    """Extract border paths from pixel labels using cv2.findContours.
    Returns list of BorderPath dicts."""
    unique_labels = [l for l in np.unique(pixel_labels) if l != 255]
    paths = []
    next_id = 0

    for label in unique_labels:
        mask = (pixel_labels == label).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

        for contour in contours:
            if len(contour) < 4:
                continue

            # Simplify with Douglas-Peucker
            simplified = cv2.approxPolyDP(contour, simplify_epsilon, closed=True)
            points = simplified.reshape(-1, 2).tolist()

            if len(points) < min_contour_points:
                continue

            # Classify: check what's adjacent
            border_type = "external"
            neighbor_label = 255
            for pt in points[:10]:
                x, y = int(pt[0]), int(pt[1])
                for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < pixel_labels.shape[1] and 0 <= ny < pixel_labels.shape[0]:
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
```

- [ ] **Step 4: Create Phase 2 endpoint**

Add to `cv-python/app/routes/pipeline.py`:

```python
from ..cv.cluster import kmeans_cielab
from ..cv.superpixel import compute_slic
from ..utils.borders import extract_contour_paths
from ..utils.image import decode_image, encode_png_base64, encode_labels_base64

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
    # Country mask is grayscale — take first channel
    mask = mask_img[:, :, 0] if len(mask_img.shape) == 3 else mask_img

    tw, th = cfg.get("tw", filtered.shape[1]), cfg.get("th", filtered.shape[0])
    n_clusters = cfg.get("numClusters", 12)

    # K-means clustering
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
        quant[pixel_labels == i] = [c[2], c[1], c[0]]  # RGB → BGR

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
```

Add `import numpy as np` at the top of the file.

- [ ] **Step 5: Commit**

```bash
git add cv-python/
git commit -m "feat(cv-python): phase 2 — K-means clustering + SLIC superpixels

K-means in CIELAB via cv2.kmeans, SLIC via skimage.segmentation.slic,
border extraction via cv2.findContours + approxPolyDP."
```

---

### Task 5: Phase 3 Endpoint (Division Assignment — Stub)

**Files:**
- Modify: `cv-python/app/routes/pipeline.py`

Phase 3 (ICP alignment + division assignment) is complex and tightly coupled to PostGIS data. For v1, the Python service returns the cluster data and the Node.js backend handles ICP + assignment using the existing JS code. Phase 3 is a passthrough stub.

- [ ] **Step 1: Add Phase 3 stub endpoint**

Add to `cv-python/app/routes/pipeline.py`:

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add cv-python/app/routes/pipeline.py
git commit -m "feat(cv-python): phase 3 stub — division assignment handled by Node.js"
```

---

### Task 6: Node.js Client Module

**Files:**
- Create: `backend/src/services/cv/pythonCvClient.ts`

- [ ] **Step 1: Create the client module**

```typescript
// backend/src/services/cv/pythonCvClient.ts

const CV_PYTHON_URL = process.env.CV_PYTHON_URL ?? 'http://cv-python:8000';

/** Check if the Python CV service is available. */
export async function cvHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${CV_PYTHON_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Phase 1: Preprocess + water detection. */
export async function cvPhase1(
  imageBuffer: Buffer,
  params: { tw: number; th: number; origW: number; origH: number },
): Promise<{
  filteredImage: string;
  waterMask: string;
  waterComponents: Array<{ id: number; pct: number }>;
  countryMask: string;
  countrySize: number;
  debugImages: Array<{ label: string; dataUrl: string }>;
}> {
  const form = new FormData();
  form.append('image', new Blob([imageBuffer]), 'image.png');
  form.append('params', JSON.stringify(params));

  const res = await fetch(`${CV_PYTHON_URL}/pipeline/phase1`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`CV Phase 1 failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Phase 2: Clustering + superpixels. */
export async function cvPhase2(
  filteredImageBuffer: Buffer,
  countryMaskBuffer: Buffer,
  params: { tw: number; th: number; numClusters: number },
): Promise<{
  pixelLabels: string;
  colorCentroids: Array<[number, number, number]>;
  superpixelLabels: string;
  clusterInfo: Array<{ label: number; color: string; pct: number; isSmall: boolean; componentCount: number }>;
  borderPaths: Array<{ id: string; points: Array<[number, number]>; type: string; clusters: [number, number] }>;
  quantizedImage: string;
  debugImages: Array<{ label: string; dataUrl: string }>;
  pipelineSize: { w: number; h: number };
}> {
  const form = new FormData();
  form.append('filteredImage', new Blob([filteredImageBuffer]), 'filtered.png');
  form.append('countryMask', new Blob([countryMaskBuffer]), 'mask.png');
  form.append('params', JSON.stringify(params));

  const res = await fetch(`${CV_PYTHON_URL}/pipeline/phase2`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`CV Phase 2 failed: ${res.status} ${await res.text()}`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/cv/pythonCvClient.ts
git commit -m "feat: Node.js HTTP client for Python CV service

Typed functions for health check, phase1 (preprocess), and phase2
(clustering). Binary multipart image transfer."
```

---

### Task 7: Feature Flag — Settings + Admin UI

**Files:**
- Modify: `backend/src/services/ai/aiSettingsService.ts`
- Modify: `frontend/src/components/admin/AISettingsPanel.tsx`

- [ ] **Step 1: Add getSetting helper to aiSettingsService.ts**

Add after the existing `getModelForFeature` function:

```typescript
/** Get a raw setting value by key. */
export async function getSetting(key: string): Promise<string | undefined> {
  const settings = await loadCache();
  return settings.get(key);
}
```

Export it from the file.

- [ ] **Step 2: Add CV Implementation dropdown to AISettingsPanel.tsx**

In the `FEATURE_LABELS` object or equivalent location, the CV implementation toggle should be rendered as a separate section. Add after the existing model selectors:

```tsx
{/* CV Pipeline Implementation */}
<Box sx={{ mt: 3 }}>
  <Typography variant="subtitle2" sx={{ mb: 1 }}>CV Pipeline Implementation</Typography>
  <Select
    size="small"
    value={settingsData?.settings?.['cv_pipeline_implementation'] ?? 'javascript'}
    onChange={(e) => updateMutation.mutate({
      key: 'cv_pipeline_implementation',
      value: e.target.value,
    })}
    sx={{ minWidth: 200 }}
  >
    <MenuItem value="javascript">JavaScript (OpenCV.js WASM)</MenuItem>
    <MenuItem value="python">Python (OpenCV + scikit-image)</MenuItem>
  </Select>
  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
    Switches the entire CV color-match pipeline between implementations
  </Typography>
</Box>
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/ai/aiSettingsService.ts frontend/src/components/admin/AISettingsPanel.tsx
git commit -m "feat: admin toggle for CV pipeline implementation (JS vs Python)

Add getSetting() helper. Add CV Implementation dropdown in AI
Settings panel. Setting key: cv_pipeline_implementation."
```

---

### Task 8: Pipeline Orchestrator Branching

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchPipeline.ts`

This is the key integration point: check the setting and delegate to Python or run JS.

- [ ] **Step 1: Add Python pipeline runner**

In `wvImportMatchPipeline.ts`, add a new function that calls the Python service phases and maps the results back into the existing SSE flow. This function should:

1. Call `cvPhase1` with the map image
2. Send water review SSE if needed, wait for user decision
3. Call `cvPhase2` with the filtered image and water decisions
4. Send cluster review SSE, wait for user decision
5. Continue with the existing JS code for ICP + division assignment (using the Python-computed pixelLabels)

Add the imports at the top:

```typescript
import { getSetting } from '../../services/ai/aiSettingsService.js';
import { cvPhase1, cvPhase2, cvHealthCheck } from '../../services/cv/pythonCvClient.js';
```

In `colorMatchDivisionsSSE`, before the existing pipeline starts (around line 400, after image download and before mean-shift), add the branching:

```typescript
const cvImpl = await getSetting('cv_pipeline_implementation') ?? 'javascript';
if (cvImpl === 'python') {
  const isAvailable = await cvHealthCheck();
  if (!isAvailable) {
    console.warn('[CV] Python service unavailable, falling back to JavaScript');
  } else {
    console.log('[CV] Using Python CV pipeline');
    // Call Python phases and integrate results into the SSE flow
    // ... (implementation follows the phased approach from the spec)
    return;
  }
}
// Existing JavaScript pipeline continues below
```

The full Python pipeline integration requires mapping the Python responses (base64 images, labels) back into the `PipelineContext` format that the SSE events and review sections expect. This is the most complex part — it needs to:
- Decode base64 images from Python responses to Buffers
- Convert base64 pixelLabels to Uint8Array
- Store preview/highlight images in the review state
- Trigger the same SSE events as the JS pipeline
- Handle water review pause and cluster review pause
- After cluster review, feed the (possibly corrected) pixelLabels into the existing JS ICP + assignment code

The implementation should follow the exact same SSE event sequence as the JS pipeline so the frontend UI works identically regardless of backend.

- [ ] **Step 2: Run typecheck**

```bash
npm run check
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchPipeline.ts
git commit -m "feat: pipeline branching — delegate to Python CV or run JS

Check cv_pipeline_implementation setting at pipeline start. If
'python', call Python service phases. Falls back to JS if Python
service is unavailable."
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/tech/cv-auto-match.md`
- Modify: `docs/vision/vision.md`

- [ ] **Step 1: Update tech docs**

Add a "Python CV Service" section to `docs/tech/cv-auto-match.md`:
- Architecture: FastAPI sidecar on port 8000
- Three phased endpoints matching review boundaries
- Feature flag: `cv_pipeline_implementation` in admin settings
- SLIC superpixels included in Phase 2 output
- Phase 3 (ICP + assignment) still runs in JS

- [ ] **Step 2: Update vision.md**

Add under admin capabilities: Python CV service as alternative implementation with admin toggle for A/B comparison.

- [ ] **Step 3: Run pre-commit checks**

```bash
npm run check
npm run knip
TEST_REPORT_LOCAL=1 npm test
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: add Python CV service to tech docs and vision"
```

---

## Post-Implementation Notes

**Testing the full flow:**
1. `npm run dev` — starts all services including cv-python
2. Check Python service: `curl http://localhost:8000/health`
3. Admin panel → AI Settings → set CV Implementation to "Python"
4. Run CV color match on a region
5. Verify: pipeline uses Python (check console for "[CV] Using Python CV pipeline")
6. Compare results between JS and Python implementations

**Known limitations of v1:**
- Water detection in Python uses simple HSV thresholding (vs the more sophisticated JS approach)
- No park detection in Python Phase 1 yet
- Phase 3 (ICP + assignment) still runs in JS — the Python service provides pixelLabels but assignment uses existing JS code
- SLIC superpixels are computed but the frontend click-to-reassign UI is not implemented yet (Spec 2)
- Mean-shift parameters may need tuning to match JS output quality
