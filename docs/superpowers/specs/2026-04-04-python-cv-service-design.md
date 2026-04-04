# Python CV Microservice — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Problem:** The OpenCV.js WASM build (`@techstark/opencv-js`) is missing key functions (`pyrMeanShiftFiltering`, `ximgproc.SLIC`, etc.), forcing manual reimplementation of algorithms in TypeScript. A Python service unlocks the full OpenCV, scikit-image, and future PyTorch/SAM ecosystem.

## Overview

A FastAPI microservice (`cv-python`) running alongside the Node.js backend in Docker. Provides the full CV clustering pipeline as an alternative to the JavaScript implementation. An admin toggle switches between JS and Python for the entire pipeline — no partial mixing.

## Design Decisions

- **Full pipeline toggle, not per-operation** — the admin setting switches the entire CV pipeline between JS and Python. No mixing of implementations across steps. Cleaner mental model, easier comparison.
- **Phased endpoints, not monolithic** — three HTTP calls matching the three interactive review boundaries (water → cluster → assignment). The Node.js orchestrator handles SSE and user reviews between phases.
- **Binary multipart transfer** — images sent as raw bytes in multipart/form-data. No base64 overhead.
- **No PyTorch in v1** — keeps the Docker image small (~500MB). PyTorch + SAM is a future addition.
- **Infrastructure first** — this spec covers the service setup, Docker integration, and feature flag. Improved algorithms are Spec 2.

## Service Architecture

### Docker Service

```yaml
# Added to docker-compose.yml
cv-python:
  build: ./cv-python
  container_name: ${STACK_NAME}-cv-python
  ports: ["8000:8000"]
  volumes:
    - ./cv-python/app:/app/app:ro
    - ./data:/app/data
  depends_on:
    db: { condition: service_healthy }
  environment:
    - PYTHONUNBUFFERED=1
```

Port 8000. Accessible from the backend container as `http://cv-python:8000`.

### Project Structure

```
cv-python/
├── Dockerfile
├── requirements.txt
├── app/
│   ├── main.py              # FastAPI app, CORS, health check
│   ├── routes/
│   │   └── pipeline.py      # /pipeline/phase1, phase2, phase3
│   ├── cv/
│   │   ├── preprocess.py    # Mean-shift, water detection, country mask
│   │   ├── cluster.py       # K-means in CIELAB, cluster cleanup
│   │   └── superpixel.py    # SLIC superpixels
│   └── utils/
│       ├── image.py         # Image decode/encode helpers
│       └── borders.py       # Contour extraction, Douglas-Peucker
```

### Dependencies

```
fastapi==0.115.*
uvicorn[standard]==0.34.*
numpy==2.*
opencv-python-headless==4.11.*
scikit-image==0.25.*
python-multipart==0.0.*
```

### Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Phased Pipeline Endpoints

Three endpoints matching the three interactive review boundaries in the CV pipeline:

### Phase 1: Preprocess + Water Detection

```
POST /pipeline/phase1
Content-Type: multipart/form-data

Fields:
  image: bytes          # raw map image (PNG/JPEG)
  params: JSON string   # { tw, th, origW, origH, ... }

Response: JSON
  filteredImage: base64 PNG    # mean-shift filtered result
  waterMask: base64 PNG        # water pixel mask
  waterComponents: [...]       # water component info for review
  countryMask: base64 PNG      # country pixel mask
  countrySize: number
  debugImages: [{label, dataUrl}, ...]
```

Node.js receives this, sends SSE progress + water review to frontend, waits for user decision.

### Phase 2: Clustering + Superpixels

```
POST /pipeline/phase2
Content-Type: multipart/form-data

Fields:
  filteredImage: bytes              # from phase 1
  waterDecisions: JSON string       # user's water review decisions
  countryMask: bytes                # from phase 1
  params: JSON string

Response: JSON
  pixelLabels: base64 Uint8Array
  colorCentroids: [[r,g,b], ...]
  superpixelLabels: base64 Uint8Array   # SLIC atomic regions
  clusterInfo: [{label, color, pct, componentCount}, ...]
  borderPaths: [{id, points, type, clusters}, ...]
  quantizedImage: base64 PNG            # flat cluster colors, no borders
  debugImages: [{label, dataUrl}, ...]
  pipelineSize: {w, h}
```

Node.js receives this, sends cluster_review SSE with cluster info + border paths + superpixel data, waits for user review/manual editing.

### Phase 3: Division Assignment

```
POST /pipeline/phase3
Content-Type: multipart/form-data

Fields:
  pixelLabels: bytes          # possibly corrected by user
  colorCentroids: JSON string
  params: JSON string         # includes GADM division info, ICP config

Response: JSON
  assignments: [{divisionId, clusterLabel, confidence}, ...]
  debugImages: [{label, dataUrl}, ...]
```

Node.js receives this, sends completion SSE.

### Health Check

```
GET /health
Response: { "status": "ok", "opencv": "4.11.0", "scikit_image": "0.25.0" }
```

## Feature Flag

### Storage

Add to the existing admin settings system (AI settings use the same pattern):

```
Setting key: "cv_pipeline_implementation"
Values: "javascript" (default) | "python"
```

Stored in the database, cached in-memory for 60 seconds (same as AI model settings).

### Admin UI

Add a select dropdown in the AI Settings panel:

```
CV Pipeline Implementation: [JavaScript ▾] / [Python ▾]
```

Alongside the existing model selection dropdowns. Same styling, same section.

### Backend Branching

In the CV pipeline orchestrator (`colorMatchDivisionsSSE` or its caller):

```typescript
const cvImpl = await getSetting('cv_pipeline_implementation') ?? 'javascript';
if (cvImpl === 'python') {
  await runPythonCvPipeline(regionId, mapBuffer, sendEvent, logStep, ...);
} else {
  await runJavaScriptCvPipeline(regionId, mapBuffer, sendEvent, logStep, ...);
}
```

Both functions produce the same SSE events and data shapes. The downstream code (cluster review UI, division assignment, manual editing) is identical regardless of implementation.

## Node.js Client Module

A new file `backend/src/services/cv/pythonCvClient.ts`:

```typescript
const CV_PYTHON_URL = process.env.CV_PYTHON_URL ?? 'http://cv-python:8000';

export async function cvPhase1(imageBuffer: Buffer, params: object) { ... }
export async function cvPhase2(filteredImage: Buffer, waterDecisions: object, countryMask: Buffer, params: object) { ... }
export async function cvPhase3(pixelLabels: Buffer, colorCentroids: number[][], params: object) { ... }
export async function cvHealthCheck(): Promise<boolean> { ... }
```

Each function sends multipart/form-data via `fetch` (or `undici`), returns parsed JSON response. Error handling: if the Python service is down or returns an error, the Node.js orchestrator falls back to JS pipeline with a warning log.

## Scope Boundaries

**In scope:**
- Python FastAPI service with Docker setup
- Three phased endpoints (preprocess, cluster, assign)
- Binary multipart image transfer
- Node.js client module (`pythonCvClient.ts`)
- Feature flag in admin settings
- Node.js orchestrator branching
- Health check endpoint
- Phase implementations that replicate current JS pipeline behavior using Python OpenCV + scikit-image
- SLIC superpixel labels included in Phase 2 output

**Out of scope (Spec 2):**
- Improved CV algorithms (better mean-shift params, smarter clustering)
- SAM / PyTorch integration
- Frontend superpixel click-to-reassign UI
- Removing OpenCV.js from the Node.js backend
- Performance optimization / caching

## Files Changed

### New
- `cv-python/` — entire new service directory
- `backend/src/services/cv/pythonCvClient.ts` — HTTP client

### Modified
- `docker-compose.yml` — add `cv-python` service
- `backend/src/controllers/admin/wvImportMatchPipeline.ts` — branching logic
- Admin settings UI (add CV implementation dropdown)
- Admin settings backend (add setting key)
